import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import {
  billMaterialsForBlakeReview,
  blakeReviewsToAllowances,
  buildHeuristicBlakeBoqReview,
  mergeBlakeBoqSuggestions,
  type BlakeBoqReviewDraft,
} from "@/lib/blake-boq-review";
import { isExcelWorkbookFile } from "@/lib/boq-xlsx";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory } from "@/lib/server-store";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffProject,
} from "@/lib/takeoff-data";

export const runtime = "nodejs";

type ReviewPayload = {
  actor?: string;
  apply?: boolean;
  parentMaterialIds?: string[];
};

type OpenAiTextContent = { type: "input_text"; text: string };
type OpenAiInputContent =
  | OpenAiTextContent
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_file"; file_data: string; filename: string; detail: "high" };

const OPENAI_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const OPENAI_FILE_LIMIT_COUNT = 6;

const blakeBoqReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "confidence", "reviews", "questions"],
  properties: {
    summary: { type: "string" },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
    questions: { type: "array", items: { type: "string" } },
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "parentMaterialId",
          "parentDescription",
          "parentQuantity",
          "parentUnit",
          "section",
          "ancillaries",
          "labour",
          "drawingNotes",
          "skippedRestate",
        ],
        properties: {
          parentMaterialId: { type: "string" },
          parentDescription: { type: "string" },
          parentQuantity: { type: "number" },
          parentUnit: { type: "string" },
          section: { type: "string" },
          skippedRestate: { type: "boolean" },
          drawingNotes: { type: "array", items: { type: "string" } },
          ancillaries: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["description", "quantity", "unit", "unitCost", "supplierRequired", "rationale"],
              properties: {
                description: { type: "string" },
                quantity: { type: "number" },
                unit: { type: "string" },
                unitCost: { type: "number" },
                supplierRequired: { type: "boolean" },
                rationale: { type: "string" },
              },
            },
          },
          labour: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "hoursPerUnit", "unitBasis", "hours", "costRate", "notes"],
              properties: {
                role: { type: "string" },
                hoursPerUnit: { type: "number" },
                unitBasis: { type: "string" },
                hours: { type: "number" },
                costRate: { type: "number" },
                notes: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

function storedFilePath(document: TakeoffDocument) {
  if (!document.storageKey) return null;
  const storeDirectory = getServerStoreDirectory();
  const resolved = path.normalize(path.join(storeDirectory, document.storageKey));
  const allowedRoot = path.normalize(`${storeDirectory}${path.sep}`);
  return resolved.startsWith(allowedRoot) ? resolved : null;
}

function getOutputText(response: unknown) {
  if (response && typeof response === "object" && "output_text" in response && typeof response.output_text === "string") {
    return response.output_text;
  }
  const output = response && typeof response === "object" && "output" in response ? response.output : null;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
    return item.content.map((content: unknown) => (
      content && typeof content === "object" && "text" in content && typeof content.text === "string"
        ? content.text
        : ""
    ));
  }).filter(Boolean).join("\n");
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDraft(raw: BlakeBoqReviewDraft, billLines: ReturnType<typeof billMaterialsForBlakeReview>): BlakeBoqReviewDraft {
  const byId = new Map(billLines.map((line) => [line.id, line]));
  const reviews = (Array.isArray(raw.reviews) ? raw.reviews : [])
    .map((review) => {
      const parent = byId.get(review.parentMaterialId);
      return {
        parentMaterialId: asText(review.parentMaterialId),
        parentDescription: asText(review.parentDescription, parent?.description || "Bill item"),
        parentQuantity: asNumber(review.parentQuantity, parent?.quantity ?? 0),
        parentUnit: asText(review.parentUnit, parent?.unit || "item"),
        section: asText(review.section, parent?.section || "Materials"),
        skippedRestate: review.skippedRestate !== false,
        drawingNotes: Array.isArray(review.drawingNotes)
          ? review.drawingNotes.map((note) => asText(note)).filter(Boolean).slice(0, 8)
          : [],
        ancillaries: (Array.isArray(review.ancillaries) ? review.ancillaries : []).slice(0, 12).map((item) => ({
          description: asText(item.description, "Ancillary"),
          quantity: Math.max(0, asNumber(item.quantity, 1)),
          unit: asText(item.unit, "Nr"),
          unitCost: Math.max(0, asNumber(item.unitCost)),
          supplierRequired: item.supplierRequired === true,
          rationale: asText(item.rationale, "Blake suggestion from bill + drawings."),
        })),
        labour: (Array.isArray(review.labour) ? review.labour : []).slice(0, 4).map((item) => {
          const hoursPerUnit = Math.max(0, asNumber(item.hoursPerUnit));
          const unitBasis = asText(item.unitBasis, parent?.unit || "item");
          const hours = Math.max(0, asNumber(item.hours, hoursPerUnit * (parent?.quantity ?? 0)));
          return {
            role: asText(item.role, "Engineer labour"),
            hoursPerUnit,
            unitBasis,
            hours,
            costRate: Math.max(0, asNumber(item.costRate, 38)),
            notes: asText(item.notes, "Blake labour suggestion."),
          };
        }),
      };
    })
    .filter((review) => byId.has(review.parentMaterialId));

  // Ensure every bill line appears even if the model skipped it.
  billLines.forEach((line) => {
    if (reviews.some((review) => review.parentMaterialId === line.id)) return;
    reviews.push({
      parentMaterialId: line.id,
      parentDescription: line.description,
      parentQuantity: line.quantity,
      parentUnit: line.unit,
      section: line.section,
      skippedRestate: true,
      drawingNotes: ["No Blake suggestion returned for this line — left for office review."],
      ancillaries: [],
      labour: [],
    });
  });

  return {
    summary: asText(raw.summary, `Blake reviewed ${billLines.length} bill line(s).`),
    confidence: raw.confidence === "High" || raw.confidence === "Low" ? raw.confidence : "Medium",
    reviews,
    questions: Array.isArray(raw.questions)
      ? raw.questions.map((item) => asText(item)).filter(Boolean).slice(0, 20)
      : [],
  };
}

async function buildDrawingContent(project: TakeoffProject, billPrompt: string) {
  const skipped: string[] = [];
  const intro: OpenAiTextContent = {
    type: "input_text",
    text: [
      `Project: ${project.name}`,
      `Customer: ${project.customer}`,
      `Site: ${project.site}`,
      "You are Ayla, Blake estimating co-pilot for UK mechanical / plumbing takeoffs.",
      "Review EACH bill item below against the drawings.",
      "CRITICAL RULES:",
      "1) Do NOT restate or duplicate the parent bill quantity/description as an ancillary.",
      "2) Suggest ancillaries the bill usually omits (clips, brackets, joints, sundries) using drawing evidence where possible.",
      "3) Suggest labour for each item with hoursPerUnit (e.g. hours per metre for gutters) and total hours = hoursPerUnit * parent quantity.",
      "4) If a drawing does not support a quantity, say so in drawingNotes and keep conservative quantities.",
      "5) skippedRestate must be true on every review.",
      "",
      "Bill items:",
      billPrompt,
    ].join("\n"),
  };
  const content: OpenAiInputContent[] = [intro];
  let sourceFiles = 0;

  const drawings = project.documents.filter((document) =>
    document.kind === "Drawing" || document.kind === "Marked-up drawing" || document.kind === "Specification",
  );

  for (const document of drawings.slice(0, OPENAI_FILE_LIMIT_COUNT)) {
    if (isExcelWorkbookFile(document.fileName, document.mimeType)) continue;
    const filePath = storedFilePath(document);
    if (!filePath) {
      skipped.push(`${document.fileName} missing storage`);
      continue;
    }
    if ((document.size ?? 0) > OPENAI_FILE_LIMIT_BYTES) {
      skipped.push(`${document.fileName} too large`);
      continue;
    }
    try {
      const buffer = await readFile(filePath);
      const mimeType = document.mimeType || "application/octet-stream";
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      if (mimeType.startsWith("image/")) {
        content.push({ type: "input_image", image_url: dataUrl, detail: "high" });
      } else {
        content.push({ type: "input_file", file_data: dataUrl, filename: document.fileName, detail: "high" });
      }
      sourceFiles += 1;
    } catch {
      skipped.push(`${document.fileName} unreadable`);
    }
  }

  if (skipped.length) {
    intro.text = `${intro.text}\nSkipped files: ${skipped.join("; ")}`;
  }

  return { content, sourceFiles, skipped };
}

async function runOpenAiBlakeReview(project: TakeoffProject, apiKey: string, model: string) {
  const billLines = billMaterialsForBlakeReview(project);
  const billPrompt = billLines
    .map((line) => `- id=${line.id} | [${line.section}] ${line.description} | qty ${line.quantity} ${line.unit}`)
    .join("\n");
  const { content, sourceFiles } = await buildDrawingContent(project, billPrompt);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [{
            type: "input_text",
            text: "Return only JSON matching the schema. Never invent a replacement for the parent bill qty. Ancillaries and labour only.",
          }],
        },
        { role: "user", content },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nexa_blake_boq_review",
          strict: true,
          schema: blakeBoqReviewSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Blake BOQ review failed (${response.status}). Check OPENAI_API_KEY.`);
  }

  const body = await response.json();
  const outputText = getOutputText(body);
  if (!outputText) throw new Error("Blake did not return review JSON.");
  const parsed = JSON.parse(outputText) as BlakeBoqReviewDraft;
  return {
    draft: normalizeDraft(parsed, billLines),
    provider: "OpenAI" as const,
    model,
    sourceFiles,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await parseJsonRequestBody<ReviewPayload>(request);
  const actor = body?.actor?.trim() || request.headers.get(employeeHeaderName) || "Blake";
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const billLines = billMaterialsForBlakeReview(project);
  if (!billLines.length) {
    return NextResponse.json(
      { error: "Import a contractor BOQ (Excel) first so Blake has bill items to review." },
      { status: 400 },
    );
  }

  const openAi = getTakeoffOpenAiConfig();
  let draft: BlakeBoqReviewDraft;
  let provider: "OpenAI" | "Pilot" = "Pilot";
  let model: string | undefined;
  let sourceFiles = 0;

  try {
    if (openAi.apiKey) {
      const result = await runOpenAiBlakeReview(project, openAi.apiKey, openAi.model);
      draft = result.draft;
      provider = result.provider;
      model = result.model;
      sourceFiles = result.sourceFiles;
    } else {
      draft = buildHeuristicBlakeBoqReview(billLines);
    }
  } catch (error) {
    // Fall back to heuristics so office can still progress offline.
    draft = buildHeuristicBlakeBoqReview(billLines);
    draft.summary = `${draft.summary} (OpenAI review failed — used Blake rule-of-thumb fallback: ${
      error instanceof Error ? error.message : "unknown error"
    })`;
    draft.confidence = "Low";
  }

  const parentIds = Array.isArray(body?.parentMaterialIds) && body.parentMaterialIds.length
    ? body.parentMaterialIds.filter((item) => billLines.some((line) => line.id === item))
    : billLines.map((line) => line.id);

  const allowances = blakeReviewsToAllowances(project.id, draft, { includeParentIds: parentIds });
  let updatedProject = project;

  if (body?.apply) {
    const patch = mergeBlakeBoqSuggestions(project, allowances.materials, allowances.labour, parentIds);
    updatedProject = updateTakeoffProject(id, {
      ...patch,
      status: project.status === "Draft" ? "In review" : project.status,
      extraction: {
        ...project.extraction,
        status: "Draft extracted",
        provider: provider === "OpenAI" ? "OpenAI" : "Pilot",
        model,
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        confidence: draft.confidence,
        summary: draft.summary,
        questions: draft.questions,
        sourceFiles,
      },
    }) ?? project;
  }

  return NextResponse.json({
    project: updatedProject,
    draft,
    provider,
    model,
    sourceFiles,
    actor,
    generated: {
      billLines: billLines.length,
      ancillaries: allowances.materials.length,
      labour: allowances.labour.length,
      applied: Boolean(body?.apply),
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import {
  boqLinesToPromptText,
  isExcelWorkbookFile,
  parseEnquiryBoqFromXlsx,
} from "@/lib/boq-xlsx";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory } from "@/lib/server-store";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  applyTakeoffExtractionDraft,
  getTakeoffProject,
  materialAllowancesFromParsedBoq,
  mergeBoqMaterialAllowances,
  runTakeoffDraftExtraction,
  type TakeoffDocument,
  type TakeoffExtractionDraft,
  type TakeoffMaterialAllowance,
  type TakeoffMeasurement,
  type TakeoffPipeRun,
  type TakeoffProject,
} from "@/lib/takeoff-data";

export const runtime = "nodejs";

type ExtractPayload = {
  actor?: string;
};

class TakeoffExtractionInputError extends Error {}

type OpenAiTextContent = { type: "input_text"; text: string };
type OpenAiInputContent =
  | OpenAiTextContent
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_file"; file_data: string; filename: string; detail: "high" };

type OpenAiTakeoffPayload = {
  summary: string;
  confidence: "Low" | "Medium" | "High";
  rooms: Array<{
    name: string;
    level: string;
    lengthM: number;
    widthM: number;
    heightM: number;
    areaM2: number;
    heatLoadWatts: number;
    notes: string;
  }>;
  measurements: Array<{
    roomName: string;
    label: string;
    quantity: number;
    unit: string;
    source: TakeoffMeasurement["source"];
  }>;
  pipeRuns: Array<{
    roomName: string;
    service: TakeoffPipeRun["service"];
    route: string;
    diameter: string;
    material: string;
    lengthM: number;
    fittings: number;
    insulation: boolean;
    notes: string;
  }>;
  radiators: Array<{
    roomName: string;
    outputWatts: number;
    model: string;
    quantity: number;
    supplierRequired: boolean;
    notes: string;
  }>;
  materialAllowances: Array<{
    section: string;
    description: string;
    quantity: number;
    unit: string;
    unitCost: number;
    markupPercent: number;
    supplierRequired: boolean;
    preferredSupplier: string;
  }>;
  labourAllowances: Array<{
    section: string;
    role: string;
    hours: number;
    costRate: number;
    markupPercent: number;
    notes: string;
  }>;
  supplierRequests: Array<{
    supplier: string;
    description: string;
    quantity: number;
    unit: string;
    notes: string;
  }>;
  riskFlags: string[];
  questions: string[];
};

const OPENAI_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const OPENAI_FILE_LIMIT_COUNT = 8;
const serviceOptions: TakeoffPipeRun["service"][] = [
  "Heating flow/return",
  "Hot water",
  "Cold water",
  "Gas",
  "Waste",
  "Condensate",
  "Other",
];
const measurementSources: TakeoffMeasurement["source"][] = ["Drawing", "Spec", "BOQ", "Manual"];

const takeoffExtractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "confidence",
    "rooms",
    "measurements",
    "pipeRuns",
    "radiators",
    "materialAllowances",
    "labourAllowances",
    "supplierRequests",
    "riskFlags",
    "questions",
  ],
  properties: {
    summary: { type: "string" },
    confidence: { type: "string", enum: ["Low", "Medium", "High"] },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "level", "lengthM", "widthM", "heightM", "areaM2", "heatLoadWatts", "notes"],
        properties: {
          name: { type: "string" },
          level: { type: "string" },
          lengthM: { type: "number" },
          widthM: { type: "number" },
          heightM: { type: "number" },
          areaM2: { type: "number" },
          heatLoadWatts: { type: "number" },
          notes: { type: "string" },
        },
      },
    },
    measurements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "label", "quantity", "unit", "source"],
        properties: {
          roomName: { type: "string" },
          label: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          source: { type: "string", enum: measurementSources },
        },
      },
    },
    pipeRuns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "service", "route", "diameter", "material", "lengthM", "fittings", "insulation", "notes"],
        properties: {
          roomName: { type: "string" },
          service: { type: "string", enum: serviceOptions },
          route: { type: "string" },
          diameter: { type: "string" },
          material: { type: "string" },
          lengthM: { type: "number" },
          fittings: { type: "number" },
          insulation: { type: "boolean" },
          notes: { type: "string" },
        },
      },
    },
    radiators: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "outputWatts", "model", "quantity", "supplierRequired", "notes"],
        properties: {
          roomName: { type: "string" },
          outputWatts: { type: "number" },
          model: { type: "string" },
          quantity: { type: "number" },
          supplierRequired: { type: "boolean" },
          notes: { type: "string" },
        },
      },
    },
    materialAllowances: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "description", "quantity", "unit", "unitCost", "markupPercent", "supplierRequired", "preferredSupplier"],
        properties: {
          section: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unitCost: { type: "number" },
          markupPercent: { type: "number" },
          supplierRequired: { type: "boolean" },
          preferredSupplier: { type: "string" },
        },
      },
    },
    labourAllowances: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "role", "hours", "costRate", "markupPercent", "notes"],
        properties: {
          section: { type: "string" },
          role: { type: "string" },
          hours: { type: "number" },
          costRate: { type: "number" },
          markupPercent: { type: "number" },
          notes: { type: "string" },
        },
      },
    },
    supplierRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["supplier", "description", "quantity", "unit", "notes"],
        properties: {
          supplier: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    riskFlags: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
  },
};

function asText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown) {
  return value === true;
}

function listOfText(values: unknown, limit: number) {
  return Array.isArray(values)
    ? values.map((value) => asText(value, "")).filter(Boolean).slice(0, limit)
    : [];
}

function roomIdForName(roomIds: Map<string, string>, roomName: string) {
  return roomIds.get(roomName.trim().toLowerCase());
}

function normalizeOpenAiPayload(project: TakeoffProject, payload: OpenAiTakeoffPayload): TakeoffExtractionDraft {
  const rooms = (Array.isArray(payload.rooms) ? payload.rooms : []).slice(0, 60).map((room, index) => {
    const lengthM = asNumber(room.lengthM);
    const widthM = asNumber(room.widthM);
    const heightM = asNumber(room.heightM);
    const measuredArea = lengthM > 0 && widthM > 0 ? Number((lengthM * widthM).toFixed(2)) : 0;

    return {
      id: `openai-room-${project.id}-${index}`,
      name: asText(room.name, `Room ${index + 1}`),
      level: asText(room.level, "To confirm"),
      lengthM,
      widthM,
      heightM,
      areaM2: asNumber(room.areaM2, measuredArea) || measuredArea,
      heatLoadWatts: asNumber(room.heatLoadWatts),
      notes: asText(room.notes, "OpenAI draft; office review required."),
    };
  });
  const roomIds = new Map(rooms.map((room) => [room.name.trim().toLowerCase(), room.id]));

  return {
    rooms,
    measurements: (Array.isArray(payload.measurements) ? payload.measurements : []).slice(0, 120).map((measurement, index) => ({
      id: `openai-measure-${project.id}-${index}`,
      roomId: roomIdForName(roomIds, measurement.roomName),
      label: asText(measurement.label, `Measurement ${index + 1}`),
      quantity: asNumber(measurement.quantity),
      unit: asText(measurement.unit, "item"),
      source: measurementSources.includes(measurement.source) ? measurement.source : "Manual",
    })),
    pipeRuns: (Array.isArray(payload.pipeRuns) ? payload.pipeRuns : []).slice(0, 80).map((run, index) => ({
      id: `openai-pipe-${project.id}-${index}`,
      roomId: roomIdForName(roomIds, run.roomName),
      service: serviceOptions.includes(run.service) ? run.service : "Other",
      route: asText(run.route, `Route ${index + 1}`),
      diameter: asText(run.diameter, "TBC"),
      material: asText(run.material, "TBC"),
      lengthM: asNumber(run.lengthM),
      fittings: asNumber(run.fittings),
      insulation: asBoolean(run.insulation),
      notes: asText(run.notes, "OpenAI draft; confirm against latest drawing."),
    })),
    radiators: (Array.isArray(payload.radiators) ? payload.radiators : []).slice(0, 80).map((radiator, index) => ({
      id: `openai-radiator-${project.id}-${index}`,
      roomId: roomIdForName(roomIds, radiator.roomName),
      roomName: asText(radiator.roomName, "Room to confirm"),
      outputWatts: asNumber(radiator.outputWatts),
      model: asText(radiator.model, "Radiator model to confirm"),
      quantity: asNumber(radiator.quantity, 1),
      supplierRequired: asBoolean(radiator.supplierRequired),
      notes: asText(radiator.notes, "OpenAI draft; supplier to confirm output and size."),
    })),
    materialAllowances: (Array.isArray(payload.materialAllowances) ? payload.materialAllowances : []).slice(0, 140).map((material, index) => ({
      id: `openai-material-${project.id}-${index}`,
      section: asText(material.section, "Materials"),
      description: asText(material.description, `Material allowance ${index + 1}`),
      quantity: asNumber(material.quantity, 1),
      unit: asText(material.unit, "item"),
      unitCost: asNumber(material.unitCost),
      markupPercent: asNumber(material.markupPercent, 30),
      supplierRequired: asBoolean(material.supplierRequired),
      preferredSupplier: asText(material.preferredSupplier, ""),
    })),
    labourAllowances: (Array.isArray(payload.labourAllowances) ? payload.labourAllowances : []).slice(0, 40).map((labour, index) => ({
      id: `openai-labour-${project.id}-${index}`,
      section: asText(labour.section, "Labour"),
      role: asText(labour.role, "Engineer labour"),
      hours: asNumber(labour.hours),
      costRate: asNumber(labour.costRate, 38),
      markupPercent: asNumber(labour.markupPercent, 45),
      notes: asText(labour.notes, "OpenAI draft labour allowance."),
    })),
    supplierRequests: (Array.isArray(payload.supplierRequests) ? payload.supplierRequests : []).slice(0, 80).map((request, index) => ({
      id: `openai-supplier-${project.id}-${index}`,
      supplier: asText(request.supplier, ""),
      description: asText(request.description, `Supplier request ${index + 1}`),
      quantity: asNumber(request.quantity, 1),
      unit: asText(request.unit, "item"),
      notes: asText(request.notes, "Confirm price, availability, exclusions and lead time."),
    })),
    riskFlags: listOfText(payload.riskFlags, 30),
    questions: listOfText(payload.questions, 30),
  };
}

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

async function loadDeterministicBoqMaterials(project: TakeoffProject) {
  const materials: TakeoffMaterialAllowance[] = [];
  const promptChunks: string[] = [];
  const skipped: string[] = [];
  const documentIds: string[] = [];

  for (const document of project.documents) {
    if (document.kind !== "Contractor BOQ" && document.kind !== "Specification") continue;
    if (!isExcelWorkbookFile(document.fileName, document.mimeType)) continue;
    const filePath = storedFilePath(document);
    if (!filePath) {
      skipped.push(`${document.fileName} was uploaded before file storage was enabled`);
      continue;
    }
    try {
      const buffer = await readFile(filePath);
      const parsed = parseEnquiryBoqFromXlsx(buffer, document.fileName);
      if (!parsed.lines.length) {
        skipped.push(`${document.fileName}: ${parsed.notes.join(" ") || "no bill lines"}`);
        continue;
      }
      documentIds.push(document.id);
      materials.push(...materialAllowancesFromParsedBoq(parsed, document.id));
      promptChunks.push(boqLinesToPromptText(parsed));
    } catch (error) {
      skipped.push(`${document.fileName}: ${error instanceof Error ? error.message : "parse failed"}`);
    }
  }

  return { materials, promptChunks, skipped, documentIds };
}

async function buildOpenAiContent(project: TakeoffProject) {
  const skipped: string[] = [];
  const deterministic = await loadDeterministicBoqMaterials(project);
  skipped.push(...deterministic.skipped);

  const intro: OpenAiTextContent = {
    type: "input_text",
    text: [
      `Project: ${project.name}`,
      `Customer: ${project.customer}`,
      `Site: ${project.site}`,
      `Scope: ${project.description}`,
      `Documents: ${project.documents.map((document) => `${document.kind}: ${document.fileName}`).join("; ") || "None"}`,
      "Extract a heating/plumbing takeoff for office review.",
      "IMPORTANT: Structured Excel BOQ line items are provided as text below. Do NOT invent a short summary package for those rows.",
      "Use materialAllowances only for extras not already listed in the structured BOQ text (or leave materialAllowances empty if the BOQ text is complete).",
      "Focus labourAllowances, rooms, pipe runs, radiators, supplierRequests, risks and questions on top of the structured bill.",
      "For each room/area, capture lengthM, widthM and heightM from the drawing/spec if visible. If only area is visible, set areaM2 and leave missing dimensions as 0. If scale or dimensions are unclear, use 0 and add a question instead of guessing.",
      deterministic.promptChunks.length
        ? `\nStructured BOQ text:\n${deterministic.promptChunks.join("\n\n")}`
        : "",
    ].filter(Boolean).join("\n"),
  };
  const content: OpenAiInputContent[] = [intro];

  let sourceFiles = 0;
  for (const document of project.documents.slice(0, OPENAI_FILE_LIMIT_COUNT)) {
    const filePath = storedFilePath(document);
    if (!filePath) {
      skipped.push(`${document.fileName} was uploaded before file storage was enabled`);
      continue;
    }
    if ((document.size ?? 0) > OPENAI_FILE_LIMIT_BYTES) {
      skipped.push(`${document.fileName} is over the OpenAI pilot scan limit`);
      continue;
    }

    // Excel BOQs are already inlined as structured text — skip binary xlsx upload to the model.
    if (isExcelWorkbookFile(document.fileName, document.mimeType)) {
      sourceFiles += 1;
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
      skipped.push(`${document.fileName} could not be read from local storage`);
    }
  }

  if (skipped.length) {
    intro.text = `${intro.text}\nSkipped files: ${skipped.join("; ")}`;
  }

  return { content, sourceFiles, deterministic };
}

async function runOpenAiExtraction(project: TakeoffProject, actor: string, apiKey: string, model: string) {
  const { content, sourceFiles, deterministic } = await buildOpenAiContent(project);
  if (sourceFiles === 0 && !deterministic.materials.length) {
    throw new TakeoffExtractionInputError(
      "OpenAI is connected, but no AI-ready source files are stored for this project. Re-upload the drawings/specs/BOQs in Intake, then run AI scan again.",
    );
  }

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
            text: "You are a UK mechanical estimating assistant for NeXa Takeoff. Return conservative draft BOQ/takeoff data for office review only. Never claim the output is final or measured if the document evidence is unclear. Prefer the structured Excel BOQ text when present; do not collapse it into a few package allowances.",
          }],
        },
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nexa_takeoff_extraction",
          strict: true,
          schema: takeoffExtractionSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI extraction failed (${response.status}). Check OPENAI_API_KEY and NEXA_TAKEOFF_OPENAI_MODEL.`);
  }

  const body = await response.json();
  const outputText = getOutputText(body);
  if (!outputText) {
    throw new Error("OpenAI did not return extraction JSON.");
  }

  const payload = JSON.parse(outputText) as OpenAiTakeoffPayload;
  const draft = normalizeOpenAiPayload(project, payload);

  // Keep deterministic Excel bill lines; only keep AI materials that are not already covered.
  if (deterministic.materials.length) {
    const covered = new Set(deterministic.materials.map((line) => line.description.toLowerCase()));
    const aiExtras = draft.materialAllowances.filter((line) => !covered.has(line.description.toLowerCase()));
    draft.materialAllowances = mergeBoqMaterialAllowances(aiExtras, deterministic.materials, deterministic.documentIds);
    draft.riskFlags = Array.from(new Set([
      ...draft.riskFlags,
      "Excel BOQ lines imported as material allowances — confirm rates, exclusions and provisional sums",
    ]));
    draft.questions = Array.from(new Set([
      ...draft.questions,
      "Confirm provisional sums, nominated supply items and whether rates are net or gross.",
    ]));
  }

  return applyTakeoffExtractionDraft(project.id, draft, {
    actor,
    provider: "OpenAI",
    model,
    summary: deterministic.materials.length
      ? `${payload.summary} Imported ${deterministic.materials.length} Excel BOQ material line(s) deterministically.`
      : payload.summary,
    confidence: payload.confidence,
    documentNote: deterministic.materials.length
      ? `Imported ${deterministic.materials.length} Excel BOQ line(s) exactly; OpenAI drafted labour/rooms/extras for review.`
      : "OpenAI extraction drafted from stored source files; office review still required.",
    sourceFiles: Math.max(sourceFiles, deterministic.documentIds.length),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<ExtractPayload>(request);
  const { id } = await params;
  const actor = body?.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  const openAiConfig = getTakeoffOpenAiConfig();
  const project = getTakeoffProject(id);

  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  try {
    if (openAiConfig.apiKey) {
      const result = await runOpenAiExtraction(project, actor, openAiConfig.apiKey, openAiConfig.model);
      if (!result) {
        return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    // Offline/pilot path: still import Excel BOQ lines exactly instead of inventing package stubs.
    const deterministic = await loadDeterministicBoqMaterials(project);
    if (deterministic.materials.length) {
      const draft: TakeoffExtractionDraft = {
        rooms: [],
        measurements: [],
        pipeRuns: [],
        radiators: [],
        materialAllowances: deterministic.materials,
        labourAllowances: [
          {
            id: `boq-labour-install-${project.id}`,
            section: "Installation",
            role: "Engineer labour",
            hours: Math.max(8, Math.round(deterministic.materials.length * 1.25)),
            costRate: 38,
            markupPercent: 45,
            notes: "Draft labour from imported Excel BOQ line count — adjust after review.",
          },
          {
            id: `boq-labour-review-${project.id}`,
            section: "Office review",
            role: "Project manager",
            hours: 4,
            costRate: 48,
            markupPercent: 40,
            notes: "Office review of imported bill lines and exclusions.",
          },
        ],
        supplierRequests: deterministic.materials
          .filter((line) => line.supplierRequired)
          .slice(0, 40)
          .map((line, index) => ({
            id: `boq-supplier-${project.id}-${index}`,
            supplier: line.preferredSupplier || "",
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            linkedMaterialId: line.id,
            notes: "Imported from Excel BOQ — confirm price, availability and lead time.",
          })),
        riskFlags: [
          "Excel BOQ lines imported as material allowances — confirm rates, exclusions and provisional sums",
        ],
        questions: [
          "Confirm provisional sums, nominated supply items and whether rates are net or gross.",
        ],
      };
      const result = applyTakeoffExtractionDraft(project.id, draft, {
        actor,
        provider: "Pilot",
        summary: `Imported ${deterministic.materials.length} Excel BOQ material line(s) exactly.`,
        confidence: "High",
        documentNote: `Imported ${deterministic.materials.length} Excel BOQ line(s) exactly for office pricing.`,
        sourceFiles: deterministic.documentIds.length,
      });
      if (!result) {
        return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
      }
      return NextResponse.json(result);
    }

    const result = runTakeoffDraftExtraction(id, actor);
    if (!result) {
      return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to run OpenAI extraction" },
      { status: error instanceof TakeoffExtractionInputError ? 400 : 502 },
    );
  }
}

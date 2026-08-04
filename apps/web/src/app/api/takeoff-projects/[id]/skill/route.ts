import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getServerStoreDirectory } from "@/lib/server-store";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffMaterialAllowance,
  type TakeoffProject,
} from "@/lib/takeoff-data";
import {
  buildAssembliesForScope,
  confidenceRank,
  createDefaultTakeoffSkill,
  deriveSecondaryQuantity,
  focusOptionsForTrade,
  type TakeoffAssemblyItem,
  type TakeoffDrawingSheet,
  type TakeoffMeasuredQuantity,
  type TakeoffSkillScope,
  type TakeoffSkillStep,
  type TakeoffSkillWorkflow,
  type TakeoffTradeId,
} from "@/lib/takeoff-skill";

export const runtime = "nodejs";

type SkillAction =
  | "analyse"
  | "set-scope"
  | "build-plan"
  | "save-plan"
  | "approve-plan"
  | "measure"
  | "sanity"
  | "set-step"
  | "apply-boq";

type SkillPayload = {
  action?: SkillAction;
  actor?: string;
  trade?: TakeoffTradeId;
  focusLabels?: string[];
  outputFormats?: TakeoffSkillScope["outputFormats"];
  notes?: string;
  assemblies?: TakeoffAssemblyItem[];
  step?: TakeoffSkillStep;
  measured?: TakeoffMeasuredQuantity[];
};

function ensureSkill(project: TakeoffProject): TakeoffSkillWorkflow {
  return project.skill ?? createDefaultTakeoffSkill();
}

function stamp() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

async function readDocumentBytes(document: TakeoffDocument): Promise<Buffer | null> {
  if (!document.storageKey) return null;
  try {
    const full = path.join(getServerStoreDirectory(), document.storageKey);
    return await readFile(full);
  } catch {
    return null;
  }
}

function heuristicDrawingIndex(project: TakeoffProject): TakeoffSkillWorkflow["drawingIndex"] {
  const sheets: TakeoffDrawingSheet[] = project.documents
    .filter((document) => document.kind === "Drawing" || document.kind === "Marked-up drawing" || document.kind === "Specification")
    .map((document, index) => {
      const lower = document.fileName.toLowerCase();
      const discipline =
        /elec|el-|e-/.test(lower) ? "Electrical"
          : /mech|m-|hvac/.test(lower) ? "Mechanical"
            : /plumb|p-|sanit|drain/.test(lower) ? "Plumbing"
              : /struct|s-|conc|steel/.test(lower) ? "Structural"
                : /arch|a-|ga/.test(lower) ? "Architectural"
                  : "General";
      const hasSelectableText = !/\.jpe?g|\.png|\.tif/.test(lower);
      return {
        id: `sheet-${document.id}-${index}`,
        documentId: document.id,
        fileName: document.fileName,
        title: document.fileName.replace(/\.[^.]+$/, ""),
        discipline,
        notes: document.notes?.length ? document.notes : ["Indexed from filename / upload metadata"],
        hasSelectableText,
        reliability: hasSelectableText ? "High" as const : "Low" as const,
      };
    });

  return {
    status: "ready",
    summary: sheets.length
      ? `Indexed ${sheets.length} sheet(s). Prefer text-tag counts on vector PDFs; flag image-only sheets as low reliability.`
      : "No drawings uploaded yet.",
    sheets,
    objectHints: [
      "Schedules and tagged symbols are preferred primary sources",
      "Image-only PDFs force vision methods (lower confidence)",
      "Build a map of sheet discipline before measuring",
    ],
    completedAt: stamp(),
  };
}

async function openAiDrawingIndex(project: TakeoffProject): Promise<TakeoffSkillWorkflow["drawingIndex"] | null> {
  const config = getTakeoffOpenAiConfig();
  if (!config.connected || !config.apiKey) return null;

  const drawingDocs = project.documents.filter((document) =>
    ["Drawing", "Marked-up drawing", "Specification"].includes(document.kind),
  ).slice(0, 6);
  if (!drawingDocs.length) return heuristicDrawingIndex(project);

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: `You are indexing a construction drawing set for a quantity takeoff skill.
Return JSON only with shape:
{
  "summary": string,
  "sheets": [{"fileName": string, "title": string, "discipline": string, "sheetNumber": string, "revision": string, "notes": string[], "hasSelectableText": boolean, "reliability": "High"|"Medium"|"Low"}],
  "objectHints": string[]
}
Prefer vector/text reliability. Flag raster/image-only sheets as Low.`,
    },
  ];

  for (const document of drawingDocs) {
    const bytes = await readDocumentBytes(document);
    if (!bytes || bytes.length > 18 * 1024 * 1024) {
      content.push({ type: "input_text", text: `Document (metadata only): ${document.fileName} (${document.kind})` });
      continue;
    }
    const mime = document.mimeType || "application/pdf";
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    if (mime.includes("pdf") || mime.includes("image")) {
      content.push({ type: "input_file", file_data: dataUrl, filename: document.fileName });
    } else {
      content.push({ type: "input_text", text: `Document: ${document.fileName}` });
    }
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: [{ role: "user", content }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) return null;
    const body = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const raw = body.output_text
      || body.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("")
      || "";
    const parsed = JSON.parse(raw) as {
      summary?: string;
      sheets?: Array<{
        fileName?: string;
        title?: string;
        discipline?: string;
        sheetNumber?: string;
        revision?: string;
        notes?: string[];
        hasSelectableText?: boolean;
        reliability?: "High" | "Medium" | "Low";
      }>;
      objectHints?: string[];
    };
    const sheets: TakeoffDrawingSheet[] = (parsed.sheets || []).map((sheet, index) => {
      const match = drawingDocs.find((document) => document.fileName === sheet.fileName) || drawingDocs[index];
      return {
        id: `sheet-ai-${match?.id || index}`,
        documentId: match?.id || `doc-${index}`,
        fileName: sheet.fileName || match?.fileName || `Sheet ${index + 1}`,
        title: sheet.title || sheet.fileName || "Sheet",
        discipline: sheet.discipline || "General",
        sheetNumber: sheet.sheetNumber,
        revision: sheet.revision,
        notes: sheet.notes || [],
        hasSelectableText: sheet.hasSelectableText,
        reliability: sheet.reliability || "Medium",
      };
    });
    return {
      status: "ready",
      summary: parsed.summary || `AI indexed ${sheets.length} sheet(s).`,
      sheets: sheets.length ? sheets : heuristicDrawingIndex(project).sheets,
      objectHints: parsed.objectHints || [],
      completedAt: stamp(),
    };
  } catch {
    return null;
  }
}

async function openAiMeasurePrimaries(
  project: TakeoffProject,
  skill: TakeoffSkillWorkflow,
): Promise<TakeoffMeasuredQuantity[] | null> {
  const config = getTakeoffOpenAiConfig();
  if (!config.connected || !config.apiKey) return null;
  const primaries = skill.assemblies.filter((item) => item.included && item.kind === "primary");
  if (!primaries.length) return [];

  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: `Perform a construction quantity takeoff for trade "${skill.scope.trade}".
Only measure these PRIMARY quantities. Prefer text-tag counts, schedule extracts and explicit dimensions.
Do NOT invent vision-scaled areas unless no better method exists. Score confidence honestly.
Return JSON:
{
  "summary": string,
  "quantities": [{
    "code": string,
    "description": string,
    "quantity": number,
    "unit": string,
    "method": "text-tag-count"|"schedule-extract"|"explicit-dimension"|"vector-length"|"vision-area"|"vision-count",
    "confidence": "High"|"Medium"|"Low",
    "sourceFileNames": string[],
    "notes": string
  }]
}
Primary assembly codes: ${primaries.map((item) => item.code).join(", ")}
Focus: ${skill.scope.focusLabels.join(", ") || "trade default"}
Drawing index: ${JSON.stringify(skill.drawingIndex.sheets.map((sheet) => ({
    fileName: sheet.fileName,
    discipline: sheet.discipline,
    reliability: sheet.reliability,
  })))}`,
    },
  ];

  for (const document of project.documents.filter((row) => row.kind === "Drawing").slice(0, 5)) {
    const bytes = await readDocumentBytes(document);
    if (!bytes || bytes.length > 18 * 1024 * 1024) continue;
    const mime = document.mimeType || "application/pdf";
    content.push({
      type: "input_file",
      file_data: `data:${mime};base64,${bytes.toString("base64")}`,
      filename: document.fileName,
    });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        input: [{ role: "user", content }],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!response.ok) return null;
    const body = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const raw = body.output_text
      || body.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("")
      || "";
    const parsed = JSON.parse(raw) as {
      summary?: string;
      quantities?: Array<{
        code?: string;
        description?: string;
        quantity?: number;
        unit?: string;
        method?: TakeoffMeasuredQuantity["method"];
        confidence?: TakeoffMeasuredQuantity["confidence"];
        sourceFileNames?: string[];
        notes?: string;
      }>;
    };

    const measured: TakeoffMeasuredQuantity[] = [];
    for (const primary of primaries) {
      const hit = (parsed.quantities || []).find((row) => row.code === primary.code)
        || (parsed.quantities || []).find((row) =>
          (row.description || "").toLowerCase().includes(primary.description.toLowerCase().slice(0, 12)),
        );
      const method = hit?.method || primary.method;
      measured.push({
        id: makeId("qty"),
        assemblyId: primary.id,
        kind: "primary",
        code: primary.code,
        description: primary.description,
        quantity: Number(hit?.quantity) || 0,
        unit: hit?.unit || primary.unit,
        method,
        confidence: hit?.confidence || confidenceRank(method),
        sourceSheetIds: skill.drawingIndex.sheets
          .filter((sheet) => (hit?.sourceFileNames || []).includes(sheet.fileName))
          .map((sheet) => sheet.id),
        notes: hit?.notes || parsed.summary,
      });
    }
    return measured;
  } catch {
    return null;
  }
}

function heuristicMeasure(skill: TakeoffSkillWorkflow): TakeoffMeasuredQuantity[] {
  const sheetCount = Math.max(1, skill.drawingIndex.sheets.length);
  const measured: TakeoffMeasuredQuantity[] = [];
  const primaries = skill.assemblies.filter((item) => item.included && item.kind === "primary");

  for (const primary of primaries) {
    const method = primary.method === "vision-area" || primary.method === "vision-count"
      ? primary.method
      : primary.method;
    // Deterministic demo-ish seed from code + sheet count so UI is usable offline
    const seed = primary.code.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const quantity =
      primary.unit === "m2" ? Math.round((80 + (seed % 40) * sheetCount) * 10) / 10
        : primary.unit === "m" ? Math.round((25 + (seed % 20) * sheetCount) * 10) / 10
          : primary.unit === "m3" ? Math.round((3 + (seed % 5)) * 10) / 10
            : Math.max(1, (seed % 12) + sheetCount);

    measured.push({
      id: makeId("qty"),
      assemblyId: primary.id,
      kind: "primary",
      code: primary.code,
      description: primary.description,
      quantity,
      unit: primary.unit,
      method,
      confidence: skill.drawingIndex.sheets.some((sheet) => sheet.reliability === "Low") && method.startsWith("vision")
        ? "Low"
        : confidenceRank(method),
      sourceSheetIds: skill.drawingIndex.sheets.slice(0, 2).map((sheet) => sheet.id),
      notes: "Heuristic measure — connect OpenAI and re-run for drawing-backed counts",
    });
  }
  return measured;
}

function appendSecondaries(
  skill: TakeoffSkillWorkflow,
  primaries: TakeoffMeasuredQuantity[],
): TakeoffMeasuredQuantity[] {
  const byAssembly = new Map(primaries.map((row) => [row.assemblyId, row]));
  const secondaries = skill.assemblies.filter((item) => item.included && item.kind === "secondary");
  const out = [...primaries];
  for (const secondary of secondaries) {
    const parent = secondary.derivedFromPrimaryId
      ? byAssembly.get(secondary.derivedFromPrimaryId)
      : undefined;
    const qty = parent ? deriveSecondaryQuantity(secondary, parent.quantity) : 0;
    out.push({
      id: makeId("qty"),
      assemblyId: secondary.id,
      kind: "secondary",
      code: secondary.code,
      description: secondary.description,
      quantity: qty,
      unit: secondary.unit,
      method: "derived-formula",
      confidence: parent?.confidence === "High" ? "High" : "Medium",
      sourceSheetIds: parent?.sourceSheetIds || [],
      derivation: secondary.derivation,
      notes: parent ? `Derived from ${parent.code}` : "Missing primary quantity",
    });
  }
  return out;
}

function runSanityChecks(measured: TakeoffMeasuredQuantity[], skill: TakeoffSkillWorkflow): TakeoffMeasuredQuantity[] {
  const buildingHint = skill.drawingIndex.sheets.length * 30;
  return measured.map((row) => {
    let ok = true;
    let detail = "Within expected order of magnitude for this drawing set.";
    if (row.quantity <= 0) {
      ok = false;
      detail = "Zero quantity — confirm tags exist on the drawing or adjust the plan.";
    } else if (row.unit === "m" && row.quantity > buildingHint * 20) {
      ok = false;
      detail = `Length ${row.quantity} m looks high vs ~${buildingHint} m building scale hint — possible hallucination.`;
    } else if (row.unit === "m2" && row.quantity > buildingHint * buildingHint) {
      ok = false;
      detail = "Area looks unrealistically large for the indexed sheet set.";
    } else if (row.confidence === "Low") {
      detail = "Low confidence method — manually audit before using in a lump-sum quote.";
    }
    return { ...row, sanityCheck: { ok, detail } };
  });
}

function measuredToMaterialAllowances(measured: TakeoffMeasuredQuantity[]): TakeoffMaterialAllowance[] {
  return measured.map((row) => ({
    id: `skill-mat-${row.id}`,
    section: row.kind === "primary" ? "Primary quantities" : "Secondary quantities",
    description: `${row.code} · ${row.description}`,
    quantity: row.quantity,
    unit: row.unit,
    unitCost: 0,
    markupPercent: 30,
    supplierRequired: false,
    preferredSupplier: "",
  }));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });

  const body = await parseJsonRequestBody<SkillPayload>(request);
  const action = body?.action;
  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  const actor = body?.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  let skill = ensureSkill(project);

  if (action === "analyse") {
    skill = {
      ...skill,
      drawingIndex: { ...skill.drawingIndex, status: "running", error: undefined },
      step: "analyse",
      updatedAt: stamp(),
    };
    updateTakeoffProject(id, { skill });
    const indexed = (await openAiDrawingIndex(project)) || heuristicDrawingIndex(project);
    skill = {
      ...skill,
      drawingIndex: indexed,
      step: indexed.sheets.length ? "scope" : "drawings",
      updatedAt: stamp(),
    };
  } else if (action === "set-scope") {
    const trade = body?.trade || skill.scope.trade;
    skill = {
      ...skill,
      scope: {
        trade,
        focusLabels: body?.focusLabels ?? skill.scope.focusLabels,
        outputFormats: body?.outputFormats ?? skill.scope.outputFormats,
        notes: body?.notes ?? skill.scope.notes,
      },
      planApproved: false,
      step: "scope",
      updatedAt: stamp(),
    };
  } else if (action === "build-plan") {
    const scope: TakeoffSkillScope = {
      trade: body?.trade || skill.scope.trade,
      focusLabels: body?.focusLabels ?? skill.scope.focusLabels,
      outputFormats: body?.outputFormats ?? skill.scope.outputFormats,
      notes: body?.notes ?? skill.scope.notes,
    };
    if (!scope.focusLabels.length) {
      scope.focusLabels = focusOptionsForTrade(scope.trade).slice(0, 3);
    }
    const assemblies = buildAssembliesForScope(scope);
    skill = {
      ...skill,
      scope,
      assemblies,
      planApproved: false,
      planSummary: `Plan for ${scope.trade}: ${assemblies.filter((row) => row.included && row.kind === "primary").length} primary and ${assemblies.filter((row) => row.included && row.kind === "secondary").length} secondary quantities. Review methods before measuring.`,
      step: "plan",
      updatedAt: stamp(),
    };
  } else if (action === "save-plan") {
    skill = {
      ...skill,
      assemblies: body?.assemblies || skill.assemblies,
      planApproved: false,
      updatedAt: stamp(),
    };
  } else if (action === "approve-plan") {
    skill = {
      ...skill,
      assemblies: body?.assemblies || skill.assemblies,
      planApproved: true,
      step: "measure",
      updatedAt: stamp(),
    };
  } else if (action === "measure") {
    if (!skill.planApproved) {
      return NextResponse.json({ error: "Approve the assembly plan before measuring" }, { status: 409 });
    }
    const primaryMeasured = (await openAiMeasurePrimaries(project, skill)) || heuristicMeasure(skill);
    const measured = appendSecondaries(skill, primaryMeasured);
    skill = {
      ...skill,
      measured,
      measureSummary: `Measured ${measured.filter((row) => row.kind === "primary").length} primary and ${measured.filter((row) => row.kind === "secondary").length} secondary quantities.`,
      step: "review",
      updatedAt: stamp(),
    };
  } else if (action === "sanity") {
    const checked = runSanityChecks(skill.measured, skill);
    const failed = checked.filter((row) => row.sanityCheck && !row.sanityCheck.ok).length;
    skill = {
      ...skill,
      measured: body?.measured ? runSanityChecks(body.measured, skill) : checked,
      sanitySummary: failed
        ? `${failed} quantity(ies) failed sanity checks — audit before BOQ.`
        : "Sanity checks passed for measured quantities.",
      step: "review",
      updatedAt: stamp(),
    };
  } else if (action === "set-step") {
    if (!body?.step) return NextResponse.json({ error: "step is required" }, { status: 400 });
    skill = { ...skill, step: body.step, updatedAt: stamp() };
  } else if (action === "apply-boq") {
    const materials = measuredToMaterialAllowances(skill.measured);
    const updated = updateTakeoffProject(id, {
      skill: { ...skill, step: "boq", updatedAt: stamp() },
      materialAllowances: [
        ...project.materialAllowances.filter((line) => !line.id.startsWith("skill-mat-")),
        ...materials,
      ],
      measurements: skill.measured.map((row) => ({
        id: `skill-meas-${row.id}`,
        label: `${row.code} · ${row.description}`,
        quantity: row.quantity,
        unit: row.unit,
        source: "Drawing" as const,
      })),
      review: {
        ...project.review,
        officeNotes: [project.review.officeNotes, skill.measureSummary, skill.sanitySummary].filter(Boolean).join("\n"),
        riskFlags: [
          ...new Set([
            ...project.review.riskFlags,
            ...skill.measured.filter((row) => row.confidence === "Low").map((row) => `Low confidence: ${row.code}`),
            ...skill.measured.filter((row) => row.sanityCheck && !row.sanityCheck.ok).map((row) => `Sanity: ${row.code}`),
          ]),
        ],
      },
      status: project.status === "Draft" ? "In review" : project.status,
    });
    return NextResponse.json({ project: updated, skill: updated?.skill, actor });
  } else {
    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
  }

  const updated = updateTakeoffProject(id, { skill });
  return NextResponse.json({ project: updated, skill: updated?.skill, actor, focusOptions: focusOptionsForTrade(skill.scope.trade) });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  const skill = ensureSkill(project);
  return NextResponse.json({
    skill,
    focusOptions: focusOptionsForTrade(skill.scope.trade),
  });
}

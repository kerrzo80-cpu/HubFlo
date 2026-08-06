import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { readTakeoffDocumentBuffer } from "@/lib/takeoff-document-file";
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
  TAKEOFF_TRADES,
  type TakeoffAssemblyItem,
  type TakeoffDrawingSheet,
  type TakeoffMeasuredQuantity,
  type TakeoffSkillScope,
  type TakeoffSkillStep,
  type TakeoffSkillWorkflow,
  type TakeoffTradeId,
} from "@/lib/takeoff-skill";
import {
  countTextTagMatches,
  extractPdfDocument,
  inferDisciplineFromText,
  patternsForAssemblyCode,
} from "@/lib/takeoff-pdf-extract";

export const runtime = "nodejs";

type SkillAction =
  | "analyse"
  | "set-scope"
  | "build-plan"
  | "save-plan"
  | "approve-plan"
  | "measure"
  | "sanity"
  | "approve-overlay"
  | "set-step"
  | "apply-boq"
  | "invoke";

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
  prompt?: string;
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
  const file = await readTakeoffDocumentBuffer(document);
  return file.ok ? file.buffer : null;
}

async function pdfDrawingIndex(project: TakeoffProject): Promise<TakeoffSkillWorkflow["drawingIndex"]> {
  const sheets: TakeoffDrawingSheet[] = [];
  const objectHints = [
    "Prefer counting selectable text tags over vision/scaled measure",
    "Image-only / scanned PDFs are marked Low reliability",
    "Primary quantities first; derive secondary with formulas",
  ];

  for (const document of project.documents.filter((row) =>
    ["Drawing", "Marked-up drawing", "Specification"].includes(row.kind),
  )) {
    const bytes = await readDocumentBytes(document);
    const isPdf = (document.mimeType || "").includes("pdf") || document.fileName.toLowerCase().endsWith(".pdf");
    if (bytes && isPdf) {
      try {
        const extracted = await extractPdfDocument(bytes, document.fileName);
        for (const page of extracted.pages) {
          const discipline = inferDisciplineFromText(document.fileName, page.fullText.slice(0, 1200));
          sheets.push({
            id: `sheet-${document.id}-p${page.pageNumber}`,
            documentId: document.id,
            fileName: document.fileName,
            page: page.pageNumber,
            title: `${document.fileName.replace(/\.[^.]+$/, "")} · p${page.pageNumber}`,
            discipline,
            notes: [
              page.hasSelectableText
                ? `${page.textItems.length} text items extracted (vector/text layer)`
                : "Little/no selectable text — vision methods only",
            ],
            hasSelectableText: page.hasSelectableText,
            reliability: page.hasSelectableText ? "High" : "Low",
          });
        }
        continue;
      } catch {
        // fall through to metadata sheet
      }
    }

    const lower = document.fileName.toLowerCase();
    const hasSelectableText = !/\.jpe?g|\.png|\.tif/.test(lower);
    sheets.push({
      id: `sheet-${document.id}-1`,
      documentId: document.id,
      fileName: document.fileName,
      page: 1,
      title: document.fileName.replace(/\.[^.]+$/, ""),
      discipline: inferDisciplineFromText(document.fileName, ""),
      notes: ["Indexed from upload metadata (PDF text extract unavailable)"],
      hasSelectableText,
      reliability: hasSelectableText ? "Medium" : "Low",
    });
  }

  return {
    status: "ready",
    summary: sheets.length
      ? `Indexed ${sheets.length} sheet(s) from ${project.documents.length} file(s). Text-layer pages scored High for tag counting.`
      : "No drawings uploaded yet.",
    sheets,
    objectHints,
    completedAt: stamp(),
  };
}

function heuristicDrawingIndex(project: TakeoffProject): TakeoffSkillWorkflow["drawingIndex"] {
  // Kept as sync fallback if pdf extract path is not used.
  return {
    status: "ready",
    summary: "Metadata index only.",
    sheets: project.documents
      .filter((document) => ["Drawing", "Marked-up drawing", "Specification"].includes(document.kind))
      .map((document, index) => ({
        id: `sheet-${document.id}-${index}`,
        documentId: document.id,
        fileName: document.fileName,
        title: document.fileName.replace(/\.[^.]+$/, ""),
        discipline: inferDisciplineFromText(document.fileName, ""),
        notes: ["Indexed from filename / upload metadata"],
        hasSelectableText: !/\.jpe?g|\.png|\.tif/.test(document.fileName.toLowerCase()),
        reliability: (!/\.jpe?g|\.png|\.tif/.test(document.fileName.toLowerCase()) ? "Medium" : "Low") as "Medium" | "Low",
      })),
    objectHints: [],
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

function emptyPrimarySkeleton(
  skill: TakeoffSkillWorkflow,
  note = "Select this item, then click each instance on the drawing to count",
): TakeoffMeasuredQuantity[] {
  return skill.assemblies
    .filter((item) => item.included && item.kind === "primary")
    .map((primary) => ({
      id: makeId("qty"),
      assemblyId: primary.id,
      kind: "primary" as const,
      code: primary.code,
      description: primary.description,
      quantity: 0,
      unit: primary.unit,
      method: primary.method,
      confidence: "Low" as const,
      sourceSheetIds: [],
      tagMatches: [],
      notes: primary.unit === "nr"
        ? note
        : "Type the measured length/area in the takeoff board, or leave for office entry",
    }));
}

async function textTagMeasure(
  project: TakeoffProject,
  skill: TakeoffSkillWorkflow,
): Promise<TakeoffMeasuredQuantity[]> {
  const primaries = skill.assemblies.filter((item) => item.included && item.kind === "primary");
  if (!primaries.length) return [];

  const docs = project.documents.filter((document) =>
    document.kind === "Drawing"
    || document.kind === "Marked-up drawing"
    || (document.mimeType || "").includes("pdf")
    || document.fileName.toLowerCase().endsWith(".pdf"),
  );
  const extractedByDoc = new Map<string, Awaited<ReturnType<typeof extractPdfDocument>>>();
  for (const document of docs) {
    const bytes = await readDocumentBytes(document);
    if (!bytes) continue;
    if (!(document.mimeType || "").includes("pdf") && !document.fileName.toLowerCase().endsWith(".pdf")) continue;
    try {
      extractedByDoc.set(document.id, await extractPdfDocument(bytes, document.fileName));
    } catch {
      // skip unreadable pdf
    }
  }

  if (!extractedByDoc.size) {
    return emptyPrimarySkeleton(
      skill,
      "No readable PDF text layer — click each fixture on the drawing to count (PlanSwift-style)",
    );
  }

  const measured: TakeoffMeasuredQuantity[] = [];
  for (const primary of primaries) {
    const patterns = patternsForAssemblyCode(primary.code, primary.description);
    let total = 0;
    const tagMatches: NonNullable<TakeoffMeasuredQuantity["tagMatches"]> = [];
    const sourceSheetIds: string[] = [];

    for (const [documentId, extracted] of extractedByDoc.entries()) {
      if (!patterns.length) continue;
      const counted = countTextTagMatches(extracted.pages, patterns);
      total += counted.count;
      for (const match of counted.matches) {
        const page = extracted.pages.find((row) => row.pageNumber === match.pageNumber);
        tagMatches.push({
          id: makeId("pin"),
          documentId,
          fileName: extracted.fileName,
          pageNumber: match.pageNumber,
          text: match.text,
          x: match.x,
          y: match.y,
          pageWidth: page?.width,
          pageHeight: page?.height,
        });
        const sheet = skill.drawingIndex.sheets.find(
          (row) => row.documentId === documentId && row.page === match.pageNumber,
        );
        if (sheet && !sourceSheetIds.includes(sheet.id)) sourceSheetIds.push(sheet.id);
      }
    }

    const usedText = total > 0 && primary.unit === "nr";

    measured.push({
      id: makeId("qty"),
      assemblyId: primary.id,
      kind: "primary",
      code: primary.code,
      description: primary.description,
      quantity: usedText ? total : 0,
      unit: primary.unit,
      method: usedText ? "text-tag-count" : primary.method,
      confidence: usedText ? "High" : "Low",
      sourceSheetIds,
      tagMatches,
      notes: usedText
        ? `Suggested ${total} text-tag pin(s) — verify on the drawing, then save`
        : primary.unit === "nr"
          ? "No tags found — select this item and click each instance on the drawing"
          : "Enter metres / area manually in the takeoff board",
    });
  }

  // Provisional pipe/waste metres only as editable starting points when fixtures were found
  const pointCodes = new Set(["P-WC", "P-WHB", "P-BATH", "P-SHR", "P-SINK", "P-APPL"]);
  const points = measured
    .filter((row) => pointCodes.has(row.code))
    .reduce((sum, row) => sum + row.quantity, 0);
  for (const code of ["P-PIPE-H", "P-PIPE-C"] as const) {
    const pipeRow = measured.find((row) => row.code === code);
    if (pipeRow && pipeRow.quantity <= 0 && points > 0) {
      pipeRow.quantity = Math.round(points * 4 * 100) / 100;
      pipeRow.method = "derived-formula";
      pipeRow.confidence = "Low";
      pipeRow.notes = `Provisional ${points} × 4 m — edit this number after checking the drawing`;
    }
  }
  const wasteRow = measured.find((row) => row.code === "P-WASTE");
  if (wasteRow && wasteRow.quantity <= 0 && points > 0) {
    wasteRow.quantity = Math.round(points * 3 * 100) / 100;
    wasteRow.method = "derived-formula";
    wasteRow.confidence = "Low";
    wasteRow.notes = `Provisional ${points} × 3 m waste — edit after checking the drawing`;
  }

  return measured;
}

function parseInvokePrompt(prompt: string): { trade: TakeoffTradeId; focusLabels: string[] } {
  const lower = prompt.toLowerCase();
  let trade: TakeoffTradeId = "plumbing";
  for (const row of TAKEOFF_TRADES) {
    if (lower.includes(row.id) || lower.includes(row.label.toLowerCase().split(" ")[0]!)) {
      trade = row.id;
      break;
    }
  }
  if (/architect|floor area|slab area|room schedule/.test(lower)) trade = "architectural";
  if (/struct|footing|concrete|steel/.test(lower)) trade = "structural";
  if (/electric|lighting|socket|cable/.test(lower)) trade = "electrical";
  if (/heat|radiator|boiler/.test(lower)) trade = "heating";
  if (/plumb|sanitary|waste|hot.?cold/.test(lower)) trade = "plumbing";

  const options = focusOptionsForTrade(trade);
  const focusLabels = options.filter((label) => {
    const lowerLabel = label.toLowerCase();
    if (/sanitary|fittings|fixtures/.test(lower) && /wc|basin|bath|shower|sink|whb/.test(lowerLabel)) return true;
    if (/hot.?cold|pipe|outlet/.test(lower) && /pipe|fitting|hot|appliance|isolation/.test(lowerLabel)) return true;
    if (/waste|soil|svp/.test(lower) && /waste|soil/.test(lowerLabel)) return true;
    const token = lowerLabel.split(/[^a-z0-9]+/).find((part) => part.length >= 3) || "";
    return Boolean(token) && lower.includes(token);
  });
  return {
    trade,
    // Full trade schedule by default — never silently drop baths/showers/fittings
    focusLabels: focusLabels.length ? focusLabels : options,
  };
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
    const parentPins = (parent?.tagMatches || []).filter((match) => !match.excluded);
    const siblingIndex = secondaries
      .filter((item) => item.derivedFromPrimaryId === secondary.derivedFromPrimaryId)
      .findIndex((item) => item.code === secondary.code);
    const siblingCount = Math.max(
      1,
      secondaries.filter((item) => item.derivedFromPrimaryId === secondary.derivedFromPrimaryId).length,
    );
    const perParent = parent && parent.quantity > 0
      ? Math.max(1, Math.round(qty / parent.quantity))
      : 1;
    const tagMatches = parent && secondary.unit === "nr" && parentPins.length
      ? parentPins.flatMap((pin, pinIndex) =>
          Array.from({ length: perParent }, (_, copyIndex) => {
            const angle = ((siblingIndex + 1) / (siblingCount + 1)) * Math.PI * 2
              + pinIndex * 0.15
              + copyIndex * 0.35;
            const radius = 16 + siblingIndex * 2 + copyIndex * 4;
            return {
              id: makeId("pin"),
              documentId: pin.documentId,
              fileName: pin.fileName,
              pageNumber: pin.pageNumber,
              text: secondary.code.replace(/^P-/, ""),
              x: pin.x + Math.cos(angle) * radius,
              y: pin.y + Math.sin(angle) * radius,
              pageWidth: pin.pageWidth,
              pageHeight: pin.pageHeight,
              derived: true as const,
            };
          }),
        )
      : undefined;
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
      tagMatches,
      notes: parent
        ? `Derived from ${parent.code}${tagMatches?.length ? ` · ${tagMatches.length} overlay pin(s)` : ""}`
        : "Missing primary quantity",
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
    const indexed = (await pdfDrawingIndex(project)) || (await openAiDrawingIndex(project)) || heuristicDrawingIndex(project);
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
      scope.focusLabels = focusOptionsForTrade(scope.trade);
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
    // Drawing-first: text tags become suggested pins. Never invent fake heuristic quantities.
    const primaryMeasured = await textTagMeasure(project, skill);
    const pinCount = primaryMeasured.reduce(
      (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
      0,
    );
    const measured = appendSecondaries(skill, primaryMeasured);
    skill = {
      ...skill,
      measured,
      measureSummary: pinCount
        ? `Takeoff board ready — ${pinCount} suggested pin(s) from PDF text. Verify on the drawing, click to add missing items, then save.`
        : "Takeoff board ready — no text tags found. Select each fixture type and click every instance on the drawing (PlanSwift-style).",
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
  } else if (action === "approve-overlay") {
    // Office edited overlay pins (move / add / remove) — recount and re-derive where needed
    const incoming = body?.measured || skill.measured;
    const byAssemblyId = new Map(incoming.map((row) => [row.assemblyId, row]));
    const primaries = incoming
      .filter((row) => row.kind === "primary")
      .map((row) => {
        const activeMatches = (row.tagMatches || []).filter((match) => !match.excluded);
        const quantity = row.unit === "nr" && (row.tagMatches?.length || 0) > 0
          ? activeMatches.length
          : row.quantity;
        return {
          ...row,
          quantity,
          tagMatches: row.tagMatches,
          notes: row.tagMatches?.length
            ? `Overlay: ${activeMatches.length} active pin(s) of ${row.tagMatches.length}`
            : row.notes,
        };
      });

    // Keep secondary overlay edits when present; otherwise re-derive from primaries
    const primaryByAssembly = new Map(primaries.map((row) => [row.assemblyId, row]));
    const secondaries = skill.assemblies
      .filter((item) => item.included && item.kind === "secondary")
      .map((secondary) => {
        const existing = byAssemblyId.get(secondary.id);
        const parent = secondary.derivedFromPrimaryId
          ? primaryByAssembly.get(secondary.derivedFromPrimaryId)
          : undefined;
        const activePins = (existing?.tagMatches || []).filter((match) => !match.excluded);
        const derivedQty = parent ? deriveSecondaryQuantity(secondary, parent.quantity) : 0;
        const quantity = secondary.unit === "nr" && (existing?.tagMatches?.length || 0) > 0
          ? activePins.length
          : derivedQty;
        return {
          id: existing?.id || makeId("qty"),
          assemblyId: secondary.id,
          kind: "secondary" as const,
          code: secondary.code,
          description: secondary.description,
          quantity,
          unit: secondary.unit,
          method: "derived-formula" as const,
          confidence: (parent?.confidence === "High" ? "High" : "Medium") as TakeoffMeasuredQuantity["confidence"],
          sourceSheetIds: parent?.sourceSheetIds || existing?.sourceSheetIds || [],
          derivation: secondary.derivation,
          tagMatches: existing?.tagMatches,
          notes: existing?.tagMatches?.length
            ? `Overlay: ${activePins.length} pin(s)`
            : parent
              ? `Derived from ${parent.code}`
              : "Missing primary quantity",
        };
      });

    const measured = runSanityChecks([...primaries, ...secondaries], skill);
    const pinCount = measured.reduce(
      (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
      0,
    );
    skill = {
      ...skill,
      measured,
      measureSummary: `Overlay saved — ${pinCount} active pin(s) across ${measured.length} line items.`,
      sanitySummary: measured.some((row) => row.sanityCheck && !row.sanityCheck.ok)
        ? "Some quantities still need attention after overlay edits."
        : "Overlay edits saved — sanity checks passed.",
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
  } else if (action === "invoke") {
    const prompt = (body?.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    const parsed = parseInvokePrompt(prompt);
    const indexed = await pdfDrawingIndex(project);
    const scope: TakeoffSkillScope = {
      trade: parsed.trade,
      focusLabels: parsed.focusLabels,
      outputFormats: ["excel-boq", "marked-pdf", "quote-push"],
      notes: prompt,
    };
    const assemblies = buildAssembliesForScope(scope);
    skill = {
      ...skill,
      drawingIndex: indexed,
      scope,
      assemblies,
      planApproved: false,
      planSummary: `Invoked: “${prompt}”. Planned ${assemblies.filter((row) => row.included && row.kind === "primary").length} primary / ${assemblies.filter((row) => row.included && row.kind === "secondary").length} secondary for ${parsed.trade}. Approve before measuring.`,
      measured: [],
      measureSummary: "",
      sanitySummary: "",
      step: "plan",
      updatedAt: stamp(),
    };
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

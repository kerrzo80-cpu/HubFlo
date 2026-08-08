import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { readTakeoffDocumentBuffer } from "@/lib/takeoff-document-file";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffProject,
} from "@/lib/takeoff-data";
import {
  discoverCommonFixtureTags,
  extractPdfDocument,
  pdfTextDiagnostics,
  type ExtractedPdfDocument,
  type ExtractedPdfPage,
} from "@/lib/takeoff-pdf-extract";
import {
  extractPdfStrokeRuns,
  summariseStrokeRunsByRole,
  type PdfStrokeRun,
} from "@/lib/takeoff-pdf-strokes";
import { buildAssembliesForScope, focusOptionsForTrade, type TakeoffTradeId } from "@/lib/takeoff-skill";
import {
  applyScaleHintsToStudio,
  createDefaultStudioState,
  importPipeRunsIntoStudio,
  importSkillCountsIntoStudio,
  polylineLength,
  scaleForPage,
  studioHasAiPipeRuns,
} from "@/lib/takeoff-studio";
import { POST as skillPost } from "../skill/route";

export const runtime = "nodejs";

type MeasuredRow = {
  id: string;
  kind: "primary" | "secondary";
  code: string;
  description: string;
  unit: string;
  quantity?: number;
  method?: string;
  confidence?: string;
  notes?: string;
  tagMatches?: Array<{
    id: string;
    documentId: string;
    pageNumber: number;
    x: number;
    y: number;
    pageWidth?: number;
    pageHeight?: number;
    excluded?: boolean;
  }>;
};

type ClientExtract = {
  documentId: string;
  fileName: string;
  pages: ExtractedPdfPage[];
};

type BlakeRunBody = {
  clientExtracts?: ClientExtract[];
};

function skillRequest(request: NextRequest, id: string, body: Record<string, unknown>) {
  return new NextRequest(new URL(`/api/takeoff-projects/${id}/skill`, request.url), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
}

async function skillJson(request: NextRequest, id: string, body: Record<string, unknown>) {
  const response = await skillPost(skillRequest(request, id, body), { params: Promise.resolve({ id }) });
  const json = await response.json().catch(() => ({})) as {
    error?: string;
    skill?: {
      assemblies?: Array<{ id: string; included: boolean }>;
      drawingIndex?: {
        sheets?: Array<{ discipline?: string; hasSelectableText?: boolean }>;
      };
      measured?: MeasuredRow[];
    };
  };
  if (!response.ok) {
    throw new Error(json.error || `Blake step failed (${response.status})`);
  }
  return json;
}

function tradeFromSheets(sheets: Array<{ discipline?: string }> | undefined): TakeoffTradeId {
  const votes = new Map<TakeoffTradeId, number>();
  for (const sheet of sheets || []) {
    const discipline = (sheet.discipline || "").toLowerCase();
    let trade: TakeoffTradeId = "plumbing";
    if (discipline.includes("elec")) trade = "electrical";
    else if (discipline.includes("mech") || discipline.includes("heat")) trade = "mechanical";
    else if (discipline.includes("struct")) trade = "structural";
    else if (discipline.includes("arch")) trade = "architectural";
    else if (discipline.includes("civil") || discipline.includes("drain")) trade = "civil";
    else if (discipline.includes("plumb")) trade = "plumbing";
    votes.set(trade, (votes.get(trade) || 0) + 1);
  }
  let best: TakeoffTradeId = "plumbing";
  let bestCount = 0;
  for (const [trade, count] of votes.entries()) {
    if (count > bestCount) {
      best = trade;
      bestCount = count;
    }
  }
  return best;
}

function pinCountOf(measured: MeasuredRow[]) {
  return measured.reduce(
    (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
    0,
  );
}

function measuredFromExtracts(
  extracts: Array<{ documentId: string; fileName: string; pages: ExtractedPdfPage[] }>,
): {
  measured: MeasuredRow[];
  diagnostics: {
    textItemCount: number;
    hasSelectableText: boolean;
    sample: string;
    docsRead: number;
    docsMissing: number;
    docsExtractFailed: number;
    source: "client" | "server";
  };
} {
  let textItemCount = 0;
  let hasSelectableText = false;
  let sample = "";
  const byCode = new Map<string, MeasuredRow>();

  for (const extract of extracts) {
    const diagnostics = pdfTextDiagnostics(extract.pages);
    textItemCount += diagnostics.textItemCount;
    hasSelectableText = hasSelectableText || diagnostics.hasSelectableText;
    if (!sample && diagnostics.sample) sample = diagnostics.sample;

    for (const group of discoverCommonFixtureTags(extract.pages)) {
      const existing = byCode.get(group.code) || {
        id: `blake-fallback-${group.code}`,
        kind: "primary" as const,
        code: group.code,
        description: group.description,
        unit: "nr",
        tagMatches: [],
      };
      for (const match of group.matches) {
        const page = extract.pages.find((row) => row.pageNumber === match.pageNumber);
        existing.tagMatches = existing.tagMatches || [];
        existing.tagMatches.push({
          id: `blake-pin-${extract.documentId}-${group.code}-${match.pageNumber}-${Math.round(match.x)}-${Math.round(match.y)}`,
          documentId: extract.documentId,
          pageNumber: match.pageNumber,
          x: match.x,
          y: match.y,
          pageWidth: page?.width,
          pageHeight: page?.height,
        });
      }
      byCode.set(group.code, existing);
    }
  }

  return {
    measured: [...byCode.values()],
    diagnostics: {
      textItemCount,
      hasSelectableText,
      sample,
      docsRead: extracts.length,
      docsMissing: 0,
      docsExtractFailed: 0,
      source: "client",
    },
  };
}

async function serverDiscoverPins(project: TakeoffProject) {
  const drawings = project.documents.filter((doc) =>
    doc.kind === "Drawing"
    || doc.kind === "Marked-up drawing"
    || (doc.mimeType || "").includes("pdf")
    || doc.fileName.toLowerCase().endsWith(".pdf"),
  );

  let textItemCount = 0;
  let hasSelectableText = false;
  let sample = "";
  let docsRead = 0;
  let docsMissing = 0;
  let docsExtractFailed = 0;
  const extracts: Array<{ documentId: string; fileName: string; pages: ExtractedPdfPage[] }> = [];

  for (const document of drawings) {
    const file = await readTakeoffDocumentBuffer(document);
    if (!file.ok) {
      docsMissing += 1;
      continue;
    }
    try {
      const extracted: ExtractedPdfDocument = await extractPdfDocument(file.buffer, document.fileName);
      docsRead += 1;
      extracts.push({
        documentId: document.id,
        fileName: document.fileName,
        pages: extracted.pages,
      });
      const diagnostics = pdfTextDiagnostics(extracted.pages);
      textItemCount += diagnostics.textItemCount;
      hasSelectableText = hasSelectableText || diagnostics.hasSelectableText;
      if (!sample && diagnostics.sample) sample = diagnostics.sample;
    } catch {
      docsExtractFailed += 1;
    }
  }

  const fromExtracts = measuredFromExtracts(extracts);
  return {
    measured: fromExtracts.measured,
    diagnostics: {
      textItemCount,
      hasSelectableText,
      sample,
      docsRead,
      docsMissing,
      docsExtractFailed,
      source: "server" as const,
    },
  };
}

function emptyMessage(
  diagnostics: {
    textItemCount: number;
    hasSelectableText: boolean;
    sample: string;
    docsRead: number;
    docsMissing: number;
    docsExtractFailed: number;
  },
  strokeInfo?: { colouredStrokeCount: number; runCount: number },
) {
  if (diagnostics.docsRead === 0 && diagnostics.docsMissing > 0 && diagnostics.docsExtractFailed === 0) {
    return "Blake found the drawing on the project, but the PDF file is missing from disk. Re-upload the PDF (files can drop after a host restart), then ask Blake again.";
  }
  if (diagnostics.docsRead === 0 && diagnostics.docsExtractFailed > 0) {
    return "Blake could not read this PDF on the server. Keep the drawing open in Studio and try Ask Blake again. For pipe runs: set scale, then use Length to trace the coloured lines.";
  }
  if (diagnostics.docsRead === 0) {
    return "Blake could not open any drawing PDFs. Re-upload a PDF, make sure it opens on the canvas, then ask Blake again.";
  }
  if (strokeInfo && strokeInfo.colouredStrokeCount > 0 && strokeInfo.runCount === 0) {
    return "Blake saw coloured lines but they look like boxes/grid rather than pipe runs. Set scale, pick Hot/Cold pipe, and use Length to trace the run.";
  }
  if (!diagnostics.hasSelectableText || diagnostics.textItemCount < 8) {
    return "This PDF looks scanned or image-only (no text layer and no coloured vector pipe strokes Blake can measure). Set scale, then use Length to trace pipe runs, or Count to tap fixtures.";
  }
  return `Blake read ${diagnostics.textItemCount} text item(s) but found no fixture tags (WC/WHB/RAD) and no coloured vector pipe runs. Set scale, then use Length on the green/red pipe lines, or Count for fixtures.`;
}

async function serverExtractPipeRuns(project: TakeoffProject) {
  const drawings = project.documents.filter((doc) =>
    doc.kind === "Drawing"
    || doc.kind === "Marked-up drawing"
    || (doc.mimeType || "").includes("pdf")
    || doc.fileName.toLowerCase().endsWith(".pdf"),
  );
  const runs: Array<PdfStrokeRun & { documentId: string }> = [];
  let colouredStrokeCount = 0;
  let docsTried = 0;

  for (const document of drawings.slice(0, 4)) {
    const file = await readTakeoffDocumentBuffer(document);
    if (!file.ok) continue;
    docsTried += 1;
    try {
      const extracted = await extractPdfStrokeRuns(file.buffer, document.fileName, { maxPages: 4 });
      colouredStrokeCount += extracted.colouredStrokeCount;
      for (const run of extracted.runs) {
        runs.push({ ...run, documentId: document.id });
      }
    } catch {
      // keep going — text path may still work
    }
  }

  return {
    runs,
    colouredStrokeCount,
    docsTried,
    summary: summariseStrokeRunsByRole(runs),
  };
}

function pipeMetresFromStudio(
  studio: ReturnType<typeof createDefaultStudioState>,
  role: "hot" | "cold" | "waste",
) {
  const classId = role === "hot" ? "cls-ai-P-PIPE-H" : role === "cold" ? "cls-ai-P-PIPE-C" : "cls-ai-P-WASTE";
  let metres = 0;
  let pieces = 0;
  for (const geo of studio.geometries) {
    if (geo.kind !== "linear" || geo.classificationId !== classId) continue;
    const scale = scaleForPage(studio, geo.documentId, geo.page);
    const mpu = scale?.metresPerUnit || 0;
    metres += polylineLength(geo.points) * mpu;
    pieces += 1;
  }
  return { metres: Math.round(metres * 100) / 100, pieces };
}

function mergePipeMeasuredRows(
  measured: MeasuredRow[],
  studio: ReturnType<typeof createDefaultStudioState>,
): MeasuredRow[] {
  const next = measured.map((row) => ({ ...row }));
  const specs = [
    { code: "P-PIPE-H", description: "Hot pipe runs", role: "hot" as const },
    { code: "P-PIPE-C", description: "Cold pipe runs", role: "cold" as const },
    { code: "P-WASTE", description: "Waste / soil runs", role: "waste" as const },
  ];
  for (const spec of specs) {
    const { metres, pieces } = pipeMetresFromStudio(studio, spec.role);
    if (metres <= 0 || pieces <= 0) continue;
    const existing = next.find((row) => row.code === spec.code);
    const notes = `Blake traced ${pieces} coloured vector run(s) on the drawing — verify scale and trim overlaps.`;
    if (existing) {
      existing.quantity = metres;
      existing.unit = "m";
      existing.method = "vector-length";
      existing.confidence = "Medium";
      existing.notes = notes;
    } else {
      next.push({
        id: `blake-pipe-${spec.code}`,
        kind: "primary",
        code: spec.code,
        description: spec.description,
        unit: "m",
        quantity: metres,
        method: "vector-length",
        confidence: "Medium",
        notes,
        tagMatches: [],
      });
    }
  }
  return next;
}

function normalizeClientExtracts(raw: ClientExtract[] | undefined): ClientExtract[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => row && typeof row.documentId === "string" && Array.isArray(row.pages))
    .map((row) => ({
      documentId: row.documentId,
      fileName: String(row.fileName || "drawing.pdf"),
      pages: row.pages.map((page, index) => ({
        pageNumber: Number(page.pageNumber) || index + 1,
        width: Number(page.width) || 1,
        height: Number(page.height) || 1,
        textItems: Array.isArray(page.textItems)
          ? page.textItems
            .filter((item) => item && typeof item.text === "string")
            .map((item) => ({
              text: String(item.text),
              x: Number(item.x) || 0,
              y: Number(item.y) || 0,
              width: Number(item.width) || 6,
              height: Number(item.height) || 10,
            }))
          : [],
        fullText: String(page.fullText || ""),
        hasSelectableText: Boolean(page.hasSelectableText),
      })),
    }))
    .filter((row) => row.pages.length);
}

/** One-shot Blake button: analyse → plan → measure → Studio pins. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const project = getTakeoffProject(id);
  if (!project) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  const drawings = project.documents.filter((doc) =>
    doc.kind === "Drawing"
    || doc.kind === "Marked-up drawing"
    || (doc.mimeType || "").includes("pdf")
    || doc.fileName.toLowerCase().endsWith(".pdf"),
  );
  if (!drawings.length) {
    return NextResponse.json({ error: "Upload a PDF drawing before asking Blake." }, { status: 400 });
  }

  const actor = request.headers.get(employeeHeaderName) || "Blake";
  const body = await parseJsonRequestBody<BlakeRunBody>(request);
  const clientExtracts = normalizeClientExtracts(body?.clientExtracts);

  try {
    const analysed = await skillJson(request, id, { action: "analyse", actor });
    const trade = tradeFromSheets(analysed.skill?.drawingIndex?.sheets);
    await skillJson(request, id, {
      action: "set-scope",
      actor,
      trade,
      focusLabels: focusOptionsForTrade(trade),
    });
    const plan = await skillJson(request, id, { action: "build-plan", actor, trade });
    const assemblies = plan.skill?.assemblies || buildAssembliesForScope({
      trade,
      focusLabels: focusOptionsForTrade(trade),
      outputFormats: ["excel-boq", "marked-pdf", "quote-push"],
      notes: "",
    });
    await skillJson(request, id, { action: "approve-plan", actor, assemblies });
    const measuredRes = await skillJson(request, id, { action: "measure", actor });
    let measured = measuredRes.skill?.measured || [];
    let pinCount = pinCountOf(measured);
    let usedFallback = false;
    let diagnostics = {
      textItemCount: 0,
      hasSelectableText: Boolean(analysed.skill?.drawingIndex?.sheets?.some((sheet) => sheet.hasSelectableText)),
      sample: "",
      docsRead: 0,
      docsMissing: 0,
      docsExtractFailed: 0,
      source: "server" as "client" | "server",
    };

    if (pinCount === 0 && clientExtracts.length) {
      const fromClient = measuredFromExtracts(clientExtracts);
      diagnostics = fromClient.diagnostics;
      if (pinCountOf(fromClient.measured) > 0) {
        measured = fromClient.measured;
        pinCount = pinCountOf(measured);
        usedFallback = true;
      }
    }

    if (pinCount === 0) {
      const fallback = await serverDiscoverPins(getTakeoffProject(id) || project);
      if (pinCountOf(fallback.measured) > 0) {
        measured = fallback.measured;
        pinCount = pinCountOf(measured);
        usedFallback = true;
        diagnostics = fallback.diagnostics;
      } else if (!clientExtracts.length || diagnostics.docsRead === 0) {
        diagnostics = fallback.diagnostics;
      }
    }

    const pipeExtract = await serverExtractPipeRuns(getTakeoffProject(id) || project);
    const latest = getTakeoffProject(id) || project;
    const baseStudio = latest.studio ?? createDefaultStudioState();

    // Auto-apply scale from sheet text so pipe metres resolve.
    const scalePages = [
      ...clientExtracts.flatMap((extract) =>
        extract.pages.map((page) => ({
          documentId: extract.documentId,
          pageNumber: page.pageNumber,
          fullText: page.fullText,
        })),
      ),
    ];
    if (!scalePages.length) {
      for (const document of drawings.slice(0, 2)) {
        const file = await readTakeoffDocumentBuffer(document);
        if (!file.ok) continue;
        try {
          const extracted = await extractPdfDocument(file.buffer, document.fileName);
          for (const page of extracted.pages) {
            scalePages.push({
              documentId: document.id,
              pageNumber: page.pageNumber,
              fullText: page.fullText,
            });
          }
        } catch {
          // ignore
        }
      }
    }
    const scaled = applyScaleHintsToStudio(baseStudio, scalePages);

    let nextStudio = importSkillCountsIntoStudio(
      {
        ...scaled.studio,
        aiReviewStatus: undefined,
        aiReviewMeasured: undefined,
      },
      measured,
      { replaceExistingAi: true, aiReviewStatus: pinCount > 0 ? "pending" : undefined },
    );

    if (pipeExtract.runs.length) {
      nextStudio = importPipeRunsIntoStudio(
        nextStudio,
        pipeExtract.runs.map((run) => ({
          documentId: run.documentId,
          pageNumber: run.pageNumber,
          points: run.points,
          role: run.role,
          pageHeight: run.pageHeight,
          colourHex: run.colourHex,
        })),
        { replaceExistingAiPipes: true, aiReviewStatus: "pending", renderScale: 1.35 },
      );
      measured = mergePipeMeasuredRows(measured, nextStudio);
    }

    const pipeRunCount = nextStudio.geometries.filter((geo) => geo.kind === "linear" && geo.id.startsWith("ai-pipe-")).length;
    const useful = pinCount > 0 || pipeRunCount > 0;
    const reviewStatus = useful ? "pending" as const : undefined;
    nextStudio = {
      ...nextStudio,
      aiReviewStatus: reviewStatus,
      aiReviewMeasured: useful ? measured : undefined,
      aiReviewUpdatedAt: useful ? new Date().toISOString() : nextStudio.aiReviewUpdatedAt,
    };

    if (!nextStudio.activeDocumentId) {
      nextStudio.activeDocumentId = drawings[0]?.id || baseStudio.activeDocumentId;
    }
    nextStudio.tool = "select";
    nextStudio.updatedAt = new Date().toISOString();

    const updated = updateTakeoffProject(id, { studio: nextStudio });
    const firstAi = nextStudio.geometries.find((geo) => geo.id.startsWith("ai-"));
    const hot = pipeMetresFromStudio(nextStudio, "hot");
    const cold = pipeMetresFromStudio(nextStudio, "cold");
    const waste = pipeMetresFromStudio(nextStudio, "waste");

    let message = emptyMessage(diagnostics, {
      colouredStrokeCount: pipeExtract.colouredStrokeCount,
      runCount: pipeRunCount,
    });
    if (useful) {
      const bits = [
        pinCount > 0 ? `${pinCount} fixture pin(s)` : null,
        pipeRunCount > 0
          ? `${pipeRunCount} pipe run(s)${
              hot.metres + cold.metres + waste.metres > 0
                ? ` · ~${(hot.metres + cold.metres + waste.metres).toFixed(1)} m`
                : ""
            }`
          : null,
        scaled.appliedLabel ? `scale ${scaled.appliedLabel}` : null,
        !scaled.appliedLabel && pipeRunCount > 0 ? "set scale to lock metres" : null,
      ].filter(Boolean);
      message = `Blake found ${bits.join(" · ")}. Review on the sheet${studioHasAiPipeRuns(nextStudio) ? " — trim/extend runs if needed" : ""}.`;
    }

    return NextResponse.json({
      ok: true,
      project: updated,
      measured,
      pinCount,
      pipeRunCount,
      pipeSummary: {
        ...pipeExtract.summary,
        hotMetres: hot.metres,
        coldMetres: cold.metres,
        wasteMetres: waste.metres,
        scaleLabel: scaled.appliedLabel,
      },
      trade,
      usedFallback,
      diagnostics,
      focus: firstAi
        ? { documentId: firstAi.documentId, page: firstAi.page, classificationId: firstAi.classificationId }
        : null,
      message,
      actor,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Blake could not finish the takeoff.",
    }, { status: 500 });
  }
}

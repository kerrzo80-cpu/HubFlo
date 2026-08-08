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
import {
  buildAssembliesForScope,
  focusOptionsForTrade,
  type TakeoffConfidence,
  type TakeoffMeasureMethod,
  type TakeoffTradeId,
} from "@/lib/takeoff-skill";
import {
  applyScaleHintsToStudio,
  createDefaultStudioState,
  importPipeRunsIntoStudio,
  importSkillCountsIntoStudio,
  metresPerUnitFromRatio,
  parseScaleRatioLabel,
  polylineLength,
  scaleForPage,
  studioHasAiPipeRuns,
} from "@/lib/takeoff-studio";
import {
  applyLearningToMeasuredRows,
  takeoffLearningPreferences,
} from "@/lib/takeoff-learning-store";
import { POST as skillPost } from "../skill/route";

export const runtime = "nodejs";

type MeasuredRow = {
  id: string;
  kind: "primary" | "secondary";
  code: string;
  description: string;
  unit: string;
  quantity?: number;
  method?: TakeoffMeasureMethod;
  confidence?: TakeoffConfidence;
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

type ClientStrokeRun = {
  pageNumber?: number;
  points?: Array<{ x?: number; y?: number }>;
  lengthPdfUnits?: number;
  colourHex?: string;
  role?: "hot" | "cold" | "waste" | "other";
  pageWidth?: number;
  pageHeight?: number;
};

type BlakeRunBody = {
  clientExtracts?: ClientExtract[];
  clientStrokeRuns?: Array<{
    documentId?: string;
    fileName?: string;
    runs?: ClientStrokeRun[];
    colouredStrokeCount?: number;
  }>;
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

function tradeFromSheets(sheets: Array<{ discipline?: string }> | undefined): {
  trade: TakeoffTradeId;
  voteCount: number;
} {
  const votes = new Map<TakeoffTradeId, number>();
  for (const sheet of sheets || []) {
    const discipline = (sheet.discipline || "").toLowerCase();
    if (!discipline.trim()) continue;
    let trade: TakeoffTradeId = "plumbing";
    if (discipline.includes("elec")) trade = "electrical";
    else if (discipline.includes("heat")) trade = "heating";
    else if (discipline.includes("mech")) trade = "mechanical";
    else if (discipline.includes("struct")) trade = "structural";
    else if (discipline.includes("arch")) trade = "architectural";
    else if (discipline.includes("civil") || discipline.includes("drain")) trade = "civil";
    else if (discipline.includes("plumb")) trade = "plumbing";
    else continue;
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
  return { trade: best, voteCount: bestCount };
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
  if (strokeInfo && strokeInfo.colouredStrokeCount > 0 && strokeInfo.runCount === 0) {
    return "Blake saw coloured lines but they look like boxes/grid rather than pipe runs. Set scale, pick Hot/Cold pipe, and use Length to trace the run.";
  }
  if (diagnostics.docsRead === 0 && diagnostics.docsMissing > 0 && diagnostics.docsExtractFailed === 0) {
    return "Blake found the drawing on the project, but the PDF file is missing from disk. Re-upload the PDF (files can drop after a host restart), then ask Blake again.";
  }
  if (diagnostics.docsRead === 0 && diagnostics.docsExtractFailed > 0) {
    return "Blake opened the sheet but could not auto-measure pipe vectors on it yet. Tap a Draw as colour (Cold/Hot/Heating), then Length — or Ask Blake again after the drawing has fully loaded.";
  }
  if (diagnostics.docsRead === 0) {
    return "Blake could not open any drawing PDFs. Keep the sheet open until it finishes loading, tap Ask Blake again, or re-upload the PDF.";
  }
  if (!diagnostics.hasSelectableText || diagnostics.textItemCount < 8) {
    return "This PDF looks scanned or image-only (no text layer and no coloured vector pipe strokes Blake can measure). Tap Draw as → Cold/Hot/Heating, set scale, then Length — or Count for fixtures.";
  }
  return `Blake read ${diagnostics.textItemCount} text item(s) but found no fixture tags (WC/WHB/RAD) and no coloured vector pipe runs. Tap Draw as to pick Cold/Hot/Heating, then Length — or Count for fixtures.`;
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
  const clientPipeRuns = (Array.isArray(body?.clientStrokeRuns) ? body!.clientStrokeRuns : [])
    .flatMap((doc) => {
      const documentId = String(doc?.documentId || "");
      if (!documentId) return [];
      return (Array.isArray(doc.runs) ? doc.runs : [])
        .filter((run) => run && (run.role === "hot" || run.role === "cold" || run.role === "waste"))
        .map((run) => ({
          documentId,
          pageNumber: Number(run.pageNumber) || 1,
          points: (Array.isArray(run.points) ? run.points : [])
            .map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
          role: run.role as "hot" | "cold" | "waste",
          pageWidth: Number(run.pageWidth) || 1,
          pageHeight: Number(run.pageHeight) || 1,
          colourHex: typeof run.colourHex === "string" ? run.colourHex : "#000000",
          lengthPdfUnits: Number(run.lengthPdfUnits) || 0,
        }))
        .filter((run) => run.points.length >= 2);
    });
  const clientColouredStrokeCount = (Array.isArray(body?.clientStrokeRuns) ? body!.clientStrokeRuns : [])
    .reduce((sum, doc) => sum + (Number(doc?.colouredStrokeCount) || 0), 0);

  try {
    const learning = takeoffLearningPreferences();
    let trade: TakeoffTradeId = learning.defaultTrade || "plumbing";
    let measured: MeasuredRow[] = [];
    let pinCount = 0;
    let usedFallback = false;
    let diagnostics = {
      textItemCount: 0,
      hasSelectableText: false,
      sample: "",
      docsRead: 0,
      docsMissing: 0,
      docsExtractFailed: 0,
      source: "server" as "client" | "server",
    };

    // Prefer client extracts first on phones — server PDF parse often fails while Studio shows the sheet.
    if (clientExtracts.length) {
      const fromClient = measuredFromExtracts(clientExtracts);
      diagnostics = fromClient.diagnostics;
      measured = fromClient.measured;
      pinCount = pinCountOf(measured);
      usedFallback = pinCount > 0;
    }

    try {
      const analysed = await skillJson(request, id, { action: "analyse", actor });
      const sheetTrade = tradeFromSheets(analysed.skill?.drawingIndex?.sheets);
      trade = sheetTrade.voteCount > 0
        ? sheetTrade.trade
        : (learning.defaultTrade || sheetTrade.trade);
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
      const skillMeasured = measuredRes.skill?.measured || [];
      if (pinCountOf(skillMeasured) > pinCount) {
        measured = skillMeasured;
        pinCount = pinCountOf(measured);
        usedFallback = false;
      }
      diagnostics = {
        ...diagnostics,
        hasSelectableText: diagnostics.hasSelectableText
          || Boolean(analysed.skill?.drawingIndex?.sheets?.some((sheet) => sheet.hasSelectableText)),
      };
    } catch {
      // Client-only path still useful when skill/server PDF parse fails.
      trade = learning.defaultTrade || "plumbing";
    }

    measured = applyLearningToMeasuredRows(measured, learning);
    pinCount = pinCountOf(measured);

    if (pinCount === 0) {
      const fallback = await serverDiscoverPins(getTakeoffProject(id) || project);
      if (pinCountOf(fallback.measured) > 0) {
        measured = fallback.measured;
        pinCount = pinCountOf(measured);
        usedFallback = true;
        diagnostics = fallback.diagnostics;
      } else if (!clientExtracts.length && diagnostics.docsRead === 0) {
        diagnostics = fallback.diagnostics;
      }
    }

    let pipeExtract = {
      runs: clientPipeRuns as Array<PdfStrokeRun & { documentId: string }>,
      colouredStrokeCount: clientColouredStrokeCount,
      docsTried: clientPipeRuns.length || clientColouredStrokeCount ? 1 : 0,
      summary: summariseStrokeRunsByRole(clientPipeRuns),
    };

    // Client opened the same PDF Studio is showing — count that as a successful read.
    if (clientExtracts.length || clientPipeRuns.length || clientColouredStrokeCount > 0) {
      diagnostics = {
        ...diagnostics,
        docsRead: Math.max(diagnostics.docsRead, clientExtracts.length || 1),
        docsExtractFailed: clientExtracts.length || clientPipeRuns.length ? 0 : diagnostics.docsExtractFailed,
      };
    }

    if (!pipeExtract.runs.length) {
      pipeExtract = await serverExtractPipeRuns(getTakeoffProject(id) || project);
    }
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
    let scaled = applyScaleHintsToStudio(baseStudio, scalePages);
    // Fall back to the scale ratio this workspace usually picks.
    if (!scaled.appliedLabel && learning.preferredScaleLabel) {
      const denom = parseScaleRatioLabel(learning.preferredScaleLabel);
      const mpu = denom != null ? metresPerUnitFromRatio(denom, 1.35) : null;
      if (mpu != null) {
        const docId = drawings[0]?.id || baseStudio.activeDocumentId;
        const page = baseStudio.activePage || 1;
        if (docId) {
          const scales = [
            ...scaled.studio.scales.filter((row) => !(row.documentId === docId && row.page === page)),
            {
              documentId: docId,
              page,
              metresPerUnit: mpu,
              label: learning.preferredScaleLabel,
            },
          ];
          scaled = {
            studio: { ...scaled.studio, scales },
            appliedLabel: `${learning.preferredScaleLabel} (usual)`,
          };
        }
      }
    }

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
    if (!baseStudio.activePipeSpecId && learning.defaultPipeSpecId) {
      nextStudio.activePipeSpecId = learning.defaultPipeSpecId;
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
        learning.eventCount >= 2 ? "using your takeoff habits" : null,
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
      learning: {
        eventCount: learning.eventCount,
        defaultPipeSpecId: learning.defaultPipeSpecId,
        defaultTrade: learning.defaultTrade,
        summary: learning.summary,
      },
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

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { getServerStoreDirectory } from "@/lib/server-store";
import {
  getTakeoffProject,
  updateTakeoffProject,
  type TakeoffDocument,
  type TakeoffProject,
} from "@/lib/takeoff-data";
import {
  discoverCommonFixtureTags,
  extractPdfDocument,
  pdfTextDiagnostics,
} from "@/lib/takeoff-pdf-extract";
import { buildAssembliesForScope, focusOptionsForTrade, type TakeoffTradeId } from "@/lib/takeoff-skill";
import {
  createDefaultStudioState,
  importSkillCountsIntoStudio,
} from "@/lib/takeoff-studio";
import { POST as skillPost } from "../skill/route";

export const runtime = "nodejs";

type MeasuredRow = {
  id: string;
  kind: "primary" | "secondary";
  code: string;
  description: string;
  unit: string;
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

async function readDocumentBytes(document: TakeoffDocument): Promise<Buffer | null> {
  if (!document.storageKey) return null;
  try {
    return await readFile(path.join(getServerStoreDirectory(), document.storageKey));
  } catch {
    return null;
  }
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

async function fallbackDiscoverPins(project: TakeoffProject): Promise<{
  measured: MeasuredRow[];
  diagnostics: { textItemCount: number; hasSelectableText: boolean; sample: string; docsRead: number };
}> {
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
  const byCode = new Map<string, MeasuredRow>();

  for (const document of drawings) {
    const bytes = await readDocumentBytes(document);
    if (!bytes) continue;
    try {
      const extracted = await extractPdfDocument(bytes, document.fileName);
      docsRead += 1;
      const diagnostics = pdfTextDiagnostics(extracted.pages);
      textItemCount += diagnostics.textItemCount;
      hasSelectableText = hasSelectableText || diagnostics.hasSelectableText;
      if (!sample && diagnostics.sample) sample = diagnostics.sample;

      for (const group of discoverCommonFixtureTags(extracted.pages)) {
        const existing = byCode.get(group.code) || {
          id: `blake-fallback-${group.code}`,
          kind: "primary" as const,
          code: group.code,
          description: group.description,
          unit: "nr",
          tagMatches: [],
        };
        for (const match of group.matches) {
          const page = extracted.pages.find((row) => row.pageNumber === match.pageNumber);
          existing.tagMatches = existing.tagMatches || [];
          existing.tagMatches.push({
            id: `blake-pin-${document.id}-${group.code}-${match.pageNumber}-${Math.round(match.x)}-${Math.round(match.y)}`,
            documentId: document.id,
            pageNumber: match.pageNumber,
            x: match.x,
            y: match.y,
            pageWidth: page?.width,
            pageHeight: page?.height,
          });
        }
        byCode.set(group.code, existing);
      }
    } catch {
      // skip unreadable PDF
    }
  }

  return {
    measured: [...byCode.values()],
    diagnostics: { textItemCount, hasSelectableText, sample, docsRead },
  };
}

function emptyMessage(diagnostics: {
  textItemCount: number;
  hasSelectableText: boolean;
  sample: string;
  docsRead: number;
}) {
  if (!diagnostics.docsRead) {
    return "Blake could not read the uploaded PDF from storage. Re-upload the drawing, then try Ask Blake again.";
  }
  if (!diagnostics.hasSelectableText || diagnostics.textItemCount < 8) {
    return "This PDF looks scanned or image-only (no useful text layer). Export/save as a vector PDF with text, or use Count and tap each fixture.";
  }
  return `Blake read ${diagnostics.textItemCount} text item(s) but found no WC/WHB/RAD/socket-style tags. Use Count to tap fixtures, or check the legend codes on the sheet.`;
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
      docsRead: drawings.length,
    };

    if (pinCount === 0) {
      const fallback = await fallbackDiscoverPins(getTakeoffProject(id) || project);
      diagnostics = fallback.diagnostics;
      if (pinCountOf(fallback.measured) > 0) {
        measured = fallback.measured;
        pinCount = pinCountOf(measured);
        usedFallback = true;
      }
    }

    const latest = getTakeoffProject(id) || project;
    const baseStudio = latest.studio ?? createDefaultStudioState();
    const nextStudio = importSkillCountsIntoStudio(baseStudio, measured, { replaceExistingAi: true });
    if (!nextStudio.activeDocumentId) {
      nextStudio.activeDocumentId = drawings[0]?.id || baseStudio.activeDocumentId;
    }
    nextStudio.tool = "select";
    nextStudio.updatedAt = new Date().toISOString();

    const updated = updateTakeoffProject(id, { studio: nextStudio });
    const firstPin = nextStudio.geometries.find((geo) => geo.id.startsWith("ai-"));
    return NextResponse.json({
      ok: true,
      project: updated,
      pinCount,
      trade,
      usedFallback,
      diagnostics,
      focus: firstPin
        ? { documentId: firstPin.documentId, page: firstPin.page, classificationId: firstPin.classificationId }
        : null,
      message: pinCount
        ? `Blake placed ${pinCount} count pin(s)${usedFallback ? " (broad tag search)" : ""} using ${trade} scope.`
        : emptyMessage(diagnostics),
      actor,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Blake could not finish the takeoff.",
    }, { status: 500 });
  }
}

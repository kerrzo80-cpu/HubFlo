import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { getTakeoffProject, updateTakeoffProject } from "@/lib/takeoff-data";
import { buildAssembliesForScope, focusOptionsForTrade } from "@/lib/takeoff-skill";
import {
  createDefaultStudioState,
  importSkillCountsIntoStudio,
} from "@/lib/takeoff-studio";
import { POST as skillPost } from "../skill/route";

export const runtime = "nodejs";

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
      measured?: Array<{
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
      }>;
    };
  };
  if (!response.ok) {
    throw new Error(json.error || `Blake step failed (${response.status})`);
  }
  return json;
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
    await skillJson(request, id, { action: "analyse", actor });
    await skillJson(request, id, {
      action: "set-scope",
      actor,
      trade: "plumbing",
      focusLabels: focusOptionsForTrade("plumbing"),
    });
    const plan = await skillJson(request, id, { action: "build-plan", actor, trade: "plumbing" });
    const assemblies = plan.skill?.assemblies || buildAssembliesForScope({
      trade: "plumbing",
      focusLabels: focusOptionsForTrade("plumbing"),
      outputFormats: ["excel-boq", "marked-pdf", "quote-push"],
      notes: "",
    });
    await skillJson(request, id, { action: "approve-plan", actor, assemblies });
    const measuredRes = await skillJson(request, id, { action: "measure", actor });
    const measured = measuredRes.skill?.measured || [];
    const pinCount = measured.reduce(
      (sum, row) => sum + (row.tagMatches || []).filter((match) => !match.excluded).length,
      0,
    );

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
      focus: firstPin
        ? { documentId: firstPin.documentId, page: firstPin.page, classificationId: firstPin.classificationId }
        : null,
      message: pinCount
        ? `Blake placed ${pinCount} count pin(s) on the drawing.`
        : "Blake finished but found no PDF text tags. Use Count and tap each fixture.",
      actor,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Blake could not finish the takeoff.",
    }, { status: 500 });
  }
}

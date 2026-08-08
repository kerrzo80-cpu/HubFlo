import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { getTakeoffProject, updateTakeoffProject } from "@/lib/takeoff-data";
import {
  applyBlakeProposal,
  type BlakeEmitterMode,
  type BlakePlantKind,
} from "@/lib/takeoff-blake-propose";
import { createDefaultStudioState } from "@/lib/takeoff-studio";

export const runtime = "nodejs";

type ProposeBody = {
  plantKind?: BlakePlantKind;
  emitterMode?: BlakeEmitterMode;
  includeCylinder?: boolean;
  documentId?: string;
  page?: number;
  pageWidth?: number;
  pageHeight?: number;
  plantPoint?: { x: number; y: number };
  pipeSpecId?: string;
  actor?: string;
};

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

  const body = (await parseJsonRequestBody<ProposeBody>(request)) || {};
  const plantKind: BlakePlantKind = body.plantKind === "ashp" ? "ashp" : "boiler";
  const emitterMode: BlakeEmitterMode =
    body.emitterMode === "ufh" || body.emitterMode === "mixed" ? body.emitterMode : "radiators";
  const includeCylinder = Boolean(body.includeCylinder) || plantKind === "ashp";

  const studio = project.studio ?? createDefaultStudioState();
  const drawings = (project.documents || []).filter(
    (doc) => doc.kind === "Drawing" || doc.kind === "Marked-up drawing" || (doc.mimeType || "").includes("pdf"),
  );
  const documentId = body.documentId || studio.activeDocumentId || drawings[0]?.id;
  if (!documentId) {
    return NextResponse.json({ error: "Upload a drawing before asking Blake to propose routes." }, { status: 400 });
  }

  const page = Math.max(1, Number(body.page) || studio.activePage || 1);
  const pageWidth = Math.max(100, Number(body.pageWidth) || 1200);
  const pageHeight = Math.max(100, Number(body.pageHeight) || 850);
  const plantPoint =
    body.plantPoint
    && Number.isFinite(body.plantPoint.x)
    && Number.isFinite(body.plantPoint.y)
      ? { x: body.plantPoint.x, y: body.plantPoint.y }
      : undefined;

  const result = applyBlakeProposal(studio, {
    plantKind,
    emitterMode,
    includeCylinder,
    documentId,
    page,
    pageWidth,
    pageHeight,
    plantPoint,
    pipeSpecId: body.pipeSpecId || studio.activePipeSpecId,
    replaceExistingProposal: true,
  });

  const updated = updateTakeoffProject(id, { studio: result.studio });
  const actor =
    body.actor?.trim()
    || request.headers.get(employeeHeaderName)
    || "Office";

  try {
    appendAuditEvent({
      actor,
      action: "blake_propose",
      recordType: "takeoff_project",
      recordId: id,
      summary: `Blake propose · ${plantKind} · ${emitterMode} · ${result.routeCount} route(s)`,
      source: "takeoff add-on",
      importance: "high",
    });
  } catch {
    // Audit must never block propose.
  }

  return NextResponse.json({
    ok: true,
    project: updated,
    summary: result.summary,
    equipment: result.equipment,
    routeCount: result.routeCount,
    questions: result.questions,
    actor,
  });
}

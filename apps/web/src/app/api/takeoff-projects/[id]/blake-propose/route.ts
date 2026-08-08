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
import { proposeTakeoffPlacementWithAi } from "@/lib/takeoff-blake-propose-ai";
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
  message?: string;
  /** Optional page screenshot (data URL) for drawing-aware placement. */
  pageImageDataUrl?: string;
  /** Skip OpenAI and use rule stubs only. */
  rulesOnly?: boolean;
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
  let plantKind: BlakePlantKind = body.plantKind === "ashp" ? "ashp" : "boiler";
  let emitterMode: BlakeEmitterMode =
    body.emitterMode === "ufh" || body.emitterMode === "mixed" ? body.emitterMode : "radiators";
  let includeCylinder = Boolean(body.includeCylinder) || plantKind === "ashp";

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
  let plantPoint =
    body.plantPoint
    && Number.isFinite(body.plantPoint.x)
    && Number.isFinite(body.plantPoint.y)
      ? { x: body.plantPoint.x, y: body.plantPoint.y }
      : undefined;

  let aiNarrative: string | undefined;
  let aiQuestions: string[] | undefined;
  let emitterPoints: { x: number; y: number }[] | undefined;
  let aiUsed = false;
  let aiConnected = false;
  let aiError: string | undefined;
  let aiModel: string | undefined;

  if (!body.rulesOnly) {
    const placement = await proposeTakeoffPlacementWithAi({
      plantKind,
      emitterMode,
      includeCylinder,
      pageWidth,
      pageHeight,
      plantPoint,
      projectName: project.name,
      site: project.site,
      description: project.description,
      message: body.message,
      existingPinCount: (studio.geometries || []).filter((geo) => geo.page === page).length,
      pageImageDataUrl: body.pageImageDataUrl,
    });
    aiUsed = placement.aiUsed;
    aiConnected = placement.connected;
    aiError = placement.error;
    aiModel = placement.model;
    aiNarrative = placement.narrative || undefined;
    aiQuestions = placement.questions;
    plantKind = placement.plantKind;
    emitterMode = placement.emitterMode;
    includeCylinder = placement.includeCylinder;
    if (placement.plantPoint) plantPoint = placement.plantPoint;
    if (placement.emitterPoints.length) emitterPoints = placement.emitterPoints;
  }

  const result = applyBlakeProposal(studio, {
    plantKind,
    emitterMode,
    includeCylinder,
    documentId,
    page,
    pageWidth,
    pageHeight,
    plantPoint,
    emitterPoints,
    pipeSpecId: body.pipeSpecId || studio.activePipeSpecId,
    replaceExistingProposal: true,
    aiNarrative,
    aiQuestions,
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
      summary: `Blake propose${aiUsed ? " (AI)" : " (rules)"} · ${plantKind} · ${emitterMode} · ${result.routeCount} route(s)`,
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
    aiUsed,
    connected: aiConnected,
    model: aiModel,
    error: aiError,
    actor,
  });
}

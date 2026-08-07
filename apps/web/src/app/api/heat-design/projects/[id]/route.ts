import { NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, canReadSurveys } from "@/lib/survey-api";
import {
  deleteHeatDesignProject,
  getHeatDesignProject,
  saveHeatDesignProject,
} from "@/lib/heat-design-store";
import type { HeatDesignProject } from "@/lib/heat-design";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const project = getHeatDesignProject(id);
  return project ? NextResponse.json(project) : NextResponse.json({ error: "Heat design project not found" }, { status: 404 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<Partial<HeatDesignProject>>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { id } = await params;
  return NextResponse.json(saveHeatDesignProject({ ...body, id }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  return deleteHeatDesignProject(id)
    ? NextResponse.json({ ok: true, deleted: { id } })
    : NextResponse.json({ error: "Heat design project not found" }, { status: 404 });
}

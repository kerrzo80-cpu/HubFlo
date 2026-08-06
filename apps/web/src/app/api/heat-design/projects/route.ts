import { NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, canReadSurveys } from "@/lib/survey-api";
import {
  createHeatDesignProject,
  listHeatDesignProjects,
} from "@/lib/heat-design-store";
import type { HeatDesignProject } from "@/lib/heat-design";

export async function GET(request: Request) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(listHeatDesignProjects());
}

export async function POST(request: Request) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<Partial<HeatDesignProject>>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  return NextResponse.json(createHeatDesignProject(body), { status: 201 });
}

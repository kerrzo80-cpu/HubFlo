import { NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, surveyRequestContext } from "@/lib/survey-api";
import { completeSurvey } from "@/lib/survey-estimator-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<{ expectedVersion?: number }>(request);
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const result = completeSurvey(tenantId, id, body?.expectedVersion, actor);
  if (result.ok) return NextResponse.json({ survey: result.value, review: result.review });
  const status = result.reason === "not_found" ? 404 : result.reason === "version_conflict" ? 409 : 422;
  return NextResponse.json({ error: result.message, reason: result.reason, current: result.current, review: result.review }, { status });
}

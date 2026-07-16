import { NextResponse } from "next/server";
import type { SurveyRecord } from "@hubflo/domain";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, canReadSurveys, surveyRequestContext, versionedMutationResponse } from "@/lib/survey-api";
import { getSurvey, updateSurvey } from "@/lib/survey-estimator-store";

type UpdateSurveyBody = {
  expectedVersion?: number;
  patch?: Partial<SurveyRecord>;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  const { id } = await params;
  const survey = getSurvey(tenantId, id);
  return survey ? NextResponse.json(survey) : NextResponse.json({ error: "Survey not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<UpdateSurveyBody>(request);
  if (!body?.patch) return NextResponse.json({ error: "Include a survey patch." }, { status: 400 });
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  return versionedMutationResponse(updateSurvey(tenantId, id, body.patch, body.expectedVersion, actor));
}

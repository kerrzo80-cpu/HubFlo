import { NextResponse } from "next/server";
import type { SurveyRecord } from "@hubflo/domain";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, canReadSurveys, surveyRequestContext, versionedMutationResponse } from "@/lib/survey-api";
import { archiveSurvey, deleteSurvey, getSurvey, updateSurvey } from "@/lib/survey-estimator-store";

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

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const mode = new URL(request.url).searchParams.get("mode") || "archive";
  const expectedVersion = Number(new URL(request.url).searchParams.get("expectedVersion"));

  if (mode === "delete") {
    const result = deleteSurvey(tenantId, id, actor);
    if (!result.ok) {
      return NextResponse.json({ error: result.message || "Unable to delete survey." }, { status: result.reason === "not_found" ? 404 : 422 });
    }
    return NextResponse.json({ ok: true, deleted: result.value });
  }

  const result = archiveSurvey(
    tenantId,
    id,
    Number.isInteger(expectedVersion) ? expectedVersion : undefined,
    actor,
  );
  return versionedMutationResponse(result);
}

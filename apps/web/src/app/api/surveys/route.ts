import { NextResponse } from "next/server";
import type { SurveyRecord } from "@hubflo/domain";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { createSurvey, getSurveys } from "@/lib/survey-estimator-store";

type CreateSurveyBody = Partial<SurveyRecord> & { clientMutationId?: string };

export async function GET(request: Request) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  return NextResponse.json(getSurveys(tenantId));
}

export async function POST(request: Request) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<CreateSurveyBody>(request);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { clientMutationId, ...input } = body;
  const context = surveyRequestContext(request);
  return NextResponse.json(createSurvey(input, context, clientMutationId), { status: 201 });
}

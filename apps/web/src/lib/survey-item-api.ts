import { NextResponse } from "next/server";
import type {
  SurveyEquipmentItem,
  SurveyPhoto,
  SurveyPipeRun,
  SurveyRoom,
  SurveyScopeItem,
} from "@hubflo/domain";

import { parseJsonRequestBody } from "@/lib/http";
import { canManageSurveys, surveyRequestContext, versionedMutationResponse } from "@/lib/survey-api";
import { upsertSurveyItem, type RepeatableSurveyKey } from "@/lib/survey-estimator-store";

type SurveyItem = SurveyScopeItem | SurveyPipeRun | SurveyEquipmentItem | SurveyRoom | SurveyPhoto;

export async function handleSurveyItemPost(
  request: Request,
  surveyId: string,
  key: RepeatableSurveyKey,
) {
  if (!canManageSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<{ expectedVersion?: number; item?: SurveyItem }>(request);
  if (!body?.item || typeof body.item !== "object") {
    return NextResponse.json({ error: "Include the survey item to save." }, { status: 400 });
  }
  const item = { ...body.item, id: body.item.id || `${key}-${crypto.randomUUID()}` } as SurveyItem;
  const { tenantId, actor } = surveyRequestContext(request);
  return versionedMutationResponse(
    upsertSurveyItem(tenantId, surveyId, key, item, body.expectedVersion, actor),
    201,
  );
}

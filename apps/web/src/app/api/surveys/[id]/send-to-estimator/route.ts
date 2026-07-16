import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { surveyRequestContext, versionedMutationResponse } from "@/lib/survey-api";
import { sendSurveyToEstimator } from "@/lib/survey-estimator-store";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<{ expectedVersion?: number }>(request);
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  return versionedMutationResponse(sendSurveyToEstimator(tenantId, id, body?.expectedVersion, actor));
}

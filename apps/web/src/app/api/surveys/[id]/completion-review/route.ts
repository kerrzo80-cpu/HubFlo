import { NextResponse } from "next/server";

import { canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getSurveyCompletionReview } from "@/lib/survey-estimator-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  const { id } = await params;
  const review = getSurveyCompletionReview(tenantId, id);
  return review ? NextResponse.json(review) : NextResponse.json({ error: "Survey not found" }, { status: 404 });
}

import { NextResponse } from "next/server";

import { canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getEstimates } from "@/lib/survey-estimator-store";

export async function GET(request: Request) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  return NextResponse.json(getEstimates(tenantId));
}

import { NextResponse } from "next/server";

import { createSurveyPdf } from "@/lib/survey-pdf";
import { canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getEstimate, getSurvey, getSurveyCompletionReview } from "@/lib/survey-estimator-store";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  const { id } = await params;
  const survey = getSurvey(tenantId, id);
  if (!survey) return NextResponse.json({ error: "Survey not found" }, { status: 404 });
  const review = getSurveyCompletionReview(tenantId, survey.id);
  if (!review) return NextResponse.json({ error: "Survey review unavailable" }, { status: 422 });
  const estimate = survey.estimateId ? getEstimate(tenantId, survey.estimateId) : undefined;
  const bytes = await createSurveyPdf(survey, review, estimate);
  const fileName = `${survey.reference}-${survey.customerName || "site-survey"}`.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

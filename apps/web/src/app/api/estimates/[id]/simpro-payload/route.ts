import { NextResponse } from "next/server";

import { canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getEstimate, getSurvey } from "@/lib/survey-estimator-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  const { id } = await params;
  const estimate = getEstimate(tenantId, id);
  if (!estimate) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  const survey = getSurvey(tenantId, estimate.surveyId);
  const costCentreNames = Array.from(new Set([...estimate.materialLines.map((line) => line.costCentre), ...estimate.labourLines.map((line) => line.costCentre)]));
  return NextResponse.json({
    source: "nexa-estimator",
    estimate: { id: estimate.id, reference: estimate.reference, version: estimate.version, pricingProfile: estimate.pricingProfile },
    survey: { id: survey?.id, reference: survey?.reference, customer: survey?.customerName, site: survey?.siteAddress, jobLink: survey?.jobLink },
    costCentres: costCentreNames.map((name) => ({
      name,
      simproId: estimate.simproMappings.costCentres[name],
      materials: estimate.materialLines.filter((line) => line.costCentre === name),
      labour: estimate.labourLines.filter((line) => line.costCentre === name).map((line) => ({ ...line, simproLabourTypeId: estimate.simproMappings.labourTypes[line.labourType] })),
    })),
    assumptions: estimate.assumptions,
    exclusions: estimate.exclusions,
    risks: estimate.riskNotes,
  }, {
    headers: { "Content-Disposition": `attachment; filename="${estimate.reference}-simpro-ready.json"`, "Cache-Control": "private, no-store" },
  });
}

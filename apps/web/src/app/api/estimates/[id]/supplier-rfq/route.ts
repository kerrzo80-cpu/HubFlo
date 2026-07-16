import { NextResponse } from "next/server";

import { canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { getEstimate, getSurvey } from "@/lib/survey-estimator-store";

function csv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  const { id } = await params;
  const estimate = getEstimate(tenantId, id);
  if (!estimate) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  const survey = getSurvey(tenantId, estimate.surveyId);
  const lines = estimate.materialLines.filter((line) => line.status === "Supplier RFQ" || line.unitCost === undefined);
  const rows = [
    ["Estimate", "Survey", "Customer", "Site", "Cost centre", "Description", "Quantity", "Unit", "Supplier", "Source", "Confirmation required"],
    ...lines.map((line) => [estimate.reference, survey?.reference || estimate.surveyId, survey?.customerName || "", survey?.siteAddress || "", line.costCentre, line.description, line.quantity, line.unit, line.supplier || "", `${line.sourceType}: ${line.sourceId}`, line.notes]),
  ];
  const body = rows.map((row) => row.map(csv).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${estimate.reference}-supplier-rfq.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

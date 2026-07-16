import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { appendAuditEvent } from "@/lib/people-data";
import { parseJsonRequestBody } from "@/lib/http";
import { surveyRequestContext, versionedMutationResponse } from "@/lib/survey-api";
import { getEstimate, getSurvey, recordEstimateQuotePush } from "@/lib/survey-estimator-store";
import { createQuote, getQuotes, updateQuote } from "@/lib/workflow-data";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<{ expectedVersion?: number }>(request);
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const estimate = getEstimate(tenantId, id);
  if (!estimate) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  if (body?.expectedVersion !== undefined && body.expectedVersion !== estimate.version) {
    return NextResponse.json({ error: "This estimate changed before it was pushed. Reload and review it again.", reason: "version_conflict", current: estimate }, { status: 409 });
  }
  const survey = getSurvey(tenantId, estimate.surveyId);
  if (!survey) return NextResponse.json({ error: "Source survey not found" }, { status: 422 });
  if (!estimate.scopeOfWorks.length) {
    return NextResponse.json({ error: "Add structured scope items in the source survey and regenerate this estimate before pushing it to a quote." }, { status: 422 });
  }
  if (estimate.materialLines.some((line) => line.unitCost === undefined)) {
    return NextResponse.json({ error: "Price every unpriced supplier RFQ item before pushing this estimate to a quote." }, { status: 422 });
  }
  if (estimate.materialLines.some((line) => line.status === "TBC" && !line.notes.trim())) {
    return NextResponse.json({ error: "Review TBC materials before pushing the estimate into a quote." }, { status: 422 });
  }

  const materialSell = (line: (typeof estimate.materialLines)[number]) => (line.unitCost || 0) * (1 + line.markupPercent / 100);
  const totalSell = estimate.materialLines.reduce((sum, line) => sum + materialSell(line) * line.quantity, 0)
    + estimate.labourLines.reduce((sum, line) => sum + line.sellRate * line.hours, 0);
  const description = estimate.scopeOfWorks.join("\n");
  const linkedQuote = survey.jobLink?.type === "Quote"
    ? getQuotes().find((quote) => quote.id === survey.jobLink?.id || quote.ref === survey.jobLink?.reference)
    : undefined;
  const due = survey.requiredByDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const quote = linkedQuote
    ? updateQuote(linkedQuote.id, { customer: survey.customerName, description, owner: actor, value: Math.round(totalSell * 100) / 100, next: "Review Estimator cost centres and send quote", due })!
    : createQuote({ ref: "", clientId: survey.customerId, siteId: survey.siteId, customer: survey.customerName, description, owner: actor, status: "Draft", value: Math.round(totalSell * 100) / 100, next: "Review Estimator cost centres and send quote", due });

  const sectionId = `estimate-section-${estimate.id}`;
  const names = Array.from(new Set([...estimate.materialLines.map((line) => line.costCentre), ...estimate.labourLines.map((line) => line.costCentre)]));
  const costCentres = names.map((name) => ({
    id: `estimate-centre-${estimate.id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    sectionId,
    templateName: name,
    clientDescription: estimate.scopeOfWorks.filter((scope) => scope.toLowerCase().includes(name.toLowerCase())).join("\n") || estimate.scopeOfWorks.join("\n"),
    engineerDescription: estimate.scopeOfWorks.join("\n"),
    lines: [
      ...estimate.materialLines.filter((line) => line.costCentre === name).map((line) => ({ id: line.id, catalogItemId: "", description: line.description, quantity: line.quantity, unitCost: line.unitCost || 0, unitSell: materialSell(line), supplierRequired: line.status === "Supplier RFQ", rateSource: "manual" })),
      ...estimate.labourLines.filter((line) => line.costCentre === name).map((line) => ({ id: line.id, catalogItemId: "", description: `${line.labourType}: ${line.description}`, quantity: line.hours, unitCost: line.costRate, unitSell: line.sellRate, supplierRequired: false, rateSource: "manual" })),
    ],
  }));
  const hubState = getHubDetailState();
  saveHubDetailState({
    ...hubState,
    quoteSections: { ...(hubState.quoteSections || {}), [quote.id]: [{ id: sectionId, name: survey.jobType, description: "" }] },
    quoteCostCentres: { ...(hubState.quoteCostCentres || {}), [quote.id]: costCentres },
  });
  const recorded = recordEstimateQuotePush(tenantId, estimate.id, body?.expectedVersion, { id: quote.id, ref: quote.ref });
  if (!recorded.ok) return versionedMutationResponse(recorded);
  appendAuditEvent({ actor, action: "pushed", recordType: "quote", recordId: quote.id, summary: `${estimate.reference} created ${costCentres.length} itemised cost centre(s) in ${quote.ref}.`, source: "NeXa Estimator", importance: "normal" });
  return NextResponse.json({ estimate: recorded.value, quote, costCentres }, { status: 200 });
}

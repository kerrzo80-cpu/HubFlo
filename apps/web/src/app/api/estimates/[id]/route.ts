import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { canReadSurveys, surveyRequestContext } from "@/lib/survey-api";
import { versionedMutationResponse } from "@/lib/survey-api";
import { getEstimate, updateEstimateLine } from "@/lib/survey-estimator-store";
import type { EstimateLabourLine, EstimateMaterialLine } from "@hubflo/domain";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!canReadSurveys(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = surveyRequestContext(request);
  const { id } = await params;
  const estimate = getEstimate(tenantId, id);
  return estimate ? NextResponse.json(estimate) : NextResponse.json({ error: "Estimate not found" }, { status: 404 });
}

type LineUpdateBody = {
  expectedVersion?: number;
  lineType: "Material" | "Labour";
  lineId: string;
  patch: Partial<EstimateMaterialLine> | Partial<EstimateLabourLine>;
  correctionReason: string;
  reusable?: boolean;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await parseJsonRequestBody<LineUpdateBody>(request);
  if (!body?.lineType || !body.lineId || !body.patch) return NextResponse.json({ error: "Estimate line update is required." }, { status: 400 });
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const update = body.lineType === "Material"
    ? { lineType: "Material" as const, lineId: body.lineId, patch: body.patch as Partial<EstimateMaterialLine> }
    : { lineType: "Labour" as const, lineId: body.lineId, patch: body.patch as Partial<EstimateLabourLine> };
  return versionedMutationResponse(updateEstimateLine(tenantId, id, body.expectedVersion, update, body.correctionReason || "", actor, body.reusable));
}

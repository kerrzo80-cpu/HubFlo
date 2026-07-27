import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { surveyRequestContext } from "@/lib/survey-api";
import { buildQuickCostCentrePack } from "@/lib/survey-quick-pack";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ expectedVersion?: number }>(request);
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const result = await buildQuickCostCentrePack(tenantId, id, actor, body?.expectedVersion);

  if (!result.ok) {
    return NextResponse.json({
      error: result.error,
      summary: result.summary,
      survey: result.survey,
      costCentres: result.costCentres,
      aiUsed: result.aiUsed,
      aiConnected: result.aiConnected,
      aiModel: result.aiModel,
      estimateId: result.estimateId,
      takeoffProjectId: result.takeoffProjectId,
    }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    aiUsed: result.aiUsed,
    aiConnected: result.aiConnected,
    aiModel: result.aiModel,
    error: result.error,
    survey: result.survey,
    estimateId: result.estimateId,
    estimateReference: result.estimateReference,
    takeoffProjectId: result.takeoffProjectId,
    costCentres: result.costCentres,
  });
}

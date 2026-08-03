import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { surveyRequestContext } from "@/lib/survey-api";
import { buildAiQuotePack } from "@/lib/survey-ai-quote-pack";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ expectedVersion?: number }>(request);
  const { tenantId, actor } = surveyRequestContext(request);
  const { id } = await params;
  const result = await buildAiQuotePack(tenantId, id, actor, body?.expectedVersion);

  if (!result.ok) {
    return NextResponse.json({
      error: result.error,
      summary: result.summary,
      blockers: result.blockers,
      survey: result.survey,
      aiUsed: result.aiUsed,
    }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    aiUsed: result.aiUsed,
    survey: result.survey,
    estimateId: result.estimateId,
    estimateReference: result.estimateReference,
  });
}

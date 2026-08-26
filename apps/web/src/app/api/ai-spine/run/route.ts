import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { runAiSpine, type AiSpineBrief } from "@/lib/ai-spine";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { surveyRequestContext } from "@/lib/survey-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json(
      { error: "Sign in with quote access to run the AI spine." },
      { status: 403 },
    );
  }

  const body = (await parseJsonRequestBody<AiSpineBrief>(request)) || {};
  if (!body.customerName?.trim() && !body.notes?.trim() && !body.jobType?.trim()) {
    return NextResponse.json(
      { error: "Give Blake a customer, job type, or notes to open the spine." },
      { status: 400 },
    );
  }

  const result = await runAiSpine(body);
  const { actor } = surveyRequestContext(request);

  try {
    appendAuditEvent({
      actor,
      action: "ai_spine.run",
      recordType: "ai_spine",
      recordId: result.heatDesign.id,
      summary: result.aiUsed
        ? `AI spine · ${result.heatDesign.name} ↔ ${result.takeoff.reference}`
        : `Rule spine · ${result.heatDesign.name} ↔ ${result.takeoff.reference}`,
      source: "ai-spine",
      importance: "high",
    });
  } catch {
    // non-blocking
  }

  return NextResponse.json(result);
}

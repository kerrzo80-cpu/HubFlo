import { NextResponse } from "next/server";

import {
  applyEngineerWorkflowAction,
  getEngineerJobWorkflow,
} from "@/lib/engineer-workflow-store";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const workflow = getEngineerJobWorkflow(scheduleId);
  return NextResponse.json({
    scheduleId,
    requirements: workflow.requirements ?? [],
  });
}

export async function POST(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const body = await parseJsonRequestBody<{ requirementId?: string }>(request);
  if (!body?.requirementId) {
    return NextResponse.json({ error: "requirementId is required." }, { status: 400 });
  }

  const workflow = applyEngineerWorkflowAction(scheduleId, {
    action: "complete_requirement",
    payload: { requirementId: body.requirementId },
  });

  return NextResponse.json({
    scheduleId,
    requirements: workflow.requirements ?? [],
  });
}

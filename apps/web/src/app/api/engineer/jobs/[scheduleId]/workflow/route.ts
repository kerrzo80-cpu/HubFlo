import { NextResponse } from "next/server";

import { getEngineerScheduleItem } from "@/lib/engineer-data";
import { applyEngineerWorkflowAction, getEngineerJobWorkflow } from "@/lib/engineer-workflow-store";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) {
    return NextResponse.json({ error: "Engineer job not found" }, { status: 404 });
  }

  return NextResponse.json(getEngineerJobWorkflow(scheduleId));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const { scheduleId } = await params;
  const job = getEngineerScheduleItem(scheduleId);
  if (!job) {
    return NextResponse.json({ error: "Engineer job not found" }, { status: 404 });
  }

  const payload = await parseJsonRequestBody<Parameters<typeof applyEngineerWorkflowAction>[1]>(request);
  if (!payload?.action || !payload.payload) {
    return NextResponse.json({ error: "Choose an engineer workflow action." }, { status: 400 });
  }

  return NextResponse.json(applyEngineerWorkflowAction(scheduleId, payload));
}

import { NextResponse } from "next/server";

import {
  applyEngineerWorkflowAction,
  getEngineerJobWorkflow,
  type EngineerWorkflowAction,
} from "@/lib/engineer-workflow-store";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

type FieldWorkflowAction = Extract<
  EngineerWorkflowAction,
  | { action: "add_photos" }
  | { action: "add_note" }
  | { action: "request_po" }
  | { action: "set_outcome" }
>;

const ALLOWED = new Set(["add_photos", "add_note", "request_po", "set_outcome"]);

export async function GET(_request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const workflow = getEngineerJobWorkflow(scheduleId);
  return NextResponse.json({
    scheduleId,
    photos: workflow.photos ?? [],
    notes: workflow.notes ?? [],
    poRequests: workflow.poRequests ?? [],
    outcome: workflow.outcome ?? null,
    officeReview: (workflow.officeReview ?? []).slice(0, 20),
  });
}

export async function POST(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const body = await parseJsonRequestBody<FieldWorkflowAction>(request);
  if (!body?.action || !body.payload || !ALLOWED.has(body.action)) {
    return NextResponse.json(
      { error: "Choose add_photos, add_note, request_po, or set_outcome." },
      { status: 400 },
    );
  }

  try {
    const workflow = applyEngineerWorkflowAction(scheduleId, body);
    return NextResponse.json({
      scheduleId,
      photos: workflow.photos ?? [],
      notes: workflow.notes ?? [],
      poRequests: workflow.poRequests ?? [],
      outcome: workflow.outcome ?? null,
      officeReview: (workflow.officeReview ?? []).slice(0, 20),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update job workflow." },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";

import {
  applyEngineerWorkflowAction,
  getEngineerJobWorkflow,
} from "@/lib/engineer-workflow-store";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

type RequirementBody = {
  requirementId?: string;
  text?: string;
  numberValue?: string;
  photoName?: string;
  createdBy?: string;
  reopen?: boolean;
};

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
  const body = await parseJsonRequestBody<RequirementBody>(request);
  if (!body?.requirementId) {
    return NextResponse.json({ error: "requirementId is required." }, { status: 400 });
  }

  try {
    const workflow = body.reopen
      ? applyEngineerWorkflowAction(scheduleId, {
          action: "reopen_requirement",
          payload: {
            requirementId: body.requirementId,
            createdBy: body.createdBy,
          },
        })
      : applyEngineerWorkflowAction(scheduleId, {
          action: "complete_requirement",
          payload: {
            requirementId: body.requirementId,
            text: body.text,
            numberValue: body.numberValue,
            photoName: body.photoName,
            createdBy: body.createdBy,
            evidence: {
              text: body.text,
              numberValue: body.numberValue,
              photoName: body.photoName,
            },
          },
        });

    return NextResponse.json({
      scheduleId,
      requirements: workflow.requirements ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save checklist item." },
      { status: 400 },
    );
  }
}

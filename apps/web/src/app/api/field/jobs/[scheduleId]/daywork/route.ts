import { NextResponse } from "next/server";

import { getEngineerScheduleItem, type EngineerRequirement } from "@/lib/engineer-data";
import {
  DAYWORK_COST_CENTRE_NAME,
  DAYWORK_COST_CENTRE_TEMPLATE,
  ensureDayworkVariationCostCentre,
  requirementsFromFlowTemplate,
} from "@/lib/engineer-flow";
import { activateDayworkWorkflow, clearDayworkWorkflowMode } from "@/lib/engineer-workflow-store";
import { getJobs } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

function dayworkRequirements(jobId: string, costCentreId: string): EngineerRequirement[] {
  return requirementsFromFlowTemplate({
    jobId,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
  }) as EngineerRequirement[];
}

/** Ensure Daywork variation cost centre and switch Field checklist onto that sheet. */
export async function POST(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const schedule = getEngineerScheduleItem(scheduleId);
  if (!schedule?.jobId) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    body = {};
  }

  if (body.action === "clear") {
    const workflow = clearDayworkWorkflowMode(scheduleId);
    return NextResponse.json({
      scheduleId,
      checklistMode: "job",
      requirements: workflow.requirements ?? [],
    });
  }

  const costCentreId = ensureDayworkVariationCostCentre(schedule.jobId);
  const requirements = dayworkRequirements(schedule.jobId, costCentreId);
  const workflow = activateDayworkWorkflow(scheduleId, costCentreId, requirements);
  const coreJob = getJobs().find((job) => job.id === schedule.jobId);

  return NextResponse.json({
    scheduleId,
    jobId: schedule.jobId,
    jobRef: coreJob?.ref || schedule.jobRef,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    checklistMode: "daywork",
    requirements: workflow.requirements ?? requirements,
  });
}

export async function GET(_request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const schedule = getEngineerScheduleItem(scheduleId);
  if (!schedule?.jobId) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  const costCentreId = ensureDayworkVariationCostCentre(schedule.jobId);
  const requirements = dayworkRequirements(schedule.jobId, costCentreId);

  return NextResponse.json({
    scheduleId,
    jobId: schedule.jobId,
    costCentreId,
    costCentreName: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    requirements,
  });
}

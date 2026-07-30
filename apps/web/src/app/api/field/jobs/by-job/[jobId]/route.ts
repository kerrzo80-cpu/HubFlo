import { NextResponse } from "next/server";

import { getEngineerSchedule } from "@/lib/engineer-data";
import { withLiveFieldDates } from "@/lib/field/nexa/from-core";
import { getEngineerJobWorkflow } from "@/lib/engineer-workflow-store";
import { getHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

/**
 * Core job view: all Field visits + checklist evidence + Blake hours for a job.
 */
export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const visits = withLiveFieldDates(getEngineerSchedule())
    .filter((item) => item.jobId === jobId)
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
    .map((item) => {
      const workflow = getEngineerJobWorkflow(item.scheduleId);
      const requirements = workflow.requirements ?? [];
      const doneCount = requirements.filter((row) => row.status === "done").length;
      return {
        scheduleId: item.scheduleId,
        jobRef: item.jobRef,
        date: item.date,
        start: item.start,
        end: item.end,
        engineerName: item.engineerName,
        costCentre: item.costCentre,
        customer: item.customer,
        status: item.status,
        checklist: {
          total: requirements.length,
          done: doneCount,
          items: requirements.map((row) => ({
            id: row.id,
            label: row.label,
            status: row.status,
            stage: row.stage,
            evidence: row.evidence,
            value: row.value,
          })),
        },
        timeEntries: workflow.timeEntries ?? [],
        officeReview: (workflow.officeReview ?? []).slice(0, 12),
        photos: workflow.photos ?? [],
      };
    });

  const hubState = getHubDetailState();
  const evidenceStore = (hubState.flowStepEvidence ?? {}) as Record<string, unknown>;
  const hubEvidenceKeys = Object.keys(evidenceStore).filter((key) => key.startsWith(`${jobId}:`));

  return NextResponse.json({
    jobId,
    visitCount: visits.length,
    hubEvidenceCount: hubEvidenceKeys.length,
    visits,
    fieldAppPath: visits[0] ? `/field/jobs/${visits[0].scheduleId}` : "/field",
  });
}

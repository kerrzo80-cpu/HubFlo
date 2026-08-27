import { NextResponse } from "next/server";

import { peekHubDetailState } from "@/lib/hub-detail-store";
import { loadServerStore } from "@/lib/server-store";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

type LeanWorkflow = {
  requirements?: Array<Record<string, unknown>>;
  timeEntries?: unknown[];
  officeReview?: unknown[];
  photos?: Array<Record<string, unknown>>;
};

/**
 * Core job view: Field visits for one job.
 * Must NOT call full engineer schedule / hub clone helpers — that N× deep-clones the full hub
 * and OOMs live when opening a job before Mark complete.
 */
export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  if (!jobId?.trim()) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const hub = peekHubDetailState();
  const plans = Array.isArray((hub.jobSchedulePlans as Record<string, unknown> | undefined)?.[jobId])
    ? ((hub.jobSchedulePlans as Record<string, unknown[]>)[jobId] as Array<Record<string, unknown>>)
    : [];

  const evidenceStore = (hub.flowStepEvidence ?? {}) as Record<string, unknown>;
  const hubEvidenceKeys = Object.keys(evidenceStore).filter((key) => key.startsWith(`${jobId}:`));

  const wfStore = loadServerStore("engineer-workflow-store", { jobs: {} as Record<string, LeanWorkflow> }) as {
    jobs?: Record<string, LeanWorkflow>;
  };
  const workflows = wfStore.jobs || {};

  const visits = plans
    .map((plan) => {
      const scheduleId = String(plan.id || "").trim();
      if (!scheduleId) return null;
      const workflow = workflows[scheduleId] || {};
      const requirements = Array.isArray(workflow.requirements) ? workflow.requirements : [];
      const doneCount = requirements.filter((row) => row.status === "done").length;
      return {
        scheduleId,
        jobRef: String(plan.jobRef || ""),
        date: String(plan.startDate || plan.date || ""),
        start: String(plan.startTime || plan.start || ""),
        end: String(plan.endTime || plan.end || ""),
        engineerName: String(plan.employeeName || plan.engineerName || ""),
        costCentre: String(plan.costCentre || plan.costCentreName || ""),
        customer: String(plan.customer || ""),
        status: String(plan.status || ""),
        checklist: {
          total: requirements.length,
          done: doneCount,
          items: requirements.map((row) => ({
            id: String(row.id || ""),
            label: String(row.label || ""),
            status: String(row.status || "missing"),
            stage: row.stage ? String(row.stage) : undefined,
            evidence: row.evidence ? String(row.evidence) : undefined,
            value: row.value && typeof row.value === "object"
              ? {
                  text: (row.value as { text?: unknown }).text
                    ? String((row.value as { text?: unknown }).text)
                    : undefined,
                  numberValue: (row.value as { numberValue?: unknown }).numberValue
                    ? String((row.value as { numberValue?: unknown }).numberValue)
                    : undefined,
                  photoName: (row.value as { photoName?: unknown }).photoName
                    ? String((row.value as { photoName?: unknown }).photoName)
                    : undefined,
                }
              : undefined,
          })),
        },
        timeEntries: Array.isArray(workflow.timeEntries) ? workflow.timeEntries.slice(0, 40) : [],
        officeReview: Array.isArray(workflow.officeReview) ? workflow.officeReview.slice(0, 12) : [],
        // Never echo photo bytes / data URLs on office poll — open Field for media.
        photos: Array.isArray(workflow.photos)
          ? workflow.photos.slice(0, 20).map((photo) => ({
              id: String(photo.id || ""),
              name: String(photo.name || ""),
              uploadedBy: photo.uploadedBy ? String(photo.uploadedBy) : undefined,
              uploadedAt: photo.uploadedAt ? String(photo.uploadedAt) : undefined,
            }))
          : [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => `${a!.date}${a!.start}`.localeCompare(`${b!.date}${b!.start}`));

  return NextResponse.json({
    jobId,
    visitCount: visits.length,
    hubEvidenceCount: hubEvidenceKeys.length,
    visits,
    fieldAppPath: visits[0] ? `/field/jobs/${visits[0]!.scheduleId}` : "/field",
    lean: true,
  });
}

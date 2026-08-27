import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import {
  jobInvoiceReviewComplete,
  type JobInvoiceReviewState,
} from "@/lib/job-invoice-review";
import { getJob, updateJob, type Job } from "@/lib/workflow-data";
import { appendAuditEvent } from "@/lib/people-data";

export type JobReviewKey = keyof JobInvoiceReviewState;

export const emptyJobInvoiceReview: JobInvoiceReviewState = {
  construction: false,
  commercial: false,
  office: false,
};

export function readJobInvoiceReview(jobId: string): JobInvoiceReviewState {
  const raw = getHubDetailState().jobReviews?.[jobId];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...emptyJobInvoiceReview };
  const review = raw as Partial<JobInvoiceReviewState>;
  return {
    construction: review.construction === true,
    commercial: review.commercial === true,
    office: review.office === true,
  };
}

export function writeJobInvoiceReview(jobId: string, review: JobInvoiceReviewState) {
  const hub = getHubDetailState();
  saveHubDetailState({
    ...hub,
    jobReviews: {
      ...((hub.jobReviews || {}) as Record<string, unknown>),
      [jobId]: review,
    },
  });
  return review;
}

export function setJobReviewTick(jobId: string, key: JobReviewKey, value: boolean) {
  const next = { ...readJobInvoiceReview(jobId), [key]: value };
  return writeJobInvoiceReview(jobId, next);
}

export function forceJobReviewsComplete(jobId: string) {
  return writeJobInvoiceReview(jobId, {
    construction: true,
    commercial: true,
    office: true,
  });
}

/** Mark visit Complete — status only, no schedule clash re-check. */
export function completeJobPassaround(jobId: string, actor: string): Job {
  const current = getJob(jobId);
  if (!current) {
    throw new Error("Job not found");
  }
  const updated = updateJob(jobId, {
    status: "Completed",
    next: "Pass around required before Ready to invoice.",
  });
  if (!updated) throw new Error("Job not found");
  appendAuditEvent({
    actor,
    action: "completed",
    recordType: "job",
    recordId: updated.id,
    summary: `${updated.ref} marked Complete and awaiting pass around.`,
    source: "job passaround api",
    importance: "high",
  });
  return updated;
}

/**
 * Atomic Ready-to-invoice: force three sign-offs in hub, then move status.
 * Avoids client races (hub poll wipe, schedule-clash status PATCH, split PUTs).
 */
export function readyJobForInvoice(jobId: string, actor: string): {
  job: Job;
  review: JobInvoiceReviewState;
} {
  const current = getJob(jobId);
  if (!current) {
    throw new Error("Job not found");
  }

  const review = forceJobReviewsComplete(jobId);
  if (!jobInvoiceReviewComplete(getHubDetailState().jobReviews?.[jobId])) {
    throw new Error("Approvals could not be saved on the server.");
  }

  const updated = updateJob(jobId, {
    status: "Ready to invoice",
    next: "Raise and email final invoice.",
  });
  if (!updated) throw new Error("Job not found");

  appendAuditEvent({
    actor,
    action: "approved",
    recordType: "job",
    recordId: updated.id,
    summary: `${updated.ref} passed pass around and moved to Ready to invoice.`,
    source: "job passaround api",
    importance: "high",
  });

  return { job: updated, review };
}

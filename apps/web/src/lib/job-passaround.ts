import { peekHubJobReviews, writeHubJobReview } from "@/lib/hub-detail-store";
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
  // peekHubJobReviews overlays the lean side store — no full-hub clone.
  const raw = peekHubJobReviews()?.[jobId];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...emptyJobInvoiceReview };
  const review = raw as Partial<JobInvoiceReviewState>;
  return {
    construction: review.construction === true,
    commercial: review.commercial === true,
    office: review.office === true,
  };
}

export function writeJobInvoiceReview(jobId: string, review: JobInvoiceReviewState) {
  // Never getHubDetailState()/saveHubDetailState() here — that deep-clones + stringifies the
  // whole office hub and was HTML-502ing live on every Chris/Commercial/Carol tick.
  writeHubJobReview(jobId, review as unknown as Record<string, unknown>);
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

function safeAudit(input: Parameters<typeof appendAuditEvent>[0]) {
  try {
    appendAuditEvent(input);
  } catch {
    // Never roll back a successful status/review write because audit logging failed.
  }
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
  safeAudit({
    actor,
    action: "completed",
    recordType: "job",
    recordId: updated.id,
    summary: `${updated.ref} marked Complete and awaiting pass around.`,
    source: "job passaround api",
    importance: "high",
  });
  return getJob(jobId) ?? updated;
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
  if (!jobInvoiceReviewComplete(readJobInvoiceReview(jobId))) {
    throw new Error("Approvals could not be saved on the server.");
  }

  const updated = updateJob(jobId, {
    status: "Ready to invoice",
    next: "Raise and email final invoice.",
  });
  if (!updated) throw new Error("Job not found");
  if (updated.status !== "Ready to invoice") {
    throw new Error("Approvals could not be saved on the server.");
  }

  // Audit is best-effort and deferred — never re-read the workflow store here.
  // A second getJob() + people-store write overlapped office polls and HTML-502'd live.
  safeAudit({
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

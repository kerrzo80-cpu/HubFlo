/** Effective job-health tone for dashboard KPI + Jobs folder filters. */

export type JobHealthTone = "green" | "amber" | "red";

export type JobAttentionReasonCode =
  | "waiting_parts"
  | "waiting_customer"
  | "approval_required"
  | "overdue_schedule"
  | "overdue_due"
  | "marked_attention"
  | "imported_review"
  | "uncategorised";

export type JobAttentionReason = {
  code: JobAttentionReasonCode;
  label: string;
  detail: string;
  tone: JobHealthTone;
};

const CLOSED_STATUSES = new Set(["Completed", "Invoiced", "Cancelled"]);

export function effectiveJobHealthTone(
  job: {
    health?: string | null;
    status?: string | null;
    scheduledDate?: string | null;
    due?: string | null;
  },
  today = new Date().toISOString().slice(0, 10),
): JobHealthTone {
  const status = String(job.status || "");
  if (["Waiting on parts", "Waiting on customer"].includes(status)) return "red";

  let health = String(job.health || "");
  if (status === "Approval required" && health !== "red") health = "amber";

  const scheduled = String(job.scheduledDate || "").slice(0, 10);
  const due = String(job.due || "").slice(0, 10);
  const closed = CLOSED_STATUSES.has(status);
  if (!closed && ((scheduled && scheduled < today) || (due && due < today))) {
    health = health === "red" ? "red" : "amber";
  }
  if (health === "red") return "red";
  if (health === "amber") return "amber";
  if (health === "green") return "green";
  // Unknown / blue operational states are "in flight", not "on track".
  return "amber";
}

/** Ordered reasons explaining why a job is Attention or Blocked (not a Jobs dump). */
export function jobAttentionReasons(
  job: {
    health?: string | null;
    status?: string | null;
    scheduledDate?: string | null;
    due?: string | null;
    next?: string | null;
  },
  today = new Date().toISOString().slice(0, 10),
): JobAttentionReason[] {
  const status = String(job.status || "");
  const health = String(job.health || "");
  const scheduled = String(job.scheduledDate || "").slice(0, 10);
  const due = String(job.due || "").slice(0, 10);
  const closed = CLOSED_STATUSES.has(status);
  const next = String(job.next || "").trim();
  const reasons: JobAttentionReason[] = [];

  if (status === "Waiting on parts") {
    reasons.push({
      code: "waiting_parts",
      label: "Waiting on parts",
      detail: next || "Chase supplier / book return visit once parts arrive",
      tone: "red",
    });
  }
  if (status === "Waiting on customer") {
    reasons.push({
      code: "waiting_customer",
      label: "Waiting on customer",
      detail: next || "Chase customer decision or access",
      tone: "red",
    });
  }
  if (status === "Approval required") {
    reasons.push({
      code: "approval_required",
      label: "Approval required",
      detail: next || "Review variation / client approval before work continues",
      tone: "amber",
    });
  }
  if (!closed && scheduled && scheduled < today) {
    reasons.push({
      code: "overdue_schedule",
      label: "Past booked date",
      detail: `Booked ${scheduled} — reschedule or complete`,
      tone: "amber",
    });
  }
  if (!closed && due && due < today) {
    reasons.push({
      code: "overdue_due",
      label: "Past due date",
      detail: `Due ${due} — chase completion or move the date`,
      tone: "amber",
    });
  }
  if (health === "amber" && !reasons.some((item) => item.code === "approval_required")) {
    reasons.push({
      code: "marked_attention",
      label: "Marked needs attention",
      detail: next || "Open the job and clear the next office action",
      tone: "amber",
    });
  }
  if (health === "red" && !reasons.some((item) => item.tone === "red")) {
    reasons.push({
      code: "marked_attention",
      label: "Marked blocked",
      detail: next || "Open the job and clear the blocker",
      tone: "red",
    });
  }

  if (!reasons.length && effectiveJobHealthTone(job, today) !== "green") {
    if (/review imported/i.test(next)) {
      reasons.push({
        code: "imported_review",
        label: "Review imported job",
        detail: "Imported from simPRO — confirm customer, site, schedule, and clear the next office action",
        tone: effectiveJobHealthTone(job, today),
      });
    } else if (next) {
      reasons.push({
        code: "uncategorised",
        label: next,
        detail: "Open the job and complete this office action",
        tone: effectiveJobHealthTone(job, today),
      });
    } else {
      reasons.push({
        code: "uncategorised",
        label: "Needs office follow-up",
        detail: "Open the job and set the next action",
        tone: effectiveJobHealthTone(job, today),
      });
    }
  }

  return reasons;
}

export function primaryJobAttentionReason(
  job: Parameters<typeof jobAttentionReasons>[0],
  today = new Date().toISOString().slice(0, 10),
): JobAttentionReason | null {
  return jobAttentionReasons(job, today)[0] ?? null;
}

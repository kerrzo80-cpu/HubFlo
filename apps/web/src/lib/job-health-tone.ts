/** Effective job-health tone for dashboard KPI + Jobs folder filters. */

export type JobHealthTone = "green" | "amber" | "red";

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

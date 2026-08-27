import type { HubDetailState } from "@/lib/hub-detail-store";

const SCHEDULE_KEEP_KEYS = [
  "id",
  "employeeId",
  "employeeName",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
  "status",
  "notes",
  "colour",
  "color",
  "ganttColor",
] as const;

function leanScheduleRow(row: unknown): Record<string, unknown> | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SCHEDULE_KEEP_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

function leanSchedulePlans(value: unknown): Record<string, unknown[]> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown[]> = {};
  for (const [jobId, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[jobId] = list.map(leanScheduleRow).filter(Boolean) as Record<string, unknown>[];
  }
  return out;
}

/**
 * Office hub GET must stay small. Passaround ticks die when this response is ~1.9MB
 * (quote takeoff dumps + full cost centres + simpro exports) and overlaps updateJob / hub PUT.
 *
 * Omit BoQ/takeoff maps from the poll wire — client keeps local/hydrated copies when keys are absent.
 * Keep lean schedules + reviews + employees + invoices for board/Gantt sync.
 */
export function leanHubStateForOfficePoll(state: HubDetailState): HubDetailState & { hubPollLean?: boolean } {
  const next: HubDetailState & { hubPollLean?: boolean } = {
    ...state,
    jobSchedulePlans: leanSchedulePlans(state.jobSchedulePlans) as HubDetailState["jobSchedulePlans"],
    quoteSchedulePlans: leanSchedulePlans(state.quoteSchedulePlans) as HubDetailState["quoteSchedulePlans"],
    hubPollLean: true,
  };

  // Fat on live (~1.9MB combined) — not needed every 60s for Complete/ticks.
  delete (next as { quoteCostCentres?: unknown }).quoteCostCentres;
  delete (next as { jobCostCentres?: unknown }).jobCostCentres;
  delete (next as { simproExports?: unknown }).simproExports;
  delete (next as { quoteSections?: unknown }).quoteSections;

  return next;
}

/** Engineer schedule clash detection for hub jobSchedulePlans. */

export type HubScheduleAssignment = {
  id: string;
  jobId?: string;
  employeeId?: string;
  employeeName?: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  costCentreName?: string;
};

function toStamp(date: string, time: string) {
  const t = String(time || "00:00").trim();
  const normalised = /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : "00:00";
  return `${String(date || "").slice(0, 10)}T${normalised}`;
}

export function hubAssignmentsOverlap(a: HubScheduleAssignment, b: HubScheduleAssignment) {
  if (!a.employeeId || !b.employeeId || a.employeeId !== b.employeeId) return false;
  if (a.id && b.id && a.id === b.id) return false;
  const aStart = toStamp(a.startDate, a.startTime);
  const aEnd = toStamp(a.endDate || a.startDate, a.endTime);
  const bStart = toStamp(b.startDate, b.startTime);
  const bEnd = toStamp(b.endDate || b.startDate, b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export type HubScheduleClash = {
  employeeId: string;
  employeeName: string;
  a: HubScheduleAssignment;
  b: HubScheduleAssignment;
  detail: string;
};

/** Flatten jobSchedulePlans and return first N same-engineer overlaps. */
export function findHubScheduleClashes(
  plans: Record<string, HubScheduleAssignment[]> | null | undefined,
  limit = 20,
): HubScheduleClash[] {
  const list: HubScheduleAssignment[] = [];
  for (const [jobId, rows] of Object.entries(plans || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      list.push({
        ...row,
        jobId: row.jobId || jobId,
        startDate: String(row.startDate || "").slice(0, 10),
        endDate: String(row.endDate || row.startDate || "").slice(0, 10),
        startTime: String(row.startTime || "08:00"),
        endTime: String(row.endTime || "17:00"),
        employeeId: String(row.employeeId || ""),
        employeeName: String(row.employeeName || "Engineer"),
        id: String(row.id || `${jobId}-${row.startDate}-${row.startTime}`),
      });
    }
  }

  const clashes: HubScheduleClash[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (!hubAssignmentsOverlap(a, b)) continue;
      clashes.push({
        employeeId: a.employeeId || "",
        employeeName: a.employeeName || "Engineer",
        a,
        b,
        detail: `${a.employeeName}: ${a.costCentreName || a.jobId} (${a.startDate} ${a.startTime}-${a.endTime}) clashes with ${b.costCentreName || b.jobId} (${b.startDate} ${b.startTime}-${b.endTime})`,
      });
      if (clashes.length >= limit) return clashes;
    }
  }
  return clashes;
}

export function assertNoHubScheduleClashes(
  plans: Record<string, HubScheduleAssignment[]> | null | undefined,
): string | null {
  const clashes = findHubScheduleClashes(plans, 3);
  if (!clashes.length) return null;
  return `Schedule clash blocked: ${clashes[0]!.detail}${clashes.length > 1 ? ` (+${clashes.length - 1} more)` : ""}`;
}

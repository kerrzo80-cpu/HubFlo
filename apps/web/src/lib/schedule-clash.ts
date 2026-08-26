/** Engineer schedule clash detection for hub jobSchedulePlans + lead surveys. */

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

export type LeadSurveyBookingInput = {
  id?: string;
  leadId?: string;
  ref?: string;
  surveyor?: string;
  employeeName?: string;
  surveyDate?: string;
  date?: string;
  surveyTime?: string;
  time?: string;
  durationMinutes?: number;
  status?: string;
};

function toStamp(date: string, time: string) {
  const t = String(time || "00:00").trim();
  const normalised = /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, "0") : "00:00";
  return `${String(date || "").slice(0, 10)}T${normalised}`;
}

function normaliseEngineerName(name?: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function addMinutesToTime(time: string, minutes: number) {
  const [h = 0, m = 0] = String(time || "00:00")
    .split(":")
    .map((part) => Number(part));
  const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Same engineer when ids match, or normalised names match when either side lacks an id. */
export function sameHubEngineer(a: HubScheduleAssignment, b: HubScheduleAssignment) {
  const aId = String(a.employeeId || "").trim();
  const bId = String(b.employeeId || "").trim();
  if (aId && bId) return aId === bId;
  const aName = normaliseEngineerName(a.employeeName);
  const bName = normaliseEngineerName(b.employeeName);
  return Boolean(aName && bName && aName === bName);
}

export function hubAssignmentsOverlap(a: HubScheduleAssignment, b: HubScheduleAssignment) {
  if (!sameHubEngineer(a, b)) return false;
  if (a.id && b.id && a.id === b.id) return false;
  const aStart = toStamp(a.startDate, a.startTime);
  const aEnd = toStamp(a.endDate || a.startDate, a.endTime);
  const bStart = toStamp(b.startDate, b.startTime);
  const bEnd = toStamp(b.endDate || b.startDate, b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export function leadSurveyToAssignment(lead: LeadSurveyBookingInput): HubScheduleAssignment | null {
  if (lead.status === "Lost") return null;
  const date = String(lead.surveyDate || lead.date || "").slice(0, 10);
  const time = String(lead.surveyTime || lead.time || "").trim();
  const surveyor = String(lead.surveyor || lead.employeeName || "").trim();
  if (!date || !time || !surveyor) return null;
  const duration = Number.isFinite(lead.durationMinutes) && (lead.durationMinutes || 0) > 0 ? Number(lead.durationMinutes) : 60;
  const leadId = String(lead.leadId || lead.id || "lead");
  const endTime = addMinutesToTime(time, duration);
  return {
    id: `lead-survey-${leadId}`,
    jobId: `lead:${leadId}`,
    employeeName: surveyor,
    startDate: date,
    endDate: date,
    startTime: /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, "0") : time,
    endTime,
    costCentreName: lead.ref ? `Survey ${lead.ref}` : "Lead survey",
  };
}

export function leadSurveysToAssignments(
  leads: LeadSurveyBookingInput[] | null | undefined,
): HubScheduleAssignment[] {
  const out: HubScheduleAssignment[] = [];
  for (const lead of leads || []) {
    const row = leadSurveyToAssignment(lead);
    if (row) out.push(row);
  }
  return out;
}

export type HubScheduleClash = {
  employeeId: string;
  employeeName: string;
  a: HubScheduleAssignment;
  b: HubScheduleAssignment;
  detail: string;
};

function flattenPlanAssignments(
  plans: Record<string, HubScheduleAssignment[]> | null | undefined,
): HubScheduleAssignment[] {
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
  return list;
}

/** Flatten jobSchedulePlans (+ optional extras such as lead surveys) and return overlaps. */
export function findHubScheduleClashes(
  plans: Record<string, HubScheduleAssignment[]> | null | undefined,
  limit = 20,
  extraAssignments: HubScheduleAssignment[] = [],
): HubScheduleClash[] {
  const list = [...flattenPlanAssignments(plans), ...extraAssignments];

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
  extraAssignments: HubScheduleAssignment[] = [],
): string | null {
  const clashes = findHubScheduleClashes(plans, 3, extraAssignments);
  if (!clashes.length) return null;
  return `Schedule clash blocked: ${clashes[0]!.detail}${clashes.length > 1 ? ` (+${clashes.length - 1} more)` : ""}`;
}

/** Clash a single lead survey booking against hub jobSchedulePlans (and optional other leads). */
export function assertLeadSurveyAgainstPlans(
  booking: LeadSurveyBookingInput,
  plans: Record<string, HubScheduleAssignment[]> | null | undefined,
  otherLeads: LeadSurveyBookingInput[] = [],
): string | null {
  const self = leadSurveyToAssignment(booking);
  if (!self) return null;
  const others = [
    ...flattenPlanAssignments(plans),
    ...leadSurveysToAssignments(otherLeads).filter((row) => row.id !== self.id),
  ];
  for (const row of others) {
    if (!hubAssignmentsOverlap(self, row)) continue;
    return `Schedule clash blocked: ${self.employeeName}: ${self.costCentreName} (${self.startDate} ${self.startTime}-${self.endTime}) clashes with ${row.costCentreName || row.jobId} (${row.startDate} ${row.startTime}-${row.endTime})`;
  }
  return null;
}

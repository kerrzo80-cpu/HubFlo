import { randomUUID } from "node:crypto";

import {
  formatDuration,
  getEngineerSchedule,
  type EngineerScheduleItem,
} from "@/lib/engineer-data";
import { withLiveFieldDates } from "@/lib/field/nexa/from-core";
import { applyEngineerWorkflowAction } from "@/lib/engineer-workflow-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type TimeCheckLineStatus = "pending" | "confirmed" | "amended" | "skipped";

export type TimeCheckLine = {
  scheduleId: string;
  jobId: string;
  jobRef: string;
  customer: string;
  costCentre: string;
  scheduledStart: string;
  scheduledEnd: string;
  scheduledHours: number;
  actualStart: string;
  actualEnd: string;
  breakMinutes: number;
  actualHours: number;
  note: string;
  status: TimeCheckLineStatus;
};

export type TimeCheckGapReason =
  | "Existing job"
  | "Reactive job"
  | "Travel"
  | "Materials"
  | "Admin"
  | "Training"
  | "Sick/appointment"
  | "Unpaid/no claim";

export type TimeCheckGap = {
  id: string;
  hours: number;
  reason: TimeCheckGapReason;
  note: string;
};

export type DailyTimeCheckStatus = "not_started" | "in_progress" | "submitted";

export type DailyTimeCheck = {
  id: string;
  date: string;
  engineerId: string;
  engineerName: string;
  status: DailyTimeCheckStatus;
  lines: TimeCheckLine[];
  gaps: TimeCheckGap[];
  blakePromptCount: number;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type TimeCheckStore = {
  checks: Record<string, DailyTimeCheck>;
};

export type TimeCheckSubmitLineInput = {
  scheduleId: string;
  actualStart?: string;
  actualEnd?: string;
  breakMinutes?: number;
  note?: string;
  confirmAsScheduled?: boolean;
};

const STORE_NAME = "engineer-time-checks";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function hoursBetween(start: string, end: string, breakMinutes = 0) {
  const startParts = start.split(":").map(Number);
  const endParts = end.split(":").map(Number);
  const startHour = startParts[0] ?? Number.NaN;
  const startMinute = startParts[1] ?? Number.NaN;
  const endHour = endParts[0] ?? Number.NaN;
  const endMinute = endParts[1] ?? Number.NaN;
  if (
    [startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))
  ) {
    return 0;
  }
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const worked = Math.max(0, endTotal - startTotal - Math.max(0, breakMinutes));
  return Number((worked / 60).toFixed(2));
}

function checkKey(date: string, engineerId: string) {
  return `${date}::${engineerId}`;
}

function lineFromJob(job: EngineerScheduleItem): TimeCheckLine {
  return {
    scheduleId: job.scheduleId,
    jobId: job.jobId,
    jobRef: job.jobRef,
    customer: job.customer,
    costCentre: job.costCentre,
    scheduledStart: job.start,
    scheduledEnd: job.end,
    scheduledHours: job.durationHours,
    actualStart: job.start,
    actualEnd: job.end,
    breakMinutes: 0,
    actualHours: job.durationHours,
    note: "",
    status: "pending",
  };
}

function loadStore(): TimeCheckStore {
  return loadServerStore<TimeCheckStore>(STORE_NAME, { checks: {} });
}

function saveStore(store: TimeCheckStore) {
  writeServerStore(STORE_NAME, store);
}

function pickEngineerJobs(date?: string, engineerId?: string) {
  const jobs = withLiveFieldDates(getEngineerSchedule());
  const targetDate = date || jobs[0]?.date || todayIsoDate();
  const targetEngineer = engineerId || jobs[0]?.engineerId || "eng-default";
  const filtered = jobs.filter((job) => {
    const dateMatch = !date || job.date === targetDate || !job.date;
    const engineerMatch = !engineerId || job.engineerId === targetEngineer;
    return dateMatch && engineerMatch;
  });
  return {
    date: targetDate,
    engineerId: filtered[0]?.engineerId || targetEngineer,
    engineerName: filtered[0]?.engineerName || "Field engineer",
    jobs: filtered.length ? filtered : jobs,
  };
}

export function getOrCreateDailyTimeCheck(input?: {
  date?: string;
  engineerId?: string;
}) {
  const selection = pickEngineerJobs(input?.date, input?.engineerId);
  const key = checkKey(selection.date, selection.engineerId);
  const store = loadStore();
  const existing = store.checks[key];
  if (existing) {
    const knownIds = new Set(existing.lines.map((line) => line.scheduleId));
    const missing = selection.jobs
      .filter((job) => !knownIds.has(job.scheduleId))
      .map(lineFromJob);
    if (missing.length) {
      existing.lines = [...existing.lines, ...missing];
      existing.updatedAt = new Date().toISOString();
      store.checks[key] = existing;
      saveStore(store);
    }
    return clone(existing);
  }

  const created: DailyTimeCheck = {
    id: makeId("time-check"),
    date: selection.date,
    engineerId: selection.engineerId,
    engineerName: selection.engineerName,
    status: "not_started",
    lines: selection.jobs.map(lineFromJob),
    gaps: [],
    blakePromptCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.checks[key] = created;
  saveStore(store);
  return clone(created);
}

export function recordBlakeTimePrompt(input?: {
  date?: string;
  engineerId?: string;
}) {
  const check = getOrCreateDailyTimeCheck(input);
  const store = loadStore();
  const key = checkKey(check.date, check.engineerId);
  const current = store.checks[key];
  if (!current) return check;
  current.blakePromptCount += 1;
  if (current.status === "not_started") current.status = "in_progress";
  current.updatedAt = new Date().toISOString();
  store.checks[key] = current;
  saveStore(store);
  return clone(current);
}

export function updateTimeCheckLine(input: {
  date?: string;
  engineerId?: string;
  scheduleId: string;
  actualStart?: string;
  actualEnd?: string;
  breakMinutes?: number;
  note?: string;
  confirmAsScheduled?: boolean;
}) {
  const check = getOrCreateDailyTimeCheck(input);
  const store = loadStore();
  const key = checkKey(check.date, check.engineerId);
  const current = store.checks[key];
  if (!current) throw new Error("Time check not found");

  const line = current.lines.find((item) => item.scheduleId === input.scheduleId);
  if (!line) throw new Error("Scheduled job not found on time check");

  if (input.confirmAsScheduled) {
    line.actualStart = line.scheduledStart;
    line.actualEnd = line.scheduledEnd;
    line.breakMinutes = 0;
    line.actualHours = line.scheduledHours;
    line.note = input.note?.trim() || "Confirmed as scheduled.";
    line.status = "confirmed";
  } else {
    line.actualStart = input.actualStart?.trim() || line.actualStart;
    line.actualEnd = input.actualEnd?.trim() || line.actualEnd;
    line.breakMinutes = Math.max(0, Number(input.breakMinutes ?? line.breakMinutes) || 0);
    line.actualHours = hoursBetween(line.actualStart, line.actualEnd, line.breakMinutes);
    line.note = input.note?.trim() || line.note;
    const matched =
      line.actualStart === line.scheduledStart
      && line.actualEnd === line.scheduledEnd
      && line.breakMinutes === 0
      && line.actualHours === line.scheduledHours;
    line.status = matched ? "confirmed" : "amended";
    if (matched && !line.note) line.note = "Confirmed as scheduled.";
  }

  current.status = "in_progress";
  current.updatedAt = new Date().toISOString();
  store.checks[key] = current;
  saveStore(store);
  return clone(current);
}

export function assignTimeCheckGap(input: {
  date?: string;
  engineerId?: string;
  hours: number;
  reason: TimeCheckGapReason;
  note?: string;
}) {
  const check = getOrCreateDailyTimeCheck(input);
  const store = loadStore();
  const key = checkKey(check.date, check.engineerId);
  const current = store.checks[key];
  if (!current) throw new Error("Time check not found");

  current.gaps = [
    {
      id: makeId("gap"),
      hours: Number(Math.max(0, input.hours).toFixed(2)),
      reason: input.reason,
      note: input.note?.trim() || "",
    },
    ...current.gaps,
  ];
  current.status = "in_progress";
  current.updatedAt = new Date().toISOString();
  store.checks[key] = current;
  saveStore(store);
  return clone(current);
}

export function submitDailyTimeCheck(input?: {
  date?: string;
  engineerId?: string;
  confirmRemainingAsScheduled?: boolean;
}) {
  let check = getOrCreateDailyTimeCheck(input);
  if (input?.confirmRemainingAsScheduled) {
    for (const line of check.lines.filter((item) => item.status === "pending")) {
      check = updateTimeCheckLine({
        date: check.date,
        engineerId: check.engineerId,
        scheduleId: line.scheduleId,
        confirmAsScheduled: true,
      });
    }
  }

  const pending = check.lines.filter((line) => line.status === "pending");
  if (pending.length) {
    throw new Error(
      `Blake still needs a review on ${pending.length} job${pending.length === 1 ? "" : "s"} before submitting.`,
    );
  }

  const store = loadStore();
  const key = checkKey(check.date, check.engineerId);
  const current = store.checks[key];
  if (!current) throw new Error("Time check not found");

  for (const line of current.lines) {
    if (line.status === "skipped") continue;
    applyEngineerWorkflowAction(line.scheduleId, {
      action: "add_time_entry",
      payload: {
        start: line.actualStart,
        end: line.actualEnd,
        breakMinutes: line.breakMinutes,
        note:
          line.note
          || (line.status === "amended"
            ? `Blake amended time: scheduled ${formatDuration(line.scheduledHours)}, actual ${formatDuration(line.actualHours)}.`
            : "Blake confirmed scheduled time."),
        createdBy: current.engineerName,
      },
    });
  }

  current.status = "submitted";
  current.submittedAt = new Date().toISOString();
  current.updatedAt = current.submittedAt;
  store.checks[key] = current;
  saveStore(store);
  return clone(current);
}

export function summariseTimeCheck(check: DailyTimeCheck) {
  const scheduledHours = check.lines.reduce((sum, line) => sum + line.scheduledHours, 0);
  const actualHours = check.lines.reduce((sum, line) => sum + line.actualHours, 0);
  const amendedCount = check.lines.filter((line) => line.status === "amended").length;
  const pendingCount = check.lines.filter((line) => line.status === "pending").length;
  const confirmedCount = check.lines.filter((line) => line.status === "confirmed").length;
  return {
    scheduledHours: Number(scheduledHours.toFixed(2)),
    actualHours: Number(actualHours.toFixed(2)),
    varianceHours: Number((actualHours - scheduledHours).toFixed(2)),
    amendedCount,
    pendingCount,
    confirmedCount,
    gapHours: Number(check.gaps.reduce((sum, gap) => sum + gap.hours, 0).toFixed(2)),
  };
}

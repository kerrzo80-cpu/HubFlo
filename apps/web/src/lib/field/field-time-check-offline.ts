"use client";

import {
  enqueueOutboxItem,
  isBrowserOnline,
  isOfflineOrNetworkError,
} from "@/lib/field/offline-outbox";
import type { DailyTimeCheck, TimeCheckLine, TimeCheckSummary } from "@/lib/field/types";

const TIME_CHECK_CACHE_KEY = "nexa-field-time-check-v1";

type TimeCheckActionBody = {
  action: "update_line" | "submit";
  payload?: Record<string, unknown>;
};

type CachedTimeCheck = {
  check: DailyTimeCheck;
  summary: TimeCheckSummary;
  savedAt: string;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function hoursBetween(start: string, end: string, breakMinutes = 0) {
  const startParts = start.split(":").map(Number);
  const endParts = end.split(":").map(Number);
  const startHour = startParts[0] ?? Number.NaN;
  const startMinute = startParts[1] ?? Number.NaN;
  const endHour = endParts[0] ?? Number.NaN;
  const endMinute = endParts[1] ?? Number.NaN;
  if ([startHour, startMinute, endHour, endMinute].some((value) => Number.isNaN(value))) return 0;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const worked = Math.max(0, endTotal - startTotal - Math.max(0, breakMinutes));
  return Number((worked / 60).toFixed(2));
}

export function summariseFieldTimeCheck(check: DailyTimeCheck): TimeCheckSummary {
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
  };
}

export function saveCachedTimeCheck(check: DailyTimeCheck, summary: TimeCheckSummary) {
  if (!canUseStorage()) return;
  try {
    const payload: CachedTimeCheck = {
      check,
      summary,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(TIME_CHECK_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota errors.
  }
}

export function readCachedTimeCheck(): CachedTimeCheck | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(TIME_CHECK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedTimeCheck>;
    if (!parsed?.check || !parsed.summary) return null;
    return {
      check: parsed.check,
      summary: parsed.summary,
      savedAt: String(parsed.savedAt || ""),
    };
  } catch {
    return null;
  }
}

function applyUpdateLine(check: DailyTimeCheck, payload: Record<string, unknown>) {
  const scheduleId = String(payload.scheduleId || "");
  const line = check.lines.find((item) => item.scheduleId === scheduleId);
  if (!line) throw new Error("Scheduled job not found on time check.");

  if (payload.confirmAsScheduled) {
    line.actualStart = line.scheduledStart;
    line.actualEnd = line.scheduledEnd;
    line.breakMinutes = 0;
    line.actualHours = line.scheduledHours;
    line.note = String(payload.note || "").trim() || "Confirmed as scheduled.";
    line.status = "confirmed";
  } else {
    line.actualStart = String(payload.actualStart || line.actualStart).trim() || line.actualStart;
    line.actualEnd = String(payload.actualEnd || line.actualEnd).trim() || line.actualEnd;
    line.breakMinutes = Math.max(0, Number(payload.breakMinutes ?? line.breakMinutes) || 0);
    line.actualHours = hoursBetween(line.actualStart, line.actualEnd, line.breakMinutes);
    line.note = String(payload.note || line.note || "").trim();
    const matched =
      line.actualStart === line.scheduledStart &&
      line.actualEnd === line.scheduledEnd &&
      line.breakMinutes === 0 &&
      line.actualHours === line.scheduledHours;
    line.status = matched ? "confirmed" : "amended";
    if (matched && !line.note) line.note = "Confirmed as scheduled.";
  }

  check.status = "in_progress";
  check.updatedAt = new Date().toISOString();
  return check;
}

function applySubmit(check: DailyTimeCheck, payload?: Record<string, unknown>) {
  if (payload?.confirmRemainingAsScheduled) {
    for (const line of check.lines.filter((item) => item.status === "pending")) {
      applyUpdateLine(check, {
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
  check.status = "submitted";
  check.submittedAt = new Date().toISOString();
  check.updatedAt = check.submittedAt;
  return check;
}

export function applyOfflineTimeCheckAction(
  check: DailyTimeCheck,
  body: TimeCheckActionBody,
): { check: DailyTimeCheck; summary: TimeCheckSummary } {
  const next = structuredClone(check);
  if (body.action === "update_line") {
    applyUpdateLine(next, body.payload || {});
  } else if (body.action === "submit") {
    applySubmit(next, body.payload);
  } else {
    throw new Error("Unknown time check action.");
  }
  const summary = summariseFieldTimeCheck(next);
  return { check: next, summary };
}

export async function postFieldTimeCheck(
  body: TimeCheckActionBody,
  currentCheck?: DailyTimeCheck | null,
): Promise<{ check: DailyTimeCheck; summary: TimeCheckSummary; offline?: boolean }> {
  const path = "/api/field/time-check";
  const requestBody = JSON.stringify(body);

  const queueOffline = () => {
    if (!currentCheck) throw new Error("No cached time check to update offline.");
    enqueueOutboxItem({
      kind: "hours",
      jobId: currentCheck.engineerId || currentCheck.id,
      path,
      method: "POST",
      body,
    });
    const result = applyOfflineTimeCheckAction(currentCheck, body);
    saveCachedTimeCheck(result.check, result.summary);
    return { ...result, offline: true };
  };

  if (!isBrowserOnline()) {
    return queueOffline();
  }

  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      check?: DailyTimeCheck;
      summary?: TimeCheckSummary;
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error || "Time check failed.");
    if (!payload.check || !payload.summary) throw new Error("Time check response was incomplete.");
    saveCachedTimeCheck(payload.check, payload.summary);
    return { check: payload.check, summary: payload.summary };
  } catch (error) {
    if (isOfflineOrNetworkError(error)) {
      return queueOffline();
    }
    throw error;
  }
}

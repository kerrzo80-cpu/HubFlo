import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type BoardPackSchedule = {
  enabled: boolean;
  to: string;
  cc?: string;
  /** 0=Sun … 1=Mon */
  weekday: number;
  hourUtc: number;
  lastSentAt?: string;
  lastError?: string;
  updatedAt?: string;
};

const STORE = "nexa-board-pack-schedule-v1";

const defaultSchedule: BoardPackSchedule = {
  enabled: false,
  to: "",
  weekday: 1,
  hourUtc: 8,
};

export function getBoardPackSchedule(): BoardPackSchedule {
  const stored = loadServerStore<Partial<BoardPackSchedule>>(STORE, defaultSchedule);
  return {
    enabled: Boolean(stored.enabled),
    to: String(stored.to || "").trim(),
    cc: String(stored.cc || "").trim() || undefined,
    weekday: Number.isFinite(Number(stored.weekday)) ? Number(stored.weekday) : 1,
    hourUtc: Number.isFinite(Number(stored.hourUtc)) ? Number(stored.hourUtc) : 8,
    lastSentAt: stored.lastSentAt,
    lastError: stored.lastError,
    updatedAt: stored.updatedAt,
  };
}

export function saveBoardPackSchedule(input: Partial<BoardPackSchedule>) {
  const current = getBoardPackSchedule();
  const next: BoardPackSchedule = {
    ...current,
    ...input,
    to: String(input.to ?? current.to).trim(),
    cc: String(input.cc ?? current.cc ?? "").trim() || undefined,
    enabled: Boolean(input.enabled ?? current.enabled),
    weekday: Number.isFinite(Number(input.weekday ?? current.weekday))
      ? Number(input.weekday ?? current.weekday)
      : 1,
    hourUtc: Number.isFinite(Number(input.hourUtc ?? current.hourUtc))
      ? Number(input.hourUtc ?? current.hourUtc)
      : 8,
    updatedAt: new Date().toISOString(),
  };
  if (next.enabled && !next.to) {
    throw new Error("Add at least one recipient email before enabling the board pack schedule.");
  }
  writeServerStore(STORE, next);
  return next;
}

export function markBoardPackSent(ok: boolean, error?: string) {
  const current = getBoardPackSchedule();
  const next: BoardPackSchedule = {
    ...current,
    lastSentAt: ok ? new Date().toISOString() : current.lastSentAt,
    lastError: ok ? undefined : error || "Send failed",
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE, next);
  return next;
}

/** True when cron should fire for this UTC instant (default Mon 08:00 UTC). */
export function shouldSendBoardPackNow(now = new Date(), schedule = getBoardPackSchedule()) {
  if (!schedule.enabled || !schedule.to) return false;
  if (now.getUTCDay() !== schedule.weekday) return false;
  if (now.getUTCHours() !== schedule.hourUtc) return false;
  if (schedule.lastSentAt) {
    const last = new Date(schedule.lastSentAt);
    const sameDay =
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate();
    if (sameDay) return false;
  }
  return true;
}

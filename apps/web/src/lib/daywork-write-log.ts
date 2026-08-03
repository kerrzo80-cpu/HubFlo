import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type DayworkWriteLog = {
  attempts: Array<{
    at: string;
    source: string;
    jobId?: string;
    costCentreId?: string;
    scheduleId?: string;
    ok: boolean;
    error?: string;
    materialsCount?: number;
    hasClientName?: boolean;
    hasSignatures?: boolean;
  }>;
};

const MAX_ATTEMPTS = 20;
const log = loadServerStore<DayworkWriteLog>("daywork-write-log", { attempts: [] });

function persist() {
  writeServerStore("daywork-write-log", log);
}

export function recordDayworkWriteAttempt(entry: DayworkWriteLog["attempts"][number]) {
  log.attempts = [entry, ...log.attempts].slice(0, MAX_ATTEMPTS);
  persist();
  return entry;
}

export function readDayworkWriteLog(): DayworkWriteLog {
  return JSON.parse(JSON.stringify(log)) as DayworkWriteLog;
}

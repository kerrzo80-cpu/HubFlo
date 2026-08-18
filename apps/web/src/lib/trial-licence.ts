import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isTrialInstance } from "@/lib/workspace-mode";

export const DEFAULT_TRIAL_DAYS = 30;
export const TRIAL_LICENCE_STORE_NAME = "trial-licence";
export const TRIAL_LICENCE_FILE_NAME = "trial-licence.json";
export const TRIAL_ENDED_PATH = "/trial-ended";
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TrialLicenceFile = {
  startedAt: string;
};

export type TrialLicenceStatus = {
  trial: boolean;
  expired: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  daysGranted: number | null;
};

const startedAtMemory = new Map<string, string>();
let statusCache: { key: string; at: number; status: TrialLicenceStatus } | null = null;
const STATUS_CACHE_MS = 8_000;

const expiredAllowExact = new Set([
  TRIAL_ENDED_PATH,
  "/login",
  "/api/health",
  "/api/health/smoke",
  "/api/trial-licence",
  "/api/branding",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
  "/apple-icon",
  "/icon",
]);

const expiredAllowPrefixes = ["/api/branding/", "/app-icons/", "/brand/", "/_next/"];

function parseIsoDate(value: string | undefined | null): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function trialDaysGranted(env: NodeJS.ProcessEnv): number {
  const raw = env.NEXA_TRIAL_DAYS?.trim();
  if (!raw) return DEFAULT_TRIAL_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) return DEFAULT_TRIAL_DAYS;
  return Math.min(3650, Math.floor(days));
}

function defaultLicenceDirectory(env: NodeJS.ProcessEnv): string {
  const storeDir = env.NEXA_STORE_DIR?.trim();
  if (storeDir) return storeDir;
  const sqlite = env.NEXA_STORE_PATH?.trim();
  if (sqlite) return path.dirname(sqlite);
  return path.join(process.cwd(), ".hubflo-runtime");
}

export function trialLicenceFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.NEXA_TRIAL_LICENCE_PATH?.trim();
  if (override) return override;
  return path.join(defaultLicenceDirectory(env), TRIAL_LICENCE_FILE_NAME);
}

function readLicenceFile(filePath: string): TrialLicenceFile | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrialLicenceFile;
    if (!parseIsoDate(parsed?.startedAt)) return null;
    return { startedAt: new Date(parsed.startedAt).toISOString() };
  } catch {
    return null;
  }
}

function writeLicenceFileIfAbsent(filePath: string, startedAt: string): TrialLicenceFile | null {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const fd = openSync(filePath, "wx");
    try {
      writeFileSync(fd, `${JSON.stringify({ startedAt }, null, 2)}\n`, "utf8");
    } finally {
      closeSync(fd);
    }
    return { startedAt };
  } catch {
    return readLicenceFile(filePath);
  }
}

/**
 * Persist first-boot startedAt. Existing file always wins so deploys, wipes,
 * and later env edits cannot restart the 30-day clock.
 */
export function ensureTrialLicenceStartedAt(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): string | null {
  if (!isTrialInstance(env)) return null;

  const filePath = trialLicenceFilePath(env);
  const existing = readLicenceFile(filePath);
  if (existing?.startedAt) {
    startedAtMemory.set(filePath, existing.startedAt);
    return existing.startedAt;
  }

  const remembered = startedAtMemory.get(filePath);
  if (remembered && parseIsoDate(remembered)) {
    writeLicenceFileIfAbsent(filePath, remembered);
    return readLicenceFile(filePath)?.startedAt || remembered;
  }

  const seeded = parseIsoDate(env.NEXA_TRIAL_STARTED_AT) || now;
  const startedAt = seeded.toISOString();
  const written = writeLicenceFileIfAbsent(filePath, startedAt);
  const resolved = written?.startedAt || startedAt;
  startedAtMemory.set(filePath, resolved);
  return resolved;
}

function cacheKey(env: NodeJS.ProcessEnv, now: Date): string {
  return [
    env.NEXA_TRIAL,
    env.NEXT_PUBLIC_APP_URL,
    env.NEXA_TRIAL_DAYS,
    env.NEXA_TRIAL_EXPIRES_AT,
    env.NEXA_TRIAL_STARTED_AT,
    trialLicenceFilePath(env),
    Math.floor(now.getTime() / STATUS_CACHE_MS),
  ].join("|");
}

export function getTrialLicenceStatus(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): TrialLicenceStatus {
  if (!isTrialInstance(env)) {
    return {
      trial: false,
      expired: false,
      startedAt: null,
      expiresAt: null,
      daysRemaining: null,
      daysGranted: null,
    };
  }

  const key = cacheKey(env, now);
  if (statusCache && statusCache.key === key && now.getTime() - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.status;
  }

  const daysGranted = trialDaysGranted(env);
  const startedAtRaw = ensureTrialLicenceStartedAt(env, now);
  const startedAt = parseIsoDate(startedAtRaw) || now;
  const expiresOverride = parseIsoDate(env.NEXA_TRIAL_EXPIRES_AT);
  const expiresAt = expiresOverride || new Date(startedAt.getTime() + daysGranted * MS_PER_DAY);
  const expired = now.getTime() >= expiresAt.getTime();
  const daysRemaining = expired ? 0 : Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY));

  const status: TrialLicenceStatus = {
    trial: true,
    expired,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    daysRemaining,
    daysGranted,
  };
  statusCache = { key, at: now.getTime(), status };
  return status;
}

export function isTrialAccessExpired(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()) {
  const status = getTrialLicenceStatus(env, now);
  return status.trial && status.expired;
}

export function isTrialExpiredAllowedPath(pathname: string) {
  if (expiredAllowExact.has(pathname)) return true;
  return expiredAllowPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function publicTrialLicence(status: TrialLicenceStatus) {
  return {
    trial: status.trial,
    expired: status.expired,
    daysRemaining: status.daysRemaining,
    daysGranted: status.daysGranted,
    expiresAt: status.expiresAt,
  };
}

export function resetTrialLicenceCache() {
  statusCache = null;
  startedAtMemory.clear();
}

import { createHash } from "node:crypto";

import { readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

/** Business + ops stores included in pilot backup (secrets like mailbox passwords excluded). */
export const PILOT_BACKUP_STORE_NAMES = [
  "people-store",
  "lead-store",
  "workflow-store",
  "hub-detail-store",
  "takeoff-store",
  "takeoff-rate-library-v1",
  "takeoff-learning-v1",
  "variation-portal-store",
  "survey-estimator-v1",
  "heat-design-v1",
  "daywork-sheets-store",
  "engineer-workflow-store",
  "engineer-time-checks",
  "blake-trainer",
  "nexa-openai-config",
  "nexa-sumup-config",
  "nexa-accounting-provider-v1",
  "employee-mailboxes",
] as const;

export type PilotBackupStoreName = (typeof PILOT_BACKUP_STORE_NAMES)[number];

export type PilotBackupPayload = {
  product: string;
  purpose: string;
  generatedAt: string;
  version: number;
  stores: Record<string, unknown>;
};

export type StoreSummary = {
  name: string;
  present: boolean;
  bytes: number;
  sha256: string | null;
  topLevelKeys?: string[];
  approxItems?: number;
};

function approxItemCount(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["leads", "quotes", "jobs", "invoices", "clients", "projects", "surveys", "estimates", "sheets", "users", "kits"]) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  if (record.jobs && typeof record.jobs === "object" && !Array.isArray(record.jobs)) {
    return Object.keys(record.jobs as object).length;
  }
  return undefined;
}

export function summariseStore(name: string, value: unknown | null): StoreSummary {
  if (value === null || value === undefined) {
    return { name, present: false, bytes: 0, sha256: null };
  }
  const json = JSON.stringify(value);
  const sha256 = createHash("sha256").update(json).digest("hex");
  const topLevelKeys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as object).slice(0, 24)
      : undefined;
  return {
    name,
    present: true,
    bytes: Buffer.byteLength(json, "utf8"),
    sha256,
    topLevelKeys,
    approxItems: approxItemCount(value),
  };
}

export function collectPilotBackup(): PilotBackupPayload {
  const stores = Object.fromEntries(
    PILOT_BACKUP_STORE_NAMES.map((name) => [name, readServerStoreSnapshot(name)]),
  );
  return {
    product: "NeXa pilot",
    purpose: "Ops backup",
    generatedAt: new Date().toISOString(),
    version: 2,
    stores,
  };
}

export function verifyPilotBackup(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return { ok: false as const, error: "Backup payload must be a JSON object." };
  }
  const body = payload as Partial<PilotBackupPayload>;
  if (!body.stores || typeof body.stores !== "object") {
    return { ok: false as const, error: "Backup is missing stores." };
  }
  const storeNames = Object.keys(body.stores);
  const known = storeNames.filter((name) =>
    (PILOT_BACKUP_STORE_NAMES as readonly string[]).includes(name),
  );
  const unknown = storeNames.filter(
    (name) => !(PILOT_BACKUP_STORE_NAMES as readonly string[]).includes(name),
  );
  const summaries = storeNames.map((name) => summariseStore(name, body.stores![name]));
  const present = summaries.filter((row) => row.present).length;
  return {
    ok: true as const,
    product: body.product || "unknown",
    purpose: body.purpose || "unknown",
    generatedAt: body.generatedAt || null,
    version: typeof body.version === "number" ? body.version : 1,
    storeCount: storeNames.length,
    knownStoreCount: known.length,
    unknownStores: unknown,
    presentStoreCount: present,
    totalBytes: summaries.reduce((sum, row) => sum + row.bytes, 0),
    stores: summaries,
  };
}

export function currentStoreVerification() {
  const backup = collectPilotBackup();
  return verifyPilotBackup(backup);
}

export type RestoreResult = {
  dryRun: boolean;
  applied: boolean;
  requiresRestart: boolean;
  written: string[];
  skipped: Array<{ name: string; reason: string }>;
  verification: ReturnType<typeof verifyPilotBackup>;
};

/**
 * Restore pilot stores from a backup payload.
 * dryRun=true validates and reports diffs only.
 * Auth/password hashes in auth-store are intentionally NOT in the backup set.
 */
export function restorePilotBackup(payload: unknown, options?: { dryRun?: boolean }): RestoreResult {
  const verification = verifyPilotBackup(payload);
  if (!verification.ok) {
    return {
      dryRun: Boolean(options?.dryRun),
      applied: false,
      requiresRestart: false,
      written: [],
      skipped: [{ name: "*", reason: verification.error }],
      verification,
    };
  }

  const body = payload as PilotBackupPayload;
  const dryRun = Boolean(options?.dryRun);
  const written: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const name of PILOT_BACKUP_STORE_NAMES) {
    if (!(name in body.stores)) {
      skipped.push({ name, reason: "missing from backup" });
      continue;
    }
    const next = body.stores[name];
    if (next === null || next === undefined) {
      skipped.push({ name, reason: "null snapshot — left unchanged" });
      continue;
    }
    if (dryRun) {
      written.push(name);
      continue;
    }
    const ok = writeServerStore(name, next);
    if (ok) written.push(name);
    else skipped.push({ name, reason: "write failed" });
  }

  return {
    dryRun,
    applied: !dryRun && written.length > 0,
    requiresRestart: !dryRun && written.length > 0,
    written,
    skipped,
    verification,
  };
}

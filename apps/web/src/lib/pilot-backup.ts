import { createHash } from "node:crypto";

import {
  deleteServerStore,
  getServerStoreBackend,
  loadServerStore,
  readServerStoreSnapshot,
  writeServerStore,
} from "@/lib/server-store";

/** Business + ops stores included in company backup (mailbox app passwords excluded). */
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

/** Preferred alias — same store set. */
export const COMPANY_BACKUP_STORE_NAMES = PILOT_BACKUP_STORE_NAMES;

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

const FIRE_DRILL_RESULT_STORE = "nexa-ops-firedrill-v1";
const PRE_RESTORE_SNAPSHOT_STORE = "nexa-pre-restore-snapshot-v1";
const SHADOW_PREFIX = "__firedrill__";

export type FireDrillResult = {
  ok: boolean;
  at: string;
  ms: number;
  storesChecked: number;
  storesMatched: number;
  mismatches: Array<{ name: string; reason: string }>;
  cleaned: number;
  backend: string;
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
    product: "NeXa company backup",
    purpose: "Company ops backup",
    generatedAt: new Date().toISOString(),
    version: 2,
    stores,
  };
}

export const collectCompanyBackup = collectPilotBackup;

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
  preRestoreSnapshotSaved?: boolean;
};

/**
 * Restore company stores from a backup payload.
 * dryRun=true validates and reports only.
 * Real apply saves a pre-restore snapshot first. Auth passwords are not in the backup set.
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
  let preRestoreSnapshotSaved = false;

  if (!dryRun) {
    const snapshot = collectPilotBackup();
    preRestoreSnapshotSaved = writeServerStore(PRE_RESTORE_SNAPSHOT_STORE, {
      savedAt: new Date().toISOString(),
      backup: snapshot,
    });
  }

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
    preRestoreSnapshotSaved,
  };
}

export function getLastFireDrillResult(): FireDrillResult | null {
  const stored = loadServerStore<{ result?: FireDrillResult }>(FIRE_DRILL_RESULT_STORE, {});
  return stored.result ?? null;
}

/**
 * Safe fire-drill: export live stores → write shadow copies → read back → hash match → delete shadows.
 * Does not overwrite live business stores.
 */
export function runRestoreFireDrill(options?: { persist?: boolean }): FireDrillResult {
  const started = Date.now();
  const backup = collectPilotBackup();
  const mismatches: Array<{ name: string; reason: string }> = [];
  let storesChecked = 0;
  let storesMatched = 0;
  let cleaned = 0;

  for (const name of PILOT_BACKUP_STORE_NAMES) {
    const value = backup.stores[name];
    if (value === null || value === undefined) continue;
    storesChecked += 1;
    const expected = summariseStore(name, value);
    const shadow = `${SHADOW_PREFIX}${name}`;
    const wrote = writeServerStore(shadow, value);
    if (!wrote) {
      mismatches.push({ name, reason: "shadow write failed" });
      continue;
    }
    const readBack = readServerStoreSnapshot(shadow);
    const actual = summariseStore(name, readBack);
    if (!actual.present || actual.sha256 !== expected.sha256) {
      mismatches.push({
        name,
        reason: `hash mismatch expected=${expected.sha256?.slice(0, 12)} got=${actual.sha256?.slice(0, 12) || "none"}`,
      });
    } else {
      storesMatched += 1;
    }
    if (deleteServerStore(shadow)) cleaned += 1;
  }

  const result: FireDrillResult = {
    ok: storesChecked > 0 && mismatches.length === 0,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    storesChecked,
    storesMatched,
    mismatches,
    cleaned,
    backend: getServerStoreBackend(),
  };

  if (options?.persist !== false) {
    writeServerStore(FIRE_DRILL_RESULT_STORE, { result });
  }

  return result;
}

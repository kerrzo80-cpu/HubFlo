import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { finished } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  BACKUP_EXCLUDED_STORE_NAMES,
  collectPilotBackup,
  isExcludedBackupStore,
  redactBackupStoreValue,
  restorePilotBackup,
} from "@/lib/pilot-backup";
import { uploadOfficeBackupToS3 } from "@/lib/office-backup-s3";
import {
  checkpointSqliteStore,
  getServerStoreBackend,
  getServerStoreDirectory,
  getSqliteStorePath,
  listServerStoreNames,
  loadServerStore,
  vacuumSqliteStoreInto,
  writeServerStore,
} from "@/lib/server-store";

export const OFFICE_BACKUP_STATUS_STORE = "nexa-office-backup-status-v1";

export const OFFICE_BACKUP_FILE_DIRS = [
  "takeoff-files",
  "survey-files",
  "field-photos",
  "record-documents",
  "branding",
  "xero-bills",
  "xero-exports",
] as const;

export const OFFICE_BACKUP_NAME_RE =
  /^nexa-[a-z0-9]+-backup-\d{8}T\d{6}Z\.tar\.gz$/;

const SECRET_DISK_FILE_RE =
  /(^|[/\\])(simpro_refresh_token\.txt|\.env(?:\..+)?|.*secret.*|.*credential.*)$/i;

export type OfficeBackupRecord = {
  id: string;
  filename: string;
  createdAt: string;
  bytes: number;
  storeCount: number;
  fileDirs: string[];
  sqliteIncluded: boolean;
  destination: "local" | "s3" | "local+s3";
  s3Key?: string;
  sha256?: string;
};

export type OfficeBackupStatus = {
  lastRunAt?: string;
  lastOkAt?: string;
  lastError?: string;
  lastFilename?: string;
  lastBytes?: number;
  lastDestination?: OfficeBackupRecord["destination"];
  running?: boolean;
  backups: OfficeBackupRecord[];
};

export type OfficeBackupResult = {
  ok: boolean;
  error?: string;
  record?: OfficeBackupRecord;
  pruned: string[];
  s3?: { uploaded: boolean; key?: string; error?: string };
};

let backupLock: Promise<OfficeBackupResult> | null = null;

function envInt(name: string, fallback: number) {
  const raw = Number(process.env[name]?.trim());
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback;
}

export function officeBackupRetentionDays() {
  return envInt("BACKUP_RETENTION_DAYS", 14);
}

export function officeBackupMaxTotalBytes() {
  return envInt("BACKUP_MAX_TOTAL_MB", 1536) * 1024 * 1024;
}

export function officeBackupWorkspaceLabel(env: NodeJS.ProcessEnv = process.env) {
  const url = env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (/nexa-live/i.test(url)) return "live";
  if (/nexa-pilot/i.test(url)) return "pilot";
  if (/nexa-trial/i.test(url)) return "trial";
  const mode = env.NEXA_WORKSPACE_MODE?.trim().toLowerCase();
  if (mode === "live") return "live";
  return "local";
}

export function officeBackupFileName(input: { workspace: string; at: Date }) {
  const stamp = input.at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const workspace = input.workspace.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "local";
  return `nexa-${workspace}-backup-${stamp}.tar.gz`;
}

export function isSecretDiskFileName(fileName: string) {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  if (base.endsWith(".sqlite") || base.endsWith(".sqlite-wal") || base.endsWith(".sqlite-shm")) return false;
  return SECRET_DISK_FILE_RE.test(fileName) || SECRET_DISK_FILE_RE.test(base);
}

export function getOfficeBackupDirectory() {
  const configured = process.env.NEXA_BACKUP_DIR?.trim();
  const dir = configured || path.join(getServerStoreDirectory(), "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function selectBackupsToDelete(
  files: Array<{ name: string; mtimeMs: number; bytes: number }>,
  options?: { keep?: number; maxTotalBytes?: number },
) {
  const keep = options?.keep ?? 14;
  const maxTotalBytes = options?.maxTotalBytes ?? officeBackupMaxTotalBytes();
  const matching = files
    .filter((file) => OFFICE_BACKUP_NAME_RE.test(file.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  const toDelete: string[] = [];
  let kept = 0;
  let total = 0;
  for (const file of matching) {
    const overCount = kept >= keep;
    const overBudget = kept >= 1 && total + file.bytes > maxTotalBytes;
    if (overCount || overBudget) {
      toDelete.push(file.name);
      continue;
    }
    kept += 1;
    total += file.bytes;
  }
  return toDelete;
}

function loadStatus(): OfficeBackupStatus {
  return loadServerStore<OfficeBackupStatus>(OFFICE_BACKUP_STATUS_STORE, { backups: [] });
}

function saveStatus(status: OfficeBackupStatus) {
  writeServerStore(OFFICE_BACKUP_STATUS_STORE, status);
}

export function getOfficeBackupStatus(): OfficeBackupStatus {
  const stored = loadStatus();
  const listed = listOfficeBackupFiles().map((file) => {
    const known = stored.backups.find((row) => row.filename === file.name);
    return (
      known || {
        id: file.name,
        filename: file.name,
        createdAt: new Date(file.mtimeMs).toISOString(),
        bytes: file.bytes,
        storeCount: 0,
        fileDirs: [],
        sqliteIncluded: false,
        destination: "local" as const,
      }
    );
  });
  return { ...stored, backups: listed, running: Boolean(backupLock) };
}

export function listOfficeBackupFiles() {
  const dir = getOfficeBackupDirectory();
  try {
    return readdirSync(dir)
      .filter((name) => OFFICE_BACKUP_NAME_RE.test(name))
      .map((name) => {
        const full = path.join(dir, name);
        const stat = statSync(full);
        return { name, full, mtimeMs: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

export function resolveOfficeBackupFile(filename: string) {
  const base = path.basename(filename);
  if (!OFFICE_BACKUP_NAME_RE.test(base)) return null;
  const full = path.join(getOfficeBackupDirectory(), base);
  if (!existsSync(full)) return null;
  return { filename: base, full, bytes: statSync(full).size };
}

/**
 * Extract stores.json from a local office tar.gz and dry-run (or apply) the JSON store restore.
 * Document folders / sqlite still need a manual server restore — this proves the office record snapshot is restorable.
 */
export async function restoreOfficeBackupStores(
  filename: string,
  options?: { dryRun?: boolean; confirm?: string },
) {
  const file = resolveOfficeBackupFile(filename);
  if (!file) {
    return { ok: false as const, error: "That backup file was not found.", dryRun: true };
  }

  const forceApply = options?.dryRun === false && options?.confirm === "RESTORE";
  const dryRun = !forceApply;
  const staging = path.join(os.tmpdir(), `nexa-office-restore-${process.pid}-${Date.now()}`);
  mkdirSync(staging, { recursive: true });

  try {
    await runCommand("tar", ["-xzf", file.full, "-C", staging, "./stores.json"]);
    const storesPath = path.join(staging, "stores.json");
    if (!existsSync(storesPath)) {
      return { ok: false as const, error: "Backup archive has no stores.json.", dryRun, filename: file.filename };
    }
    const backup = JSON.parse(readFileSync(storesPath, "utf8")) as unknown;
    const result = restorePilotBackup(backup, { dryRun });
    if (!result.verification.ok) {
      return {
        ok: false as const,
        error: "Backup stores.json failed verification.",
        dryRun,
        filename: file.filename,
        result,
      };
    }
    return {
      ok: true as const,
      dryRun,
      filename: file.filename,
      result,
      message: dryRun
        ? "Dry-run OK — office stores.json verifies and would restore. Pass dryRun:false and confirm:\"RESTORE\" to write stores (files/sqlite still manual)."
        : "Office stores restored from backup. Restart the service so in-memory modules reload. Document folders and sqlite still need a manual restore if required.",
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Office restore failed.",
      dryRun,
      filename: file.filename,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function pruneBackupFiles() {
  const files = listOfficeBackupFiles();
  const toDelete = selectBackupsToDelete(files, {
    keep: officeBackupRetentionDays(),
    maxTotalBytes: officeBackupMaxTotalBytes(),
  });
  for (const name of toDelete) {
    try {
      unlinkSync(path.join(getOfficeBackupDirectory(), name));
    } catch {
      // keep going
    }
  }
  return toDelete;
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

async function fileSha256(filePath: string) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

function scrubBackupSqlite(copyPath: string) {
  const database = new DatabaseSync(copyPath);
  try {
    for (const name of BACKUP_EXCLUDED_STORE_NAMES) {
      database.prepare("DELETE FROM pilot_store WHERE name = ?").run(name);
    }
    database.prepare("DELETE FROM pilot_store WHERE name LIKE ?").run("__firedrill__%");
    const rows = database.prepare("SELECT name, value FROM pilot_store").all() as Array<{ name: string; value: string }>;
    const update = database.prepare("UPDATE pilot_store SET value = ? WHERE name = ?");
    for (const row of rows) {
      if (isExcludedBackupStore(row.name)) {
        database.prepare("DELETE FROM pilot_store WHERE name = ?").run(row.name);
        continue;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        continue;
      }
      const redacted = redactBackupStoreValue(row.name, parsed);
      if (redacted === null) {
        database.prepare("DELETE FROM pilot_store WHERE name = ?").run(row.name);
        continue;
      }
      const next = JSON.stringify(redacted);
      if (next !== row.value) update.run(next, row.name);
    }
  } finally {
    const closer = database as { close?: () => void };
    closer.close?.();
  }
}

function presentFileDirs(storeDir: string) {
  return OFFICE_BACKUP_FILE_DIRS.filter((dir) => {
    try {
      return existsSync(path.join(storeDir, dir)) && statSync(path.join(storeDir, dir)).isDirectory();
    } catch {
      return false;
    }
  });
}

async function createOfficeBackupArchive(input: {
  now: Date;
  backupDir: string;
  storeDir: string;
  includeFiles: boolean;
}): Promise<{ filename: string; fullPath: string; bytes: number; storeCount: number; fileDirs: string[]; sqliteIncluded: boolean; sha256: string }> {
  const workspace = officeBackupWorkspaceLabel();
  const filename = officeBackupFileName({ workspace, at: input.now });
  const staging = path.join(os.tmpdir(), `nexa-backup-${process.pid}-${Date.now()}`);
  mkdirSync(path.join(staging, "sqlite"), { recursive: true });

  const payload = collectPilotBackup();
  writeFileSync(path.join(staging, "stores.json"), JSON.stringify(payload));

  checkpointSqliteStore();
  let sqliteIncluded = false;
  const sqliteCopy = path.join(staging, "sqlite", "nexa-store.sqlite");
  if (getSqliteStorePath() && vacuumSqliteStoreInto(sqliteCopy)) {
    try {
      scrubBackupSqlite(sqliteCopy);
      sqliteIncluded = true;
    } catch {
      try {
        unlinkSync(sqliteCopy);
      } catch {
        // ignore
      }
    }
  }

  const fileDirs = input.includeFiles ? presentFileDirs(input.storeDir) : [];
  const manifest = {
    product: "NeXa office backup",
    purpose: "Jobs, tenders, takeoffs, surveys and uploaded documents",
    workspace,
    generatedAt: input.now.toISOString(),
    version: 1,
    backend: getServerStoreBackend(),
    storeNames: listServerStoreNames().filter((name) => !isExcludedBackupStore(name)),
    storeCount: Object.values(payload.stores).filter((value) => value != null).length,
    fileDirs,
    sqliteIncluded,
    excludedStores: BACKUP_EXCLUDED_STORE_NAMES,
    note: "Passwords, API keys and OAuth tokens are not included. Download this file and keep it off this server. Restore is a manual server job.",
  };
  writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const archivePath = path.join(input.backupDir, filename);
  const tarArgs = ["-czf", archivePath, "-C", staging, "."];
  for (const dir of fileDirs) {
    tarArgs.push("-C", input.storeDir, dir);
  }
  try {
    await runCommand("tar", tarArgs);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const bytes = statSync(archivePath).size;
  return {
    filename,
    fullPath: archivePath,
    bytes,
    storeCount: manifest.storeCount,
    fileDirs,
    sqliteIncluded,
    sha256: await fileSha256(archivePath),
  };
}

async function runOfficeBackupUnlocked(options?: { now?: Date; includeFiles?: boolean; uploadToS3?: boolean }): Promise<OfficeBackupResult> {
  const now = options?.now ?? new Date();
  const includeFiles = options?.includeFiles !== false && process.env.NEXA_BACKUP_INCLUDE_FILES?.trim() !== "false";
  const status = loadStatus();
  status.running = true;
  status.lastRunAt = now.toISOString();
  status.lastError = undefined;
  saveStatus(status);

  try {
    const packed = await createOfficeBackupArchive({
      now,
      backupDir: getOfficeBackupDirectory(),
      storeDir: getServerStoreDirectory(),
      includeFiles,
    });
    let destination: OfficeBackupRecord["destination"] = "local";
    let s3Key: string | undefined;
    let s3Error: string | undefined;
    const shouldUpload = options?.uploadToS3 !== false;
    let s3Result: OfficeBackupResult["s3"] = { uploaded: false };
    if (shouldUpload) {
      s3Result = await uploadOfficeBackupToS3({
        filePath: packed.fullPath,
        filename: packed.filename,
        workspace: officeBackupWorkspaceLabel(),
      });
      if (s3Result.uploaded) {
        destination = "local+s3";
        s3Key = s3Result.key;
      } else if (s3Result.error && s3Result.error !== "not-configured") {
        s3Error = s3Result.error;
      }
    }

    const record: OfficeBackupRecord = {
      id: packed.filename,
      filename: packed.filename,
      createdAt: now.toISOString(),
      bytes: packed.bytes,
      storeCount: packed.storeCount,
      fileDirs: packed.fileDirs,
      sqliteIncluded: packed.sqliteIncluded,
      destination,
      s3Key,
      sha256: packed.sha256,
    };
    const pruned = pruneBackupFiles();
    const next: OfficeBackupStatus = {
      lastRunAt: now.toISOString(),
      lastOkAt: now.toISOString(),
      lastError: s3Error ? `Saved on this server. Off-site copy failed: ${s3Error}` : undefined,
      lastFilename: packed.filename,
      lastBytes: packed.bytes,
      lastDestination: destination,
      running: false,
      backups: [record, ...loadStatus().backups.filter((row) => row.filename !== record.filename)].slice(0, 30),
    };
    saveStatus(next);
    return { ok: true, record, pruned, s3: s3Result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed.";
    saveStatus({
      ...loadStatus(),
      lastRunAt: now.toISOString(),
      lastError: message,
      running: false,
    });
    return { ok: false, error: message, pruned: [] };
  }
}

export function runOfficeBackup(options?: { now?: Date; includeFiles?: boolean; uploadToS3?: boolean }) {
  if (backupLock) return backupLock;
  backupLock = runOfficeBackupUnlocked(options).finally(() => {
    backupLock = null;
  });
  return backupLock;
}

export function officeBackupIsStale(status: OfficeBackupStatus, now = Date.now()) {
  if (!status.lastOkAt) return true;
  const at = Date.parse(status.lastOkAt);
  if (!Number.isFinite(at)) return true;
  return now - at > 20 * 60 * 60 * 1000;
}

export function maybeRunScheduledOfficeBackup() {
  const status = getOfficeBackupStatus();
  if (status.running || backupLock) return { started: false, reason: "already-running" as const };
  if (!officeBackupIsStale(status)) return { started: false, reason: "fresh" as const };
  void runOfficeBackup();
  return { started: true, reason: "stale" as const };
}

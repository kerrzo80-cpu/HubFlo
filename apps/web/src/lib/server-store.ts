import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

// Treat empty/whitespace-only env values as unset. Nullish coalescing (??) keeps
// an empty string, so `NEXA_STORE_DIR=` in a .env file would otherwise resolve the
// store directory to "" and write every store file into the process CWD (repo root)
// instead of the ignored .hubflo-runtime directory / configured disk.
const SQLITE_STORE_PATH = process.env.NEXA_STORE_PATH?.trim() || undefined;
const CONFIGURED_STORE_DIR = process.env.NEXA_STORE_DIR?.trim() || undefined;
const STORE_DIR =
  CONFIGURED_STORE_DIR
  ?? (SQLITE_STORE_PATH ? path.dirname(SQLITE_STORE_PATH) : path.join(process.cwd(), ".hubflo-runtime"));
const STORE_FILE_EXT = ".json";

type StoreRow = {
  value: string;
};

let sqliteStore: DatabaseSync | null | undefined;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureStoreDirectory() {
  try {
    mkdirSync(STORE_DIR, { recursive: true });
  } catch {
    // If file system is read-only in a specific environment, we keep fallback to in-memory behavior.
  }
}

function getStoreFilePath(name: string) {
  return path.join(STORE_DIR, `${name}${STORE_FILE_EXT}`);
}

function getSqliteStore() {
  if (!SQLITE_STORE_PATH) return null;
  if (sqliteStore !== undefined) return sqliteStore;

  try {
    mkdirSync(path.dirname(SQLITE_STORE_PATH), { recursive: true });
    const database = new DatabaseSync(SQLITE_STORE_PATH);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS pilot_store (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    sqliteStore = database;
    return database;
  } catch {
    sqliteStore = null;
    return null;
  }
}

function readJsonStore<T>(name: string): T | null {
  try {
    const file = getStoreFilePath(name);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readSqliteStore<T>(name: string): T | null {
  const database = getSqliteStore();
  if (!database) return null;

  try {
    const row = database
      .prepare("SELECT value FROM pilot_store WHERE name = ?")
      .get(name) as StoreRow | undefined;
    if (!row?.value) return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function loadServerStore<T>(name: string, fallback: T): T {
  const seeded = clone(fallback);
  const sqliteValue = readSqliteStore<T>(name);
  if (sqliteValue) return sqliteValue;

  // A production workspace must never inherit local pilot/demo JSON when its
  // persistent SQLite disk is created for the first time.
  if (getSqliteStore() && process.env.NEXA_WORKSPACE_MODE?.trim().toLowerCase() === "live") {
    writeServerStore(name, seeded);
    return seeded;
  }

  const jsonValue = readJsonStore<T>(name);
  if (jsonValue) {
    writeServerStore(name, jsonValue);
    return jsonValue;
  }

  try {
    const file = getStoreFilePath(name);
    if (!existsSync(file)) {
      ensureStoreDirectory();
      writeServerStore(name, seeded);
      return seeded;
    }

    const raw = readFileSync(file, "utf8").trim();
    if (!raw) {
      writeServerStore(name, seeded);
      return seeded;
    }

    return JSON.parse(raw) as T;
  } catch {
    return seeded;
  }
}

export function writeServerStore<T>(name: string, value: T): boolean {
  const database = getSqliteStore();
  // Compact JSON — pretty-print nearly doubles peak memory on large BoQ / hub payloads
  // and was contributing to Render OOM during tender rebuild / heal.
  const payload = JSON.stringify(value);
  if (database) {
    try {
      database
        .prepare(`
          INSERT INTO pilot_store (name, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `)
        .run(name, payload, new Date().toISOString());
      return true;
    } catch {
      // Fall through to JSON when the configured SQLite store is unavailable.
    }
  }

  try {
    ensureStoreDirectory();
    const file = getStoreFilePath(name);
    writeFileSync(file, payload, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readServerStoreSnapshot(name: string): unknown | null {
  return readSqliteStore(name) ?? readJsonStore(name);
}

/** Remove a named store from SQLite and/or JSON disk. Used for fire-drill shadows. */
export function deleteServerStore(name: string): boolean {
  let ok = false;
  const database = getSqliteStore();
  if (database) {
    try {
      database.prepare("DELETE FROM pilot_store WHERE name = ?").run(name);
      ok = true;
    } catch {
      // fall through to JSON cleanup
    }
  }
  try {
    const file = getStoreFilePath(name);
    if (existsSync(file)) {
      unlinkSync(file);
      ok = true;
    }
  } catch {
    // ignore
  }
  return ok;
}

export function getServerStoreBackend() {
  return getSqliteStore() ? "sqlite" : "json";
}

export function getSqliteStorePath() {
  return SQLITE_STORE_PATH;
}

export function getServerStoreDirectory() {
  ensureStoreDirectory();
  return STORE_DIR;
}

/** Flush WAL so a file copy / VACUUM INTO sees the latest writes. */
export function checkpointSqliteStore() {
  const database = getSqliteStore();
  if (!database) return false;
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return true;
  } catch {
    return false;
  }
}

/** Consistent SQLite snapshot for backups. Destination must not already exist. */
export function vacuumSqliteStoreInto(destPath: string) {
  const database = getSqliteStore();
  if (!database) return false;
  try {
    mkdirSync(path.dirname(destPath), { recursive: true });
    if (existsSync(destPath)) unlinkSync(destPath);
    const escaped = destPath.replace(/'/g, "''");
    database.exec(`VACUUM INTO '${escaped}'`);
    return existsSync(destPath);
  } catch {
    return false;
  }
}

export function listServerStoreNames(): string[] {
  const names = new Set<string>();
  const database = getSqliteStore();
  if (database) {
    try {
      const rows = database.prepare("SELECT name FROM pilot_store").all() as Array<{ name?: string }>;
      for (const row of rows) {
        if (row?.name) names.add(row.name);
      }
    } catch {
      // ignore
    }
  }
  try {
    if (existsSync(STORE_DIR)) {
      for (const entry of readdirSync(STORE_DIR, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(STORE_FILE_EXT)) continue;
        names.add(entry.name.slice(0, -STORE_FILE_EXT.length));
      }
    }
  } catch {
    // ignore
  }
  return [...names].sort();
}

/** Delete named stores from SQLite and JSON, keeping the listed names. */
export function wipeAllServerStoresExcept(keep: string[]): { deleted: string[] } {
  const keepSet = new Set(keep);
  const deleted: string[] = [];
  for (const name of listServerStoreNames()) {
    if (keepSet.has(name)) continue;
    if (deleteServerStore(name)) deleted.push(name);
  }
  checkpointSqliteStore();
  return { deleted };
}

/** Remove uploaded files on the workspace disk (branding, takeoff PDFs, backups, …). */
export function wipeServerStoreDirectories(dirNames: string[]): string[] {
  ensureStoreDirectory();
  const removed: string[] = [];
  for (const name of dirNames) {
    const base = path.basename(name);
    if (!base || base === "." || base === "..") continue;
    const dir = path.join(STORE_DIR, base);
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(base);
    } catch {
      // Best-effort — SQLite wipe is the source of truth for records.
    }
  }
  return removed;
}

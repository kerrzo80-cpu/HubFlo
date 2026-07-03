import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const STORE_DIR =
  process.env.NEXA_STORE_DIR ?? path.join(process.cwd(), ".hubflo-runtime");
const SQLITE_STORE_PATH = process.env.NEXA_STORE_PATH;
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

export function writeServerStore<T>(name: string, value: T) {
  const database = getSqliteStore();
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
        .run(name, JSON.stringify(value, null, 2), new Date().toISOString());
      return;
    } catch {
      // Fall through to JSON when the configured SQLite store is unavailable.
    }
  }

  try {
    ensureStoreDirectory();
    const file = getStoreFilePath(name);
    writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // Keep writes best-effort in sandboxed environments.
  }
}

export function readServerStoreSnapshot(name: string): unknown | null {
  return readSqliteStore(name) ?? readJsonStore(name);
}

export function getServerStoreBackend() {
  return getSqliteStore() ? "sqlite" : "json";
}

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const STORE_DIR = path.join(process.cwd(), ".hubflo-runtime");
const STORE_FILE_EXT = ".json";

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

export function loadServerStore<T>(name: string, fallback: T): T {
  const file = getStoreFilePath(name);
  const seeded = clone(fallback);

  try {
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
  try {
    ensureStoreDirectory();
    const file = getStoreFilePath(name);
    writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // Keep writes best-effort in sandboxed environments.
  }
}

export function readServerStoreSnapshot(name: string): unknown | null {
  try {
    const file = getStoreFilePath(name);
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

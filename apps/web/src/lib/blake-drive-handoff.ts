import { createHash, randomBytes } from "node:crypto";

import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

type DriveHandoffRecord = {
  codeHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type DriveHandoffStore = { handoffs: DriveHandoffRecord[] };

const STORE_KEY = "blake-drive-handoffs-v1";
const lifetimeMs = 90 * 1000;
const store = loadServerStore<DriveHandoffStore>(STORE_KEY, { handoffs: [] });

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function refresh() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as Partial<DriveHandoffStore> | null;
  store.handoffs = Array.isArray(snapshot?.handoffs) ? snapshot.handoffs : [];
}

function prune() {
  const now = Date.now();
  store.handoffs = store.handoffs.filter((item) => Date.parse(item.expiresAt) > now).slice(-100);
}

function persist() {
  writeServerStore(STORE_KEY, store);
}

export function createBlakeDriveHandoff(userId: string) {
  refresh();
  prune();
  const code = randomBytes(32).toString("base64url");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
  store.handoffs.push({ codeHash: hashCode(code), userId, createdAt, expiresAt });
  persist();
  return { code, expiresAt };
}

/** Consume exactly once. Expired, unknown and already-used codes all return null. */
export function consumeBlakeDriveHandoff(code: string) {
  if (!code.trim()) return null;
  refresh();
  prune();
  const codeHash = hashCode(code.trim());
  const index = store.handoffs.findIndex((item) => item.codeHash === codeHash);
  if (index < 0) {
    persist();
    return null;
  }
  const [record] = store.handoffs.splice(index, 1);
  persist();
  if (!record || Date.parse(record.expiresAt) <= Date.now()) return null;
  return { userId: record.userId, createdAt: record.createdAt, expiresAt: record.expiresAt };
}

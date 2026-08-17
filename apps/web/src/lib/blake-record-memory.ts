/**
 * Persist Blake chat, trade scope, and rejected fixture classes on a tender / job / takeoff.
 */

import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  emptyBlakeTradeScope,
  mergeBlakeTradeScope,
  type BlakeTradeScope,
} from "@/lib/blake-trade-scope";

const STORE_NAME = "blake-record-memory-v1";
const MAX_MESSAGES = 40;
const MAX_RECORDS = 200;

export type BlakeStoredMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt: string;
};

export type BlakeRecordMemory = {
  key: string;
  messages: BlakeStoredMessage[];
  scope: BlakeTradeScope;
  rejectedCodes: string[];
  lastScanSummary?: string;
  updatedAt: string;
};

type Store = {
  records: Record<string, BlakeRecordMemory>;
};

function emptyStore(): Store {
  return { records: {} };
}

function emptyMemory(key: string): BlakeRecordMemory {
  return {
    key,
    messages: [],
    scope: emptyBlakeTradeScope(),
    rejectedCodes: [],
    updatedAt: new Date().toISOString(),
  };
}

function readStore(): Store {
  const raw = loadServerStore<Partial<Store>>(STORE_NAME, emptyStore());
  return {
    records: raw.records && typeof raw.records === "object" ? raw.records : {},
  };
}

function writeStore(store: Store) {
  const entries = Object.entries(store.records).sort((a, b) =>
    String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")),
  );
  store.records = Object.fromEntries(entries.slice(0, MAX_RECORDS));
  writeServerStore(STORE_NAME, store);
}

export function blakeRecordKey(kind: "tender" | "job" | "takeoff", id: string) {
  const clean = id.trim();
  if (!clean) return "";
  return `${kind}:${clean}`;
}

export function getBlakeRecordMemory(key: string): BlakeRecordMemory {
  if (!key) return emptyMemory("");
  const store = readStore();
  const existing = store.records[key];
  if (!existing) return emptyMemory(key);
  return {
    ...emptyMemory(key),
    ...existing,
    key,
    messages: Array.isArray(existing.messages) ? existing.messages : [],
    rejectedCodes: Array.isArray(existing.rejectedCodes) ? existing.rejectedCodes : [],
    scope: mergeBlakeTradeScope(emptyBlakeTradeScope(), existing.scope),
  };
}

function persistMemory(next: BlakeRecordMemory): BlakeRecordMemory {
  if (!next.key) return next;
  const store = readStore();
  store.records[next.key] = { ...next, updatedAt: new Date().toISOString() };
  writeStore(store);
  return store.records[next.key]!;
}

export function appendBlakeRecordMessages(
  key: string,
  messages: Array<{ role: "assistant" | "user"; text: string; id?: string }>,
): BlakeRecordMemory {
  const current = getBlakeRecordMemory(key);
  const stamp = new Date().toISOString();
  const nextMessages = [
    ...current.messages,
    ...messages
      .map((item) => ({
        id: item.id || `blake-${item.role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        role: item.role,
        text: String(item.text || "").slice(0, 8000),
        createdAt: stamp,
      }))
      .filter((item) => item.text.trim()),
  ].slice(-MAX_MESSAGES);
  return persistMemory({ ...current, messages: nextMessages, updatedAt: stamp });
}

export function recordBlakeRejectedCodes(key: string, codes: string[]): BlakeRecordMemory {
  const current = getBlakeRecordMemory(key);
  const nextCodes = [...current.rejectedCodes];
  for (const code of codes) {
    const clean = String(code || "").trim();
    if (!clean) continue;
    const exists = nextCodes.some((item) => item.toLowerCase() === clean.toLowerCase());
    if (!exists) nextCodes.push(clean);
  }
  return persistMemory({ ...current, rejectedCodes: nextCodes });
}

export function patchBlakeRecordScope(key: string, patch: Partial<BlakeTradeScope>): BlakeRecordMemory {
  const current = getBlakeRecordMemory(key);
  return persistMemory({
    ...current,
    scope: mergeBlakeTradeScope(current.scope, patch),
  });
}

export function setBlakeLastScanSummary(key: string, summary: string): BlakeRecordMemory {
  const current = getBlakeRecordMemory(key);
  return persistMemory({
    ...current,
    lastScanSummary: summary.trim().slice(0, 2000) || undefined,
  });
}

export function mergeBlakeMemories(memories: BlakeRecordMemory[]): BlakeRecordMemory {
  const merged = emptyMemory(memories[0]?.key || "");
  for (const memory of memories) {
    merged.scope = mergeBlakeTradeScope(merged.scope, memory.scope);
    merged.messages = [...merged.messages, ...memory.messages];
    merged.lastScanSummary = memory.lastScanSummary || merged.lastScanSummary;
    for (const code of memory.rejectedCodes) {
      if (!merged.rejectedCodes.some((item) => item.toLowerCase() === code.toLowerCase())) {
        merged.rejectedCodes.push(code);
      }
    }
  }
  merged.messages = merged.messages
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_MESSAGES);
  return merged;
}

export function loadBlakeMemoryForScreen(screen: {
  tenderId?: string | null;
  jobId?: string | null;
  takeoffId?: string | null;
}): BlakeRecordMemory {
  const keys = [
    screen.takeoffId ? blakeRecordKey("takeoff", screen.takeoffId) : "",
    screen.tenderId ? blakeRecordKey("tender", screen.tenderId) : "",
    screen.jobId ? blakeRecordKey("job", screen.jobId) : "",
  ].filter(Boolean);
  if (!keys.length) return emptyMemory("");
  return mergeBlakeMemories(keys.map((key) => getBlakeRecordMemory(key)));
}

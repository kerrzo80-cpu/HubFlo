"use client";

export type OutboxItemKind =
  | "checklist"
  | "daywork"
  | "photo"
  | "hours"
  | "outcome"
  | "note"
  | "po";

export type OutboxItem = {
  id: string;
  kind: OutboxItemKind;
  jobId: string;
  path: string;
  method: "POST" | "PUT" | "PATCH";
  body?: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
  dead?: boolean;
};

const MAX_OUTBOX_ATTEMPTS = 5;

type OutboxListener = (items: OutboxItem[]) => void;

const OUTBOX_KEY = "nexa-field-outbox-v1";
const outboxListeners = new Set<OutboxListener>();
let activeFlush: Promise<OutboxItem[]> | null = null;
let onlineFlushInstalled = false;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function makeOutboxId() {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `field-outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normaliseMethod(method: string): OutboxItem["method"] | null {
  const upper = method.toUpperCase();
  if (upper === "POST" || upper === "PUT" || upper === "PATCH") return upper;
  return null;
}

function normaliseKind(kind: string): OutboxItemKind | null {
  if (
    kind === "checklist" ||
    kind === "daywork" ||
    kind === "photo" ||
    kind === "hours" ||
    kind === "outcome" ||
    kind === "note" ||
    kind === "po"
  ) {
    return kind;
  }
  return null;
}

function normaliseItem(item: Partial<OutboxItem>): OutboxItem | null {
  const kind = normaliseKind(String(item.kind || ""));
  const method = normaliseMethod(String(item.method || ""));
  const path = String(item.path || "").trim();
  const jobId = String(item.jobId || "").trim();
  if (!kind || !method || !path || !jobId) return null;
  return {
    id: String(item.id || makeOutboxId()),
    kind,
    jobId,
    path,
    method,
    body: item.body,
    createdAt: String(item.createdAt || new Date().toISOString()),
    attempts: Number.isFinite(item.attempts) ? Number(item.attempts) : 0,
    lastError: item.lastError ? String(item.lastError) : undefined,
    dead: Boolean(item.dead) || Number(item.attempts) >= MAX_OUTBOX_ATTEMPTS,
  };
}

export function isOutboxItemDead(item: OutboxItem) {
  return item.dead || item.attempts >= MAX_OUTBOX_ATTEMPTS;
}

export function countPendingOutbox(items: OutboxItem[]) {
  return items.filter((item) => !isOutboxItemDead(item)).length;
}

export function countDeadOutbox(items: OutboxItem[]) {
  return items.filter((item) => isOutboxItemDead(item)).length;
}

export function listDeadOutbox(items?: OutboxItem[]) {
  const rows = items ?? listOutbox();
  return rows.filter((item) => isOutboxItemDead(item));
}

export function clearDeadOutboxItems() {
  const next = listOutbox().filter((item) => !isOutboxItemDead(item));
  writeOutboxItems(next);
  return next;
}

export function findDeadOutboxForJob(jobId: string, kind?: OutboxItemKind) {
  return listDeadOutbox().filter(
    (item) => item.jobId === jobId && (!kind || item.kind === kind),
  );
}

function readOutboxItems(): OutboxItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normaliseItem(item as Partial<OutboxItem>))
      .filter((item): item is OutboxItem => Boolean(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

function writeOutboxItems(items: OutboxItem[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  notifyOutboxListeners(items);
}

function notifyOutboxListeners(items = readOutboxItems()) {
  for (const listener of outboxListeners) {
    listener(items);
  }
}

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function isOfflineOrNetworkError(error: unknown) {
  if (!isBrowserOnline()) return true;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`.toLowerCase()
      : String(error).toLowerCase();
  return [
    "aborted",
    "failed to fetch",
    "load failed",
    "network",
    "networkerror",
    "network request failed",
    "offline",
  ].some((part) => message.includes(part));
}

export function listOutbox() {
  return readOutboxItems();
}

export function enqueueOutboxItem(
  input: Omit<OutboxItem, "id" | "createdAt" | "attempts" | "lastError"> &
    Partial<Pick<OutboxItem, "id" | "createdAt" | "attempts" | "lastError">>,
) {
  const item = normaliseItem({
    ...input,
    id: input.id || makeOutboxId(),
    createdAt: input.createdAt || new Date().toISOString(),
    attempts: input.attempts ?? 0,
  });
  if (!item) {
    throw new Error("Cannot queue offline Field change: invalid outbox item.");
  }
  const items = [...readOutboxItems(), item];
  writeOutboxItems(items);
  return item;
}

export function removeOutboxItem(id: string) {
  const items = readOutboxItems().filter((item) => item.id !== id);
  writeOutboxItems(items);
  return items;
}

export async function flushOutbox() {
  if (activeFlush) return activeFlush;
  activeFlush = flushOutboxItems().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

async function flushOutboxItems() {
  if (!isBrowserOnline()) return readOutboxItems();

  let remaining = readOutboxItems();
  for (const item of [...remaining]) {
    if (isOutboxItemDead(item)) continue;
    try {
      const response = await fetch(item.path, {
        method: item.method,
        credentials: "include",
        cache: "no-store",
        headers: item.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: item.body === undefined ? undefined : JSON.stringify(item.body),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        const message = failed.error || `Sync failed (${response.status})`;
        const attempts = item.attempts + 1;
        const clientError = response.status >= 400 && response.status < 500 && response.status !== 401;
        const dead = clientError || attempts >= MAX_OUTBOX_ATTEMPTS;
        remaining = remaining.map((queued) =>
          queued.id === item.id
            ? { ...queued, attempts, lastError: message, dead }
            : queued,
        );
        writeOutboxItems(remaining);
        continue;
      }
      remaining = remaining.filter((queued) => queued.id !== item.id);
      writeOutboxItems(remaining);
    } catch (flushError) {
      const message = flushError instanceof Error ? flushError.message : "Could not sync offline change.";
      const attempts = item.attempts + 1;
      const dead = attempts >= MAX_OUTBOX_ATTEMPTS;
      remaining = remaining.map((queued) =>
        queued.id === item.id
          ? { ...queued, attempts, lastError: message, dead }
          : queued,
      );
      writeOutboxItems(remaining);
      if (!isBrowserOnline()) break;
    }
  }

  return remaining;
}

export function subscribeOutbox(listener: OutboxListener) {
  outboxListeners.add(listener);
  listener(readOutboxItems());
  installOnlineFlush();
  return () => {
    outboxListeners.delete(listener);
  };
}

function installOnlineFlush() {
  if (onlineFlushInstalled || typeof window === "undefined") return;
  onlineFlushInstalled = true;
  window.addEventListener("online", () => {
    void flushOutbox();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === OUTBOX_KEY) notifyOutboxListeners();
  });
  if (isBrowserOnline()) {
    window.setTimeout(() => {
      void flushOutbox();
    }, 0);
  }
}

installOnlineFlush();

import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type RecordLockType = "lead" | "quote" | "job" | "invoice" | "po" | "tender";

export type RecordEditLock = {
  key: string;
  recordType: RecordLockType;
  recordId: string;
  holderUserId: string;
  holderName: string;
  holderEmployeeId?: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
};

export type RecordLockAccessRequest = {
  id: string;
  lockKey: string;
  requesterUserId: string;
  requesterName: string;
  requestedAt: string;
  status: "pending" | "granted" | "dismissed";
};

type RecordLockStore = {
  locks: RecordEditLock[];
  requests: RecordLockAccessRequest[];
};

const STORE_NAME = "record-edit-locks-v1";
const LOCK_TTL_MS = 12 * 60 * 1000;
const emptyStore: RecordLockStore = { locks: [], requests: [] };

function nowIso() {
  return new Date().toISOString();
}

function store() {
  return loadServerStore<RecordLockStore>(STORE_NAME, emptyStore);
}

function persist(next: RecordLockStore) {
  writeServerStore(STORE_NAME, next);
}

function pruneExpired(locks: RecordEditLock[]) {
  const now = Date.now();
  return locks.filter((lock) => Date.parse(lock.expiresAt) > now);
}

export function recordLockKey(recordType: RecordLockType, recordId: string) {
  return `${recordType}:${recordId.trim()}`;
}

export function parseRecordLockKey(key: string): { recordType: RecordLockType; recordId: string } | null {
  const match = key.match(/^(lead|quote|job|invoice|po|tender):(.+)$/);
  if (!match) return null;
  return { recordType: match[1] as RecordLockType, recordId: match[2] };
}

export function getActiveRecordLock(key: string): RecordEditLock | null {
  const current = store();
  const locks = pruneExpired(current.locks);
  if (locks.length !== current.locks.length) {
    persist({ ...current, locks });
  }
  return locks.find((lock) => lock.key === key) ?? null;
}

export function listActiveRecordLocks() {
  const current = store();
  const locks = pruneExpired(current.locks);
  if (locks.length !== current.locks.length) {
    persist({ ...current, locks });
  }
  return locks;
}

export type AcquireRecordLockInput = {
  recordType: RecordLockType;
  recordId: string;
  holderUserId: string;
  holderName: string;
  holderEmployeeId?: string;
};

export type AcquireRecordLockResult =
  | { ok: true; lock: RecordEditLock; mode: "editor" | "viewer" }
  | { ok: false; reason: "invalid" };

export function acquireRecordLock(input: AcquireRecordLockInput): AcquireRecordLockResult {
  const recordId = input.recordId.trim();
  if (!recordId) return { ok: false, reason: "invalid" };
  const key = recordLockKey(input.recordType, recordId);
  const current = store();
  const locks = pruneExpired(current.locks);
  const existing = locks.find((lock) => lock.key === key);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  if (existing && existing.holderUserId !== input.holderUserId) {
    return { ok: true, lock: existing, mode: "viewer" };
  }

  const lock: RecordEditLock = {
    key,
    recordType: input.recordType,
    recordId,
    holderUserId: input.holderUserId,
    holderName: input.holderName,
    holderEmployeeId: input.holderEmployeeId,
    acquiredAt: existing?.acquiredAt ?? now,
    heartbeatAt: now,
    expiresAt,
  };
  const nextLocks = [...locks.filter((row) => row.key !== key), lock];
  persist({ locks: nextLocks, requests: current.requests });
  return { ok: true, lock, mode: "editor" };
}

export function heartbeatRecordLock(key: string, userId: string) {
  const current = store();
  const locks = pruneExpired(current.locks);
  const index = locks.findIndex((lock) => lock.key === key && lock.holderUserId === userId);
  if (index < 0) return null;
  const now = nowIso();
  const lock = {
    ...locks[index],
    heartbeatAt: now,
    expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
  };
  locks[index] = lock;
  persist({ locks, requests: current.requests });
  return lock;
}

export function releaseRecordLock(key: string, userId: string) {
  const current = store();
  const locks = pruneExpired(current.locks).filter(
    (lock) => !(lock.key === key && lock.holderUserId === userId),
  );
  persist({ locks, requests: current.requests });
  return true;
}

export function requestRecordLockAccess(input: {
  key: string;
  requesterUserId: string;
  requesterName: string;
}) {
  const lock = getActiveRecordLock(input.key);
  if (!lock || lock.holderUserId === input.requesterUserId) {
    return { ok: false as const, reason: "no-lock" as const };
  }
  const current = store();
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request: RecordLockAccessRequest = {
    id,
    lockKey: input.key,
    requesterUserId: input.requesterUserId,
    requesterName: input.requesterName,
    requestedAt: nowIso(),
    status: "pending",
  };
  const requests = [
    ...current.requests.filter(
      (row) => !(row.lockKey === input.key && row.requesterUserId === input.requesterUserId && row.status === "pending"),
    ),
    request,
  ];
  persist({ locks: current.locks, requests });
  return { ok: true as const, request, holderName: lock.holderName };
}

export function grantRecordLockAccess(requestId: string, holderUserId: string) {
  const current = store();
  const request = current.requests.find((row) => row.id === requestId && row.status === "pending");
  if (!request) return { ok: false as const, reason: "missing" as const };
  const lock = getActiveRecordLock(request.lockKey);
  if (!lock || lock.holderUserId !== holderUserId) {
    return { ok: false as const, reason: "not-holder" as const };
  }
  const locks = pruneExpired(current.locks).filter((row) => row.key !== request.lockKey);
  const requests = current.requests.map((row) =>
    row.id === requestId ? { ...row, status: "granted" as const } : row,
  );
  persist({ locks, requests });
  return { ok: true as const, key: request.lockKey, requesterUserId: request.requesterUserId };
}

export class RecordLockConflictError extends Error {
  holderName: string;
  holderUserId: string;

  constructor(lock: RecordEditLock) {
    super(`Record is being edited by ${lock.holderName}.`);
    this.name = "RecordLockConflictError";
    this.holderName = lock.holderName;
    this.holderUserId = lock.holderUserId;
  }
}

/** Server-side write guard — throws when another user holds the edit lock. */
export function assertRecordLockForWrite(input: {
  recordType: RecordLockType;
  recordId: string;
  userId: string;
}) {
  const key = recordLockKey(input.recordType, input.recordId);
  const lock = getActiveRecordLock(key);
  if (!lock) return;
  if (lock.holderUserId !== input.userId) {
    throw new RecordLockConflictError(lock);
  }
}

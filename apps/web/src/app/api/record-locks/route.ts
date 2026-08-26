import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-request";
import {
  acquireRecordLock,
  getActiveRecordLock,
  grantRecordLockAccess,
  heartbeatRecordLock,
  listActiveRecordLocks,
  parseRecordLockKey,
  releaseRecordLock,
  requestRecordLockAccess,
  type RecordLockType,
} from "@/lib/record-edit-locks";

function lockResponse(lock: NonNullable<ReturnType<typeof getActiveRecordLock>>, mode: "editor" | "viewer") {
  return NextResponse.json({
    ok: true,
    mode,
    lock: {
      key: lock.key,
      recordType: lock.recordType,
      recordId: lock.recordId,
      holderName: lock.holderName,
      holderUserId: lock.holderUserId,
      expiresAt: lock.expiresAt,
    },
  });
}

export async function GET(request: Request) {
  const user = getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim();
  if (key) {
    const lock = getActiveRecordLock(key);
    if (!lock) return NextResponse.json({ ok: true, mode: "editor", lock: null });
    const mode = lock.holderUserId === user.id ? "editor" : "viewer";
    return lockResponse(lock, mode);
  }

  return NextResponse.json({ ok: true, locks: listActiveRecordLocks() });
}

export async function POST(request: Request) {
  const user = getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    action?: string;
    key?: string;
    recordType?: RecordLockType;
    recordId?: string;
    requestId?: string;
  } | null;

  const action = body?.action?.trim();
  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  if (action === "acquire") {
    const recordType = body?.recordType;
    const recordId = body?.recordId?.trim() || "";
    if (!recordType || !recordId) {
      return NextResponse.json({ error: "recordType and recordId required" }, { status: 400 });
    }
    const result = acquireRecordLock({
      recordType,
      recordId,
      holderUserId: user.id,
      holderName: user.name,
      holderEmployeeId: user.employeeId,
    });
    if (!result.ok) return NextResponse.json({ error: "Invalid record" }, { status: 400 });
    return lockResponse(result.lock, result.mode);
  }

  if (action === "heartbeat" || action === "release") {
    const key = body?.key?.trim() || "";
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    if (action === "release") {
      releaseRecordLock(key, user.id);
      return NextResponse.json({ ok: true });
    }
    const lock = heartbeatRecordLock(key, user.id);
    if (!lock) return NextResponse.json({ ok: false, error: "Lock not held" }, { status: 404 });
    return lockResponse(lock, "editor");
  }

  if (action === "request-access") {
    const key = body?.key?.trim() || "";
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    const result = requestRecordLockAccess({
      key,
      requesterUserId: user.id,
      requesterName: user.name,
    });
    if (!result.ok) return NextResponse.json({ error: "No active lock" }, { status: 409 });
    return NextResponse.json({
      ok: true,
      holderName: result.holderName,
      message: `Access request sent to ${result.holderName}.`,
    });
  }

  if (action === "grant-access") {
    const requestId = body?.requestId?.trim() || "";
    if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });
    const result = grantRecordLockAccess(requestId, user.id);
    if (!result.ok) return NextResponse.json({ error: "Unable to grant access" }, { status: 409 });
    return NextResponse.json({ ok: true, key: result.key });
  }

  const parsed = body?.key ? parseRecordLockKey(body.key) : null;
  if (parsed && action === "force-release") {
    const lock = getActiveRecordLock(body!.key!);
    if (lock && lock.holderUserId === user.id) {
      releaseRecordLock(body!.key!, user.id);
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

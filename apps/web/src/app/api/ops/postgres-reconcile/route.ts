import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { listServerStoreNames, readServerStoreSnapshot } from "@/lib/server-store";
import { postgresMirrorSnapshot, storeContentHash, writePostgresMirror } from "@/lib/postgres-store-mirror";

function expectedReconcileSecret() {
  return process.env.NEXA_BACKUP_CRON_SECRET?.trim()
    || process.env.NEXA_IMPORT_TICK_SECRET?.trim()
    || "";
}

function providedReconcileSecret(request: Request) {
  return (
    request.headers.get("x-nexa-backup-secret")?.trim()
    || request.headers.get("x-nexa-import-tick-secret")?.trim()
    || ""
  );
}

function canReconcile(request: Request) {
  const expected = expectedReconcileSecret();
  const provided = providedReconcileSecret(request);
  if (expected && provided === expected) return true;
  return getAccessProfileFromHeaders(request.headers).canCustomize;
}

export async function GET(request: Request) {
  if (!canReconcile(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const source = listServerStoreNames().map((name) => ({ name, contentHash: storeContentHash(readServerStoreSnapshot(name)) }));
  const target = await postgresMirrorSnapshot();
  const targetByName = new Map(target.rows.map((row) => [row.name, row.content_hash]));
  const missing = source.filter((row) => !targetByName.has(row.name)).map((row) => row.name);
  const mismatched = source.filter((row) => targetByName.has(row.name) && targetByName.get(row.name) !== row.contentHash).map((row) => row.name);
  return NextResponse.json({
    ok: target.connected && missing.length === 0 && mismatched.length === 0,
    sourceBackend: "sqlite/json",
    targetBackend: "postgresql",
    sourceCount: source.length,
    targetCount: target.rows.length,
    missing,
    mismatched,
    cutoverAllowed: target.connected && missing.length === 0 && mismatched.length === 0,
  });
}

export async function POST(request: Request) {
  if (!canReconcile(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const stores = listServerStoreNames().map((name) => ({ name, value: readServerStoreSnapshot(name) }));
  try {
    for (const store of stores) await writePostgresMirror(store.name, store.value);
    return NextResponse.json({ ok: true, mirrored: stores.length, message: "PostgreSQL mirror backfill completed. Run GET to verify hashes before cutover." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}

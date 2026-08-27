import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { NextResponse } from "next/server";

const LOG_PATH = "/opt/cursor/logs/debug.log";

/** Temporary debug sink for Ready-to-invoice / Complete white-screen investigation. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${JSON.stringify({ ...body, timestamp: Date.now() })}\n`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { NextResponse } from "next/server";

const LOG_PATH = "/opt/cursor/logs/debug.log";

/** Temporary agent debug sink — writes NDJSON for hypothesis checks. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(
      LOG_PATH,
      `${JSON.stringify({
        ...(body && typeof body === "object" ? body : { message: String(body) }),
        timestamp: Date.now(),
      })}\n`,
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent, getAuditEvents, type AuditEventInput } from "@/lib/people-data";

export async function GET() {
  return NextResponse.json(getAuditEvents());
}

export async function POST(request: Request) {
  const payload = await parseJsonRequestBody<Partial<AuditEventInput>>(request);

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !payload.actor ||
    !payload.action ||
    !payload.recordType ||
    !payload.recordId ||
    !payload.summary ||
    !payload.source
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const event = appendAuditEvent({
    actor: payload.actor,
    action: payload.action,
    recordType: payload.recordType,
    recordId: payload.recordId,
    summary: payload.summary,
    source: payload.source,
    importance: payload.importance ?? "normal",
  });

  return NextResponse.json(event, { status: 201 });
}

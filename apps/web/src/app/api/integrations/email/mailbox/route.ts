import { NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import {
  clearEmployeeMailbox,
  getEmployeeMailboxStatus,
  saveEmployeeMailboxSettings,
  type EmployeeMailboxInput,
} from "@/lib/employee-mailbox-store";

function resolveTargetEmployeeId(request: Request, requestedId?: string | null):
  | { ok: true; targetId: string }
  | { ok: false; response: NextResponse } {
  const access = getAccessProfileFromHeaders(request.headers);
  const callerId = request.headers.get(employeeHeaderName)?.trim() || "";
  const targetId = (requestedId ?? callerId).trim();
  if (!targetId) {
    return { ok: false, response: NextResponse.json({ error: "Employee id is required." }, { status: 422 }) };
  }
  if (targetId !== callerId && !access.canCustomize) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, targetId };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resolved = resolveTargetEmployeeId(request, url.searchParams.get("employeeId"));
  if (!resolved.ok) return resolved.response;
  return NextResponse.json(getEmployeeMailboxStatus(resolved.targetId));
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null) as (Partial<EmployeeMailboxInput> & { employeeId?: string }) | null;
  const resolved = resolveTargetEmployeeId(request, body?.employeeId);
  if (!resolved.ok) return resolved.response;

  if (!body?.provider || !body.senderEmail || !body.username) {
    return NextResponse.json({ error: "Provider, sender email and username are required." }, { status: 422 });
  }

  try {
    const status = saveEmployeeMailboxSettings(resolved.targetId, {
      provider: body.provider,
      senderEmail: body.senderEmail,
      username: body.username,
      secret: typeof body.secret === "string" ? body.secret : "",
      smtpHost: typeof body.smtpHost === "string" ? body.smtpHost : undefined,
      smtpPort: typeof body.smtpPort === "number" ? body.smtpPort : undefined,
      secure: typeof body.secure === "boolean" ? body.secure : undefined,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    });
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save mailbox settings." },
      { status: 422 },
    );
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const body = await request.json().catch(() => null) as { employeeId?: string } | null;
  const resolved = resolveTargetEmployeeId(request, body?.employeeId ?? url.searchParams.get("employeeId"));
  if (!resolved.ok) return resolved.response;
  return NextResponse.json(clearEmployeeMailbox(resolved.targetId));
}

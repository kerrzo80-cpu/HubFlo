import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-request";
import { createBlakeDriveHandoff } from "@/lib/blake-drive-handoff";
import { appendAuditEvent } from "@/lib/people-data";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to Blake mobile again." }, { status: 401 });
  if (user.mustChangePassword) {
    return NextResponse.json({ error: "Open NeXa Core and change your password before using Driving Mode." }, { status: 403 });
  }

  const handoff = createBlakeDriveHandoff(user.id);
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const origin = configuredOrigin || new URL(request.url).origin;
  const url = `${origin}/api/blake/drive-handoff/redeem?code=${encodeURIComponent(handoff.code)}`;

  appendAuditEvent({
    actor: user.name,
    action: "started Blake Driving Mode handoff",
    recordType: "employee",
    recordId: user.employeeId || user.id,
    summary: "A one-time mobile-to-browser Blake Driving Mode handoff was created.",
    source: "Blake mobile",
    importance: "normal",
  });

  return NextResponse.json(
    { url, expiresAt: handoff.expiresAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}

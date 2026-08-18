import { NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { getEmployeeMailboxStatus, testEmployeeMailboxConnection } from "@/lib/employee-mailbox-store";

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  const body = await request.json().catch(() => null) as { employeeId?: string } | null;
  const callerId = request.headers.get(employeeHeaderName)?.trim() || "";
  const targetId = (body?.employeeId ?? callerId).trim();

  if (!targetId) {
    return NextResponse.json({ error: "Employee id is required." }, { status: 422 });
  }
  if (targetId !== callerId && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const status = await testEmployeeMailboxConnection(targetId);
    return NextResponse.json({
      ok: true,
      message: `Authenticated and sent a test email to ${status.lastTestRecipient}.`,
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to test the mailbox connection.",
        status: getEmployeeMailboxStatus(targetId),
      },
      { status: 422 },
    );
  }
}

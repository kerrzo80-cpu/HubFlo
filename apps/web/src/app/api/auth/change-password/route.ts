import { NextRequest, NextResponse } from "next/server";

import {
  changeOwnPassword,
  createUserSession,
  getAuthUserForSession,
  isUserAuthenticationEnabled,
  nexaSessionCookie,
  nexaSessionMaxAgeSeconds,
} from "@/lib/auth-store";
import { appendAuditEvent } from "@/lib/people-data";

/** Change the signed-in user's password (clears mustChangePassword). */
export async function POST(request: NextRequest) {
  if (!isUserAuthenticationEnabled()) {
    return NextResponse.json({ error: "Individual user authentication is not enabled." }, { status: 409 });
  }

  const token = request.cookies.get(nexaSessionCookie)?.value;
  const user = getAuthUserForSession(token);
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  } | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  try {
    const updated = changeOwnPassword(user.id, currentPassword, newPassword);
    const session = createUserSession(updated.id);
    const response = NextResponse.json({
      ok: true,
      user: updated,
      message: "Password updated. Continue in NeXa.",
    });
    response.cookies.set(nexaSessionCookie, session.token, {
      httpOnly: true,
      maxAge: nexaSessionMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
    });
    appendAuditEvent({
      actor: updated.name,
      action: "changed password",
      recordType: "employee",
      recordId: updated.employeeId || updated.id,
      summary: `${updated.name} changed their NeXa password.`,
      source: "authentication",
      importance: "high",
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to change password." },
      { status: 400 },
    );
  }
}

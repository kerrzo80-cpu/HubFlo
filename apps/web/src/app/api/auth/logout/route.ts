import { NextResponse } from "next/server";

import { nexaSessionCookie, revokeUserSession } from "@/lib/auth-store";
import { getAuthenticatedUser, getSessionTokenFromRequest } from "@/lib/auth-request";
import { appendAuditEvent } from "@/lib/people-data";

export async function POST(request: Request) {
  const user = getAuthenticatedUser(request);
  revokeUserSession(getSessionTokenFromRequest(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(nexaSessionCookie, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax" });
  if (user) {
    appendAuditEvent({
      actor: user.name,
      action: "signed out",
      recordType: "employee",
      recordId: user.employeeId || user.id,
      summary: `${user.name} signed out of NeXa.`,
      source: "authentication",
      importance: "normal",
    });
  }
  return response;
}

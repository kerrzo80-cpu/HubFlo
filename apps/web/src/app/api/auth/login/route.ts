import { NextResponse } from "next/server";

import {
  authenticateUser,
  clearFailedLoginAttempts,
  createUserSession,
  getLoginAttemptStatus,
  isUserAuthenticationEnabled,
  nexaSessionCookie,
  nexaSessionMaxAgeSeconds,
  recordFailedLoginAttempt,
} from "@/lib/auth-store";
import { appendAuditEvent } from "@/lib/people-data";

export async function POST(request: Request) {
  if (!isUserAuthenticationEnabled()) {
    return NextResponse.json({ error: "Individual user authentication is not enabled." }, { status: 409 });
  }

  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const loginIdentifier = `${username.trim().toLowerCase()}|${forwardedFor || "unknown"}`;
  const attemptStatus = getLoginAttemptStatus(loginIdentifier);
  if (!attemptStatus.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait 15 minutes and try again." },
      { status: 429, headers: { "Retry-After": String(attemptStatus.retryAfterSeconds) } },
    );
  }
  const user = authenticateUser(username, password);
  if (!user) {
    const failureStatus = recordFailedLoginAttempt(loginIdentifier);
    appendAuditEvent({
      actor: username.trim() || "Unknown user",
      action: "failed sign in",
      recordType: "employee",
      recordId: "authentication",
      summary: "A NeXa sign-in attempt was rejected.",
      source: "authentication",
      importance: "high",
    });
    if (!failureStatus.allowed) {
      return NextResponse.json(
        { error: "Too many sign-in attempts. Please wait 15 minutes and try again." },
        { status: 429, headers: { "Retry-After": String(failureStatus.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: "Username or password is not recognised." }, { status: 401 });
  }

  clearFailedLoginAttempts(loginIdentifier);
  const session = createUserSession(user.id);
  const response = NextResponse.json({ user });
  response.cookies.set(nexaSessionCookie, session.token, {
    httpOnly: true,
    maxAge: nexaSessionMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  });
  appendAuditEvent({
    actor: user.name,
    action: "signed in",
    recordType: "employee",
    recordId: user.employeeId || user.id,
    summary: `${user.name} signed in to NeXa using an individual account.`,
    source: "authentication",
    importance: "normal",
  });
  return response;
}

import { NextResponse } from "next/server";

import { parseRole } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { createAuthUser, listAuthUsers } from "@/lib/auth-store";
import { appendAuditEvent } from "@/lib/people-data";

function owner(request: Request) {
  const user = getAuthenticatedUser(request);
  return user?.role === "Owner/Admin" ? user : null;
}

export async function GET(request: Request) {
  if (!owner(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(listAuthUsers());
}

export async function POST(request: Request) {
  const actor = owner(request);
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const role = parseRole(typeof body?.role === "string" ? body.role : "");
  if (!body || !role) return NextResponse.json({ error: "A valid role is required." }, { status: 422 });

  try {
    const user = createAuthUser({
      employeeId: typeof body.employeeId === "string" ? body.employeeId : undefined,
      name: typeof body.name === "string" ? body.name : "",
      username: typeof body.username === "string" ? body.username : "",
      password: typeof body.password === "string" ? body.password : "",
      role,
      permissions: body.permissions && typeof body.permissions === "object" && !Array.isArray(body.permissions)
        ? body.permissions
        : {},
    });
    appendAuditEvent({
      actor: actor.name,
      action: "created user account",
      recordType: "employee",
      recordId: user.employeeId || user.id,
      summary: `${actor.name} created the ${user.role} NeXa account for ${user.name}.`,
      source: "authentication",
      importance: "high",
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create user." }, { status: 422 });
  }
}

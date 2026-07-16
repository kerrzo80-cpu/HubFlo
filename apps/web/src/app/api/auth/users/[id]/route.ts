import { NextResponse } from "next/server";

import { parseRole } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { updateAuthUser } from "@/lib/auth-store";
import { appendAuditEvent } from "@/lib/people-data";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = getAuthenticatedUser(request);
  if (actor?.role !== "Owner/Admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 422 });
  const role = body.role === undefined ? undefined : parseRole(typeof body.role === "string" ? body.role : "");
  if (body.role !== undefined && !role) return NextResponse.json({ error: "A valid role is required." }, { status: 422 });

  try {
    const updated = updateAuthUser(id, {
      employeeId: typeof body.employeeId === "string" ? body.employeeId : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
      username: typeof body.username === "string" ? body.username : undefined,
      password: typeof body.password === "string" && body.password ? body.password : undefined,
      role: role ?? undefined,
      permissions: body.permissions && typeof body.permissions === "object" && !Array.isArray(body.permissions)
        ? body.permissions
        : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    });
    if (!updated) return NextResponse.json({ error: "User not found." }, { status: 404 });
    const accountAction = body.enabled === false
      ? "disabled user account"
      : typeof body.password === "string" && body.password
        ? "reset user password"
        : "updated user account";
    appendAuditEvent({
      actor: actor.name,
      action: accountAction,
      recordType: "employee",
      recordId: updated.employeeId || updated.id,
      summary: `${actor.name} ${accountAction} for ${updated.name}.`,
      source: "authentication",
      importance: "high",
    });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update user." }, { status: 422 });
  }
}

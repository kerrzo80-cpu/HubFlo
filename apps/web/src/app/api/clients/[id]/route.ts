import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { appendAuditEvent, removeClientRecord, updateClientRecord } from "@/lib/people-data";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 422 });

  const updated = updateClientRecord(id, {
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
  });

  if (!updated) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  appendAuditEvent({
    actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "NeXa user",
    action: updated.archived ? "archived" : "updated",
    recordType: "client",
    recordId: updated.id,
    summary: updated.archived ? `${updated.name} archived.` : `${updated.name} restored.`,
    source: "client directory",
    importance: "normal",
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const deleted = removeClientRecord(id);
  if (!deleted) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  appendAuditEvent({
    actor: request.headers.get("x-hub-actor")?.trim() || "NeXa user",
    action: "deleted",
    recordType: "client",
    recordId: id,
    summary: `Client ${id} deleted.`,
    source: "client directory",
    importance: "high",
  });

  return NextResponse.json({ ok: true });
}

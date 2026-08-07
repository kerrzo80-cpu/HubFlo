import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { appendAuditEvent, removeClientRecord, updateClientRecord } from "@/lib/people-data";
import { getJobs, getQuotes, updateJob, updateQuote } from "@/lib/workflow-data";

function pickString(body: Record<string, unknown> | null, key: string) {
  const value = body?.[key];
  return typeof value === "string" ? value : undefined;
}

function pickOptionalBoolean(body: Record<string, unknown> | null, key: string) {
  const value = body?.[key];
  if (typeof value === "boolean") return value;
  return undefined;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 422 });

  const relatedQuoteIds = new Set(getQuotes().filter((quote) => quote.clientId === id).map((quote) => quote.id));
  const relatedJobIds = new Set(getJobs().filter((job) => job.clientId === id).map((job) => job.id));
  const updated = updateClientRecord(id, {
    name: pickString(body, "name"),
    accountReference: pickString(body, "accountReference"),
    status: pickString(body, "status") as never,
    primaryContact: pickString(body, "primaryContact"),
    email: pickString(body, "email"),
    phone: pickString(body, "phone"),
    billingAddress: pickString(body, "billingAddress"),
    commercialOwner: pickString(body, "commercialOwner"),
    notes: pickString(body, "notes"),
    vatTreatment: pickString(body, "vatTreatment") as never,
    vatRateOverride: pickString(body, "vatRateOverride"),
    cis: pickOptionalBoolean(body, "cis"),
    retentionPercent: pickString(body, "retentionPercent"),
    retentionCapAmount: pickString(body, "retentionCapAmount"),
    mainContractorDiscountPercent: pickString(body, "mainContractorDiscountPercent"),
    xeroContactId: pickString(body, "xeroContactId"),
    lastStatementSentAt: pickString(body, "lastStatementSentAt"),
    lastStatementSentTo: pickString(body, "lastStatementSentTo"),
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
  });

  if (!updated) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const syncedQuotes = Array.from(relatedQuoteIds)
    .map((quoteId) => updateQuote(quoteId, { customer: updated.name, clientId: updated.id }))
    .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote));
  const syncedJobs = Array.from(relatedJobIds)
    .map((jobId) => updateJob(jobId, { customer: updated.name, clientId: updated.id }))
    .filter((job): job is NonNullable<typeof job> => Boolean(job));

  appendAuditEvent({
    actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "NeXa user",
    action: updated.archived ? "archived" : "updated",
    recordType: "client",
    recordId: updated.id,
    summary: updated.archived
      ? `${updated.name} archived.`
      : body.archived === false
        ? `${updated.name} restored.`
        : `${updated.name} updated.`,
    source: "client directory",
    importance: "normal",
  });

  return NextResponse.json({ client: updated, quotes: syncedQuotes, jobs: syncedJobs });
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

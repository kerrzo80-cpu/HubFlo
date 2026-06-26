import { NextResponse } from "next/server";

import { appendAuditEvent } from "@/lib/people-data";
import { convertQuoteToJob, getQuotes, updateQuote, type QuoteStatus } from "@/lib/workflow-data";

type RouteContext = {
  params: Promise<{ token: string }>;
};

function findQuoteByToken(token: string) {
  return getQuotes().find((quote) => quote.portalToken === token) ?? null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const quote = findQuoteByToken(token);

  if (!quote) {
    return NextResponse.json({ error: "Quote link not found" }, { status: 404 });
  }

  const viewedAt = quote.viewedAt ?? new Date().toISOString();
  const updated = quote.viewedAt ? quote : updateQuote(quote.id, { viewedAt }) ?? quote;

  if (!quote.viewedAt) {
    appendAuditEvent({
      actor: quote.customer,
      action: "viewed",
      recordType: "quote",
      recordId: quote.id,
      summary: `${quote.ref} was opened through the online quote portal.`,
      source: "client portal",
      importance: "normal",
    });
  }

  return NextResponse.json({
    id: updated.id,
    ref: updated.ref,
    customer: updated.customer,
    description: updated.description,
    status: updated.status,
    value: updated.value,
    viewedAt: updated.viewedAt,
    respondedAt: updated.respondedAt,
    job: updated.convertedJobId
      ? {
          id: updated.convertedJobId,
          ref: updated.convertedJobRef ?? "",
          status: "Pending",
        }
      : null,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const quote = findQuoteByToken(token);

  if (!quote) {
    return NextResponse.json({ error: "Quote link not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as { response?: "Accepted" | "Declined" } | null;
  if (!payload?.response) {
    return NextResponse.json({ error: "Choose Accepted or Declined" }, { status: 400 });
  }

  if (quote.convertedJobId) {
    return NextResponse.json({
      quote,
      job: {
        id: quote.convertedJobId,
        ref: quote.convertedJobRef,
        status: "Pending",
      },
      auditEvents: [],
    });
  }

  const status = payload.response as QuoteStatus;
  const respondedAt = new Date().toISOString();
  const updated = updateQuote(quote.id, {
    status,
    respondedAt,
    next: status === "Accepted" ? "Accepted online. Convert to pending job." : "Declined online. Follow up with client.",
  });

  if (!updated) {
    return NextResponse.json({ error: "Unable to update quote" }, { status: 500 });
  }

  appendAuditEvent({
    actor: quote.customer,
    action: status === "Accepted" ? "accepted" : "declined",
    recordType: "quote",
    recordId: quote.id,
    summary: `${quote.ref} was ${status.toLowerCase()} through the online quote portal.`,
    source: "client portal",
    importance: "high",
  });

  const conversion = status === "Accepted" ? convertQuoteToJob(quote.id, quote.customer, updated.value) : null;

  return NextResponse.json({
    quote: conversion?.quote ?? updated,
    job: conversion?.job ?? null,
    auditEvents: conversion?.auditEvents ?? [],
  });
}

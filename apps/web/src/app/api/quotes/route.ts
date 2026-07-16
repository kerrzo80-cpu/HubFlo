import { NextResponse } from "next/server";

import { createQuote, getQuotes, type Quote } from "@/lib/workflow-data";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes) {
    return NextResponse.json([]);
  }
  return NextResponse.json(getQuotes());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<Partial<Quote>>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.ref || !payload.customer || !payload.description || !payload.status) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const existing = getQuotes();
  if (payload.sourceLeadId) {
    const linkedById = existing.find((quote) => quote.sourceLeadId === payload.sourceLeadId);
    if (linkedById) {
      return NextResponse.json(
        {
          error: "Lead already has a linked quote",
          linkedQuoteId: linkedById.id,
          linkedQuoteRef: linkedById.ref,
        },
        { status: 409 },
      );
    }
  }
  if (payload.sourceLeadRef) {
    const linkedByRef = existing.find((quote) => quote.sourceLeadRef === payload.sourceLeadRef);
    if (linkedByRef) {
      return NextResponse.json(
        {
          error: "Lead already has a linked quote",
          linkedQuoteId: linkedByRef.id,
          linkedQuoteRef: linkedByRef.ref,
        },
        { status: 409 },
      );
    }
  }

  const created = createQuote(payload as Omit<Quote, "id">);
  appendAuditEvent({
    actor: created.owner || "HubFlo user",
    action: "created",
    recordType: "quote",
    recordId: created.id,
    summary: `${created.ref} created for ${created.customer}${created.sourceLeadRef ? ` from ${created.sourceLeadRef}` : ""}.`,
    source: "quote workflow",
    importance: "normal",
  });
  return NextResponse.json(created, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { parseJsonRequestBody } from "@/lib/http";
import { recordLockErrorResponse } from "@/lib/record-lock-http";
import { assertRecordLockForWrite } from "@/lib/record-edit-locks";
import { assertQuoteStatusTransition, getQuotes, removeQuote, updateQuote, type Quote } from "@/lib/workflow-data";
import { clearSimproLinksForNexaRecord } from "@/lib/simpro-sync";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<Partial<Quote>>(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = await params;
  const current = getQuotes().find((quote) => quote.id === id);
  if (!current) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (body.status) {
    const transitionError = assertQuoteStatusTransition(current.status, body.status);
    if (transitionError) {
      return NextResponse.json({ error: transitionError, code: "QUOTE_STATUS_TRANSITION" }, { status: 409 });
    }
  }

  const authUser = getAuthenticatedUser(request);
  try {
    if (authUser) {
      assertRecordLockForWrite({ recordType: "quote", recordId: id, userId: authUser.id });
    }
    const updated = updateQuote(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    const locked = recordLockErrorResponse(error);
    if (locked) return locked;
    throw error;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const removed = removeQuote(id);
  if (!removed) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  clearSimproLinksForNexaRecord("quotes", id);

  return NextResponse.json({ success: true });
}

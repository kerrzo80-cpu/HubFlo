import { NextResponse } from "next/server";

import { appendAuditEvent } from "@/lib/people-data";
import {
  getVariationPortalRequestByToken,
  markVariationPortalRequestViewed,
  setVariationPortalResponse,
} from "@/lib/variation-portal-data";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type VariationPortalPayload = {
  response?: "Approved" | "Declined";
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const request = getVariationPortalRequestByToken(token);
  if (!request) {
    return NextResponse.json({ error: "Variation link not found" }, { status: 404 });
  }

  if (request.status === "Pending") {
    markVariationPortalRequestViewed(token);
  }

  return NextResponse.json({
    ...request,
    status: request.status,
    variationEventId: request.variationEventId,
    variationRef: `V-${request.variationEventId.slice(-3).toUpperCase()}`,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const existing = getVariationPortalRequestByToken(token);
  if (!existing) {
    return NextResponse.json({ error: "Variation link not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as VariationPortalPayload | null;
  if (!payload?.response) {
    return NextResponse.json({ error: "Choose Approved or Declined" }, { status: 400 });
  }

  const status = payload.response === "Approved" ? "Approved" : "Declined";
  const updated = setVariationPortalResponse(token, status);
  if (!updated) {
    return NextResponse.json({ error: "Unable to update variation response." }, { status: 500 });
  }

  appendAuditEvent({
    actor: "Client",
    action: payload.response === "Approved" ? "approved" : "declined",
    recordType: "job",
    recordId: updated.jobId,
    summary: `${updated.jobRef} variation "${updated.summary}" was ${payload.response.toLowerCase()} on the client portal.`,
    source: "client portal",
    importance: "high",
  });

  return NextResponse.json({
    ...updated,
    status: updated.status,
    variationEventId: updated.variationEventId,
    variationRef: `V-${updated.variationEventId.slice(-3).toUpperCase()}`,
  });
}

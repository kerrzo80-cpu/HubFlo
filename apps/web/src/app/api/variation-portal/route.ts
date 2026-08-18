import { NextRequest, NextResponse } from "next/server";

import { sendEmailMessage } from "@/lib/email-integration-store";
import { parseJsonRequestBody } from "@/lib/http";
import {
  getVariationPortalRequestsByJob,
  upsertVariationPortalRequest,
  type VariationPortalStatus,
} from "@/lib/variation-portal-data";

function variationPortalPublicUrl(token: string) {
  const base = (process.env.NEXA_PUBLIC_APP_URL || "https://nexa-live.onrender.com").replace(/\/$/, "");
  return `${base}/client/variations/${token}`;
}

type CreateVariationPortalPayload = {
  variationEventId: string;
  jobId: string;
  jobRef: string;
  summary: string;
  description: string;
  costValue: number;
  sellValue: number;
  actor: string;
  clientEmail?: string;
  requiresClientApproval?: boolean;
};

type VariationPortalListResponse = Array<{
  variationEventId: string;
  token: string;
  jobId: string;
  jobRef: string;
  summary: string;
  description: string;
  status: VariationPortalStatus;
  costValue: number;
  sellValue: number;
  updatedAt: string;
}>;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query param required" }, { status: 400 });
  }

  const requests = getVariationPortalRequestsByJob(jobId).map((requestEntry) => ({
    variationEventId: requestEntry.variationEventId,
    token: requestEntry.token,
    jobId: requestEntry.jobId,
    jobRef: requestEntry.jobRef,
    summary: requestEntry.summary,
    description: requestEntry.description,
    status: requestEntry.status,
    costValue: requestEntry.costValue,
    sellValue: requestEntry.sellValue,
    updatedAt: requestEntry.updatedAt,
  }));

  return NextResponse.json(requests as VariationPortalListResponse);
}

export async function POST(request: NextRequest) {
  const payload = await parseJsonRequestBody<CreateVariationPortalPayload>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.variationEventId || !payload.jobId || !payload.jobRef || !payload.summary || !payload.actor) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const sellValue = Number.isFinite(payload.sellValue) ? payload.sellValue : 0;
  const { assertVariationSellValue } = await import("@/lib/commercial-safeguards");
  const sellGate = assertVariationSellValue(sellValue);
  if (sellGate) {
    return NextResponse.json({ error: sellGate }, { status: 422 });
  }

  const created = upsertVariationPortalRequest({
    variationEventId: payload.variationEventId,
    jobId: payload.jobId,
    jobRef: payload.jobRef,
    summary: payload.summary,
    description: payload.description || payload.summary,
    costValue: Number.isFinite(payload.costValue) ? payload.costValue : 0,
    sellValue,
    actor: payload.actor,
    clientEmail: payload.clientEmail?.trim(),
    requiresClientApproval: payload.requiresClientApproval ?? true,
  });

  const clientEmail = payload.clientEmail?.trim();
  let emailSent = false;
  let emailError: string | undefined;
  if (clientEmail && clientEmail.includes("@")) {
    const portalUrl = variationPortalPublicUrl(created.token);
    const sell = Number.isFinite(payload.sellValue) ? payload.sellValue : 0;
    try {
      await sendEmailMessage({
        to: clientEmail,
        subject: `${payload.jobRef} — please approve variation: ${payload.summary}`,
        text: [
          `Please review and approve an additional variation for ${payload.jobRef}.`,
          "",
          `Variation: ${payload.summary}`,
          `Amount (ex VAT): £${sell.toFixed(2)}`,
          "",
          `Approve or decline here: ${portalUrl}`,
          "",
          "If the link does not open, reply to this email and the office will help.",
        ].join("\n"),
      });
      emailSent = true;
    } catch (error) {
      emailError = error instanceof Error ? error.message : "Email send failed";
    }
  }

  return NextResponse.json({ ...created, emailSent, emailError }, { status: 201 });
}

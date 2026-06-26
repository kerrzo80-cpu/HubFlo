import { NextRequest, NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";
import {
  getVariationPortalRequestsByJob,
  upsertVariationPortalRequest,
  type VariationPortalStatus,
} from "@/lib/variation-portal-data";

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

  const created = upsertVariationPortalRequest({
    variationEventId: payload.variationEventId,
    jobId: payload.jobId,
    jobRef: payload.jobRef,
    summary: payload.summary,
    description: payload.description || payload.summary,
    costValue: Number.isFinite(payload.costValue) ? payload.costValue : 0,
    sellValue: Number.isFinite(payload.sellValue) ? payload.sellValue : 0,
    actor: payload.actor,
    clientEmail: payload.clientEmail?.trim(),
    requiresClientApproval: payload.requiresClientApproval ?? true,
  });

  return NextResponse.json(created, { status: 201 });
}

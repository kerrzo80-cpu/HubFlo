import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { ensureGasCertTrialInCore } from "@/lib/gas-cert-trial-core";
import { reconcileDayworkVariationsFromEvidence } from "@/lib/engineer-flow";
import { getHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { mergeHubDetailState } from "@/lib/hub-state-merge";
import { parseJsonRequestBody } from "@/lib/http";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showQuotes && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  ensureGasCertTrialInCore();
  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort backfill of Daywork variation cards from Field evidence.
  }
  return NextResponse.json(getHubDetailState());
}

export async function PUT(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canCreateQuote && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<HubDetailState>(request);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = getHubDetailState();
  const merged = mergeHubDetailState(current, payload);
  saveHubDetailState(merged);
  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort: rebuild Daywork variation cards if Core omitted them.
  }
  return NextResponse.json(getHubDetailState());
}

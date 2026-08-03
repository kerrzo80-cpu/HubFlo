import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  buildDayworkAccountRecordFromEvidence,
  ensureDayworkVariationCostCentre,
  listDayworkSheetsForJob,
  reconcileDayworkVariationsFromEvidence,
} from "@/lib/engineer-flow";
import { getHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { type DayworkSheetSnapshot } from "@/lib/daywork-account-form";
import { findDayworkSheetForJob } from "@/lib/daywork-sheets-store";
import { getJobs } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Fetch the latest Daywork Account sheet for a job (forces reconcile from Field snapshot). */
export async function GET(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  const job = getJobs().find((item) => item.id === jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  try {
    reconcileDayworkVariationsFromEvidence();
  } catch {
    // Best-effort.
  }

  const url = new URL(request.url);
  const costCentreId =
    url.searchParams.get("costCentreId")?.trim() || ensureDayworkVariationCostCentre(jobId);
  const hubState = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
    flowStepEvidence?: Record<string, unknown>;
    jobDeliveryEvents?: unknown[];
  };
  const sheet =
    findDayworkSheetForJob(hubState.dayworkSheets, jobId, costCentreId) ||
    listDayworkSheetsForJob(jobId).find((item) => item.costCentreId === costCentreId) ||
    listDayworkSheetsForJob(jobId)[0] ||
    null;
  const record =
    sheet ||
    buildDayworkAccountRecordFromEvidence(jobId, sheet?.costCentreId || costCentreId);

  return NextResponse.json({
    ok: true,
    jobId,
    jobRef: job.ref,
    costCentreId,
    record,
    sheet,
    dayworkSheets: hubState.dayworkSheets ?? {},
    flowStepEvidence: hubState.flowStepEvidence ?? {},
    jobDeliveryEvents: hubState.jobDeliveryEvents ?? [],
  });
}

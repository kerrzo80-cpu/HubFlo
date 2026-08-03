import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { buildDayworkAccountRecordFromEvidence, saveDayworkOfficePricing } from "@/lib/engineer-flow";
import { getHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { dayworkSheetKey, type DayworkSheetSnapshot } from "@/lib/daywork-account-form";
import { parseJsonRequestBody } from "@/lib/http";
import { getJobs } from "@/lib/workflow-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

type Body = {
  costCentreId?: string;
  labourRate?: string;
  materialsCost?: string;
  plantCost?: string;
  markupPercent?: string;
};

/** Office pricing for a Daywork Account sheet on a job. */
export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await params;
  const body = (await parseJsonRequestBody<Body>(request)) || {};
  const costCentreId = body.costCentreId?.trim() || `${jobId}-daywork-account`;
  const job = getJobs().find((item) => item.id === jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const event = saveDayworkOfficePricing({
    jobId,
    jobRef: job.ref,
    costCentreId,
    labourRate: body.labourRate,
    materialsCost: body.materialsCost,
    plantCost: body.plantCost,
    markupPercent: body.markupPercent,
  });

  const hubState = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  const sheet = hubState.dayworkSheets?.[dayworkSheetKey(jobId, costCentreId)];
  const record = sheet || buildDayworkAccountRecordFromEvidence(jobId, costCentreId);

  return NextResponse.json({ ok: true, event, record });
}

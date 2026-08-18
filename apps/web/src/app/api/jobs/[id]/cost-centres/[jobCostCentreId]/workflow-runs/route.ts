import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { actorFromHeaders } from "@/lib/domestic-stop-go/http";
import { startWorkflowRun } from "@/lib/domestic-stop-go/service";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { ensureDomesticStopGoSeed } from "@/lib/domestic-stop-go/seed";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; jobCostCentreId: string }> };

export async function POST(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs && !access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ensureDomesticStopGoSeed();
  const { id: jobId, jobCostCentreId } = await params;
  const body = (await parseJsonRequestBody<{ costCentreName?: string; scheduleId?: string }>(request)) || {};
  const actor = actorFromHeaders(request.headers);
  const hub = getHubDetailState();
  const centres = (((hub.jobCostCentres ?? {}) as Record<string, Array<{ id?: string; name?: string; templateName?: string }>>)[jobId] || []);
  const centre = centres.find((item) => item.id === jobCostCentreId);
  try {
    const dto = startWorkflowRun({
      jobId,
      jobCostCentreId,
      costCentreCodeOrName: body.costCentreName || centre?.templateName || centre?.name || "",
      actorId: actor.actorId,
      scheduleId: body.scheduleId,
    });
    return NextResponse.json(dto);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start workflow." }, { status: 400 });
  }
}

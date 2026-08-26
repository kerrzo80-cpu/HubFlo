import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { officeBoard, listRunsForJob } from "@/lib/domestic-stop-go/service";
import { ensureDomesticStopGoSeed, publishedTemplatesHealth } from "@/lib/domestic-stop-go/seed";
import { getDomesticStopGoStore } from "@/lib/domestic-stop-go/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ensureDomesticStopGoSeed();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (jobId) {
    return NextResponse.json({ runs: listRunsForJob(jobId) });
  }
  return NextResponse.json({
    ...officeBoard(),
    costCentres: getDomesticStopGoStore().costCentres,
    templates: publishedTemplatesHealth(),
    settings: getDomesticStopGoStore().settings,
  });
}

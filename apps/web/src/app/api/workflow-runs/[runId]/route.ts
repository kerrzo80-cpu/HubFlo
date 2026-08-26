import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getRunDto, officeBoard, listRunsForJob } from "@/lib/domestic-stop-go/service";
import { ensureDomesticStopGoSeed } from "@/lib/domestic-stop-go/seed";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function GET(request: Request, { params }: Params) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ensureDomesticStopGoSeed();
  const { runId } = await params;
  if (runId === "office") {
    return NextResponse.json(officeBoard());
  }
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (runId === "by-job" && jobId) {
    return NextResponse.json({ runs: listRunsForJob(jobId) });
  }
  try {
    return NextResponse.json(getRunDto(runId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Not found." }, { status: 404 });
  }
}

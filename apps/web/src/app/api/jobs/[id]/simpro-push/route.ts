import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { pushJobToSimpro } from "@/lib/simpro-bridge";

type SimproJobPushRequest = {
  actor?: string;
  costCentres?: unknown;
  schedule?: unknown;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<SimproJobPushRequest>(request);
  const { id } = await params;
  const result = await pushJobToSimpro(id, {
    actor: body?.actor,
    costCentres: body?.costCentres,
    schedule: body?.schedule,
  });

  if (!result) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const status = result.exportRecord.status === "Failed" ? 502 : 200;
  return NextResponse.json(result, { status });
}

import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  pushJobSchedulesToSimpro,
  type SchedulePushAssignment,
} from "@/lib/simpro-schedule-push";

type SchedulePushRequest = {
  assignments?: SchedulePushAssignment[];
  upsertIds?: string[];
  deleteIds?: string[];
  persist?: boolean;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<SchedulePushRequest>(request);
  const { id } = await params;
  const result = await pushJobSchedulesToSimpro({
    jobId: id,
    assignments: body?.assignments,
    upsertIds: body?.upsertIds,
    deleteIds: body?.deleteIds,
    persist: body?.persist,
  });

  if (result.reason === "Job not found") {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const status = result.skipped ? 200 : result.ok ? 200 : 502;
  return NextResponse.json(result, { status });
}

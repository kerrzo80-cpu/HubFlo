import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { controlSimproImportRun, getSimproImportRun } from "@/lib/simpro-import-runs";

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{ runId?: string; action?: "pause" | "resume" | "cancel" }>(request);
  const runId = body?.runId?.trim() || "";
  const action = body?.action;
  if (!runId || !action || !["pause", "resume", "cancel"].includes(action)) {
    return NextResponse.json({ error: "runId and action (pause|resume|cancel) are required" }, { status: 400 });
  }

  if (!getSimproImportRun(runId)) {
    return NextResponse.json({ error: "Import run not found" }, { status: 404 });
  }

  const run = controlSimproImportRun(runId, action);
  return NextResponse.json({ ok: true, run });
}

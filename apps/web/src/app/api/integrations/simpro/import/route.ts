import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getSimproDirectConfigStatus } from "@/lib/simpro-auth";
import { listSimproEntityLinks, simproEntityLinkStats } from "@/lib/simpro-entity-links";
import {
  createSimproImportRun,
  getSimproImportRun,
  getSimproImportStatus,
  type SimproImportMode,
} from "@/lib/simpro-import-runs";

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const runId = request.nextUrl.searchParams.get("runId")?.trim();
  if (runId) {
    const run = getSimproImportRun(runId);
    if (!run) return NextResponse.json({ error: "Import run not found" }, { status: 404 });
    return NextResponse.json({ run, linkStats: simproEntityLinkStats() });
  }

  const config = getSimproDirectConfigStatus();
  return NextResponse.json({
    configured: config.configured,
    companyId: config.companyId,
    linkStats: simproEntityLinkStats(),
    ...getSimproImportStatus(),
  });
}

export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = getSimproDirectConfigStatus();
  if (!config.configured || !config.companyId) {
    return NextResponse.json(
      { error: "Simpro is not configured. Connect and set SIMPRO_COMPANY_ID first." },
      { status: 400 },
    );
  }

  const body = (await parseJsonRequestBody<{
    mode?: SimproImportMode;
    includeJobs?: boolean;
    includeQuotes?: boolean;
    includeArchived?: boolean;
    includeAttachments?: boolean;
    dateFrom?: string;
    dateTo?: string;
  }>(request)) ?? {};

  const mode: SimproImportMode = body.mode === "full" || body.mode === "incremental" ? body.mode : "preview";
  const actor = request.headers.get(employeeHeaderName) || "NeXa admin";

  try {
    const run = createSimproImportRun({
      mode,
      companyId: config.companyId,
      actor,
      options: {
        includeJobs: body.includeJobs,
        includeQuotes: body.includeQuotes,
        includeArchived: body.includeArchived,
        includeAttachments: body.includeAttachments,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        run,
        note:
          mode === "preview"
            ? "Preview run queued. Phase C will populate mapped records; Phase B stores runs and entity links only."
            : "Import run queued. Worker ticks land in Phase D; run/checkpoint store is ready.",
        linkCount: listSimproEntityLinks().length,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start import run.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

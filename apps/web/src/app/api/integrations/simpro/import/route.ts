import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getSimproDirectConfigStatus } from "@/lib/simpro-auth";
import {
  createSimproImportRun,
  getSimproImportRun,
  getSimproImportStatus,
  type SimproImportMode,
} from "@/lib/simpro-import-runs";
import { tickSimproImport } from "@/lib/simpro-import-service";
import { listSimproEntityLinks, simproEntityLinkStats } from "@/lib/simpro-entity-links";

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

    // Kick the first page immediately so import starts without waiting for a worker.
    const firstTick = await tickSimproImport(run.id);

    return NextResponse.json(
      {
        ok: true,
        run: firstTick.run ?? run,
        firstTick,
        note:
          mode === "preview"
            ? "Preview started. Call POST /api/integrations/simpro/import/tick to continue pages."
            : "Import started. Call POST /api/integrations/simpro/import/tick (or cron with NEXA_IMPORT_TICK_SECRET) to continue.",
        linkCount: listSimproEntityLinks().length,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start import run.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { SIMPRO_EOD_ACTOR, SIMPRO_EOD_ENTITIES, parseSimproEodEntities } from "@/lib/simpro-eod-refresh";
import { getSimproSyncStatus, runSimproImport, type SimproSyncEntity } from "@/lib/simpro-sync";

export const runtime = "nodejs";
/** Same budget as manual Apply — quotes/jobs deep hydrate can take a few minutes. */
export const maxDuration = 300;

type CronBody = {
  entities?: string[];
  actor?: string;
};

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

function canRunWithSecret(request: NextRequest) {
  const expected = process.env.NEXA_IMPORT_TICK_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-nexa-import-tick-secret")?.trim();
  return Boolean(provided && provided === expected);
}

/**
 * Unattended end-of-day simPRO pull.
 * Auth: admin session headers OR x-nexa-import-tick-secret (Render cron).
 */
export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request) && !canRunWithSecret(request)) {
    return NextResponse.json(
      {
        error: "Forbidden",
        detail: "Set NEXA_IMPORT_TICK_SECRET on nexa-live and send it as x-nexa-import-tick-secret, or run as an admin.",
      },
      { status: 403 },
    );
  }

  const body = (await parseJsonRequestBody<CronBody>(request)) ?? {};
  const entities: SimproSyncEntity[] = parseSimproEodEntities(body.entities) ?? SIMPRO_EOD_ENTITIES;
  const actor = body.actor?.trim() || SIMPRO_EOD_ACTOR;

  try {
    const run = await runSimproImport({
      mode: "apply",
      entities,
      actor,
    });

    return NextResponse.json({
      ok: true,
      kind: "simpro-eod-refresh",
      scheduleHint: "Render cron weekdays 18:00 UTC (after typical UK close)",
      run,
      status: getSimproSyncStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run end-of-day simPRO refresh.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        status: getSimproSyncStatus(),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request) && !canRunWithSecret(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getSimproSyncStatus();
  const lastRun = status.lastRun;
  const lastWasEod = Boolean(lastRun?.actor?.includes("EOD"));

  return NextResponse.json({
    ok: true,
    kind: "simpro-eod-refresh",
    secretConfigured: Boolean(process.env.NEXA_IMPORT_TICK_SECRET?.trim()),
    defaultEntities: SIMPRO_EOD_ENTITIES,
    lastRun,
    lastWasEod,
    scheduleHint: "Render cron weekdays 18:00 UTC → POST /api/integrations/simpro/sync/cron",
  });
}

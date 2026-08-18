import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { runOfficeBackup } from "@/lib/office-backup";

export const runtime = "nodejs";
export const maxDuration = 300;

function canRunWithSecret(request: NextRequest) {
  const expected =
    process.env.NEXA_BACKUP_CRON_SECRET?.trim() || process.env.NEXA_IMPORT_TICK_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-nexa-backup-secret")?.trim()
    || request.headers.get("x-nexa-import-tick-secret")?.trim();
  return Boolean(provided && provided === expected);
}

function canManage(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.canCustomize || access.showFinance;
}

/**
 * Nightly office backup. Auth: admin session or x-nexa-backup-secret
 * (NEXA_BACKUP_CRON_SECRET or NEXA_IMPORT_TICK_SECRET).
 */
export async function POST(request: NextRequest) {
  if (!canManage(request) && !canRunWithSecret(request)) {
    return NextResponse.json(
      {
        error: "Forbidden",
        detail: "Set NEXA_BACKUP_CRON_SECRET on the web service and this cron (same value), send x-nexa-backup-secret, or run Backup now from Setup.",
      },
      { status: 403 },
    );
  }

  const result = await runOfficeBackup();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    kind: "office-backup",
    scheduleHint: "Render cron 02:15 UTC daily → POST /api/office-backup/cron",
    result,
  });
}

import { NextRequest, NextResponse } from "next/server";

import { runOfficeBackup } from "@/lib/office-backup";

export const runtime = "nodejs";
export const maxDuration = 300;

function expectedBackupCronSecret() {
  return process.env.NEXA_BACKUP_CRON_SECRET?.trim() || process.env.NEXA_IMPORT_TICK_SECRET?.trim() || "";
}

function providedBackupCronSecret(request: NextRequest) {
  return (
    request.headers.get("x-nexa-backup-secret")?.trim()
    || request.headers.get("x-nexa-import-tick-secret")?.trim()
    || ""
  );
}

/**
 * Nightly office backup for Render cron only.
 * Auth: x-nexa-backup-secret must match NEXA_BACKUP_CRON_SECRET
 * (or NEXA_IMPORT_TICK_SECRET fallback) on this web service.
 * Interactive "Backup now" uses POST /api/office-backup (session auth).
 */
export async function POST(request: NextRequest) {
  const expected = expectedBackupCronSecret();
  if (!expected) {
    return NextResponse.json(
      {
        error: "Backup cron secret not configured",
        detail:
          "Set NEXA_BACKUP_CRON_SECRET on this web service (nexa-live or nexa-pilot), use the same value on the nightly-backup cron, then redeploy/restart the web service.",
      },
      { status: 503 },
    );
  }

  const provided = providedBackupCronSecret(request);
  if (!provided || provided !== expected) {
    return NextResponse.json(
      {
        error: "Forbidden",
        detail:
          "x-nexa-backup-secret does not match NEXA_BACKUP_CRON_SECRET on this web service. Copy the exact same value onto both the web service and the nightly-backup cron, then restart both.",
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

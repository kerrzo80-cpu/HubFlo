import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getXeroPaymentSyncStatus, runXeroPaymentSync } from "@/lib/xero-payment-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

type CronBody = {
  actor?: string;
  maxInvoices?: number;
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

/** Unattended Xero payment pull — marks NeXa invoices paid when Xero payments exist. */
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
  const actor = body.actor?.trim() || "Nightly Xero payment cron";

  try {
    const run = await runXeroPaymentSync({
      actor,
      maxInvoices: body.maxInvoices,
    });
    return NextResponse.json({
      ok: true,
      kind: "xero-payment-sync",
      scheduleHint: getXeroPaymentSyncStatus().scheduleHint,
      run,
      status: getXeroPaymentSyncStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run Xero payment sync.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        status: getXeroPaymentSyncStatus(),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request) && !canRunWithSecret(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    kind: "xero-payment-sync",
    ...getXeroPaymentSyncStatus(),
  });
}

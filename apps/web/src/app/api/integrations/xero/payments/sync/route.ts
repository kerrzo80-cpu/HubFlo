import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { getXeroPaymentSyncStatus, runXeroPaymentSync } from "@/lib/xero-payment-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

type SyncBody = {
  maxInvoices?: number;
};

/** Manual batch pull — same engine as the nightly cron, for office users. */
export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await parseJsonRequestBody<SyncBody>(request)) ?? {};
  const actor = request.headers.get(employeeHeaderName) || "NeXa user";

  try {
    const run = await runXeroPaymentSync({
      actor,
      maxInvoices: body.maxInvoices,
    });
    return NextResponse.json({
      ok: true,
      run,
      status: getXeroPaymentSyncStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync Xero payments.";
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
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    ...getXeroPaymentSyncStatus(),
  });
}

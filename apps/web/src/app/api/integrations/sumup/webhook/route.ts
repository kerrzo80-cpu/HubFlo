import { NextResponse } from "next/server";

import { lookupSumUpCheckout } from "@/lib/sumup-checkout-store";
import { syncSumUpCheckoutToLedger } from "@/lib/sumup-payments";

export const runtime = "nodejs";

/**
 * SumUp checkout webhooks are unsigned pointers:
 * { "event_type": "CHECKOUT_STATUS_CHANGED", "id": "<checkout_id>" }
 * Always re-fetch the checkout from SumUp before trusting status.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { event_type?: string; id?: string } | null;
  const checkoutId = body?.id?.trim();
  if (!checkoutId) {
    return NextResponse.json({ ok: true, skipped: "no checkout id" });
  }

  try {
    const pending = lookupSumUpCheckout(checkoutId);
    const result = await syncSumUpCheckoutToLedger(checkoutId, pending?.invoiceId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    // Still ack 2xx so SumUp does not hammer retries for config gaps.
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Webhook sync failed",
    });
  }
}

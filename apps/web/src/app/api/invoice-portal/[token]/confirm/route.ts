import { NextResponse } from "next/server";

import { getHubDetailState } from "@/lib/hub-detail-store";
import { findInvoiceByPortalToken } from "@/lib/invoice-portal";
import {
  latestCheckoutForInvoice,
  lookupSumUpCheckout,
  lookupSumUpCheckoutByReference,
} from "@/lib/sumup-checkout-store";
import { syncSumUpCheckoutToLedger } from "@/lib/sumup-payments";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type PortalInvoice = {
  id: string;
  ref: string;
  portalToken?: string;
  chargeTotal: number;
  vatRate?: number;
  paidAmount?: number;
  paymentStatus?: string;
  status?: string;
  customer: string;
  title?: string;
};

function findInvoiceByToken(token: string) {
  const raw = getHubDetailState().invoices;
  if (!Array.isArray(raw)) return null;
  return findInvoiceByPortalToken(raw as PortalInvoice[], token);
}

/** After SumUp redirect, confirm PAID status and post to NeXa ledger (+ Xero push). */
export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const invoice = findInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice link not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    checkoutId?: string;
    checkoutRef?: string;
    checkoutReference?: string;
  } | null;
  const checkoutRef = body?.checkoutRef?.trim() || body?.checkoutReference?.trim() || "";
  const checkoutId =
    body?.checkoutId?.trim() ||
    (checkoutRef ? lookupSumUpCheckoutByReference(checkoutRef)?.checkoutId : "") ||
    lookupSumUpCheckout(body?.checkoutId || "")?.checkoutId ||
    latestCheckoutForInvoice(invoice.id)?.checkoutId;

  if (!checkoutId) {
    return NextResponse.json({ error: "No SumUp checkout to confirm yet." }, { status: 400 });
  }

  try {
    const result = await syncSumUpCheckoutToLedger(checkoutId, invoice.id);
    if (!result.ok && "reason" in result && result.reason === "not_paid") {
      return NextResponse.json({
        ok: false,
        status: result.status,
        message: "Payment is not confirmed yet. If you paid, wait a moment and refresh.",
      });
    }
    return NextResponse.json({ ok: result.ok, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to confirm SumUp payment." },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { rememberSumUpCheckout } from "@/lib/sumup-checkout-store";
import { isSumUpConfigured } from "@/lib/sumup-key-store";
import { createSumUpHostedCheckout, invoiceOwed } from "@/lib/sumup-payments";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

type PortalInvoice = {
  id: string;
  ref: string;
  customer: string;
  title: string;
  chargeTotal: number;
  vatRate?: number;
  paidAmount?: number;
  paymentStatus?: string;
  portalToken?: string;
  status?: string;
};

function listInvoices(): PortalInvoice[] {
  const raw = getHubDetailState().invoices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PortalInvoice => Boolean(item && typeof item === "object"));
}

function findInvoiceByToken(token: string) {
  const cleaned = token.trim().toLowerCase();
  return (
    listInvoices().find((invoice) => {
      const portal = String(invoice.portalToken || "").toLowerCase();
      const ref = String(invoice.ref || "").toLowerCase();
      return portal === cleaned || ref === cleaned;
    }) ?? null
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSumUpConfigured()) {
    return NextResponse.json(
      { error: "Online card pay is not configured yet. Use bank transfer or ask the office." },
      { status: 503 },
    );
  }

  const { token } = await context.params;
  const invoice = findInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice link not found" }, { status: 404 });
  }

  const owed = invoiceOwed(invoice);
  if (owed <= 0 || invoice.paymentStatus === "Paid") {
    return NextResponse.json({ error: "This invoice is already paid." }, { status: 400 });
  }

  let portalToken = invoice.portalToken;
  if (!portalToken) {
    portalToken = `${invoice.ref.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${invoice.id.slice(0, 8)}`;
    const hub = getHubDetailState();
    const next = listInvoices().map((row) => (row.id === invoice.id ? { ...row, portalToken } : row));
    saveHubDetailState({ ...hub, invoices: next });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;

  try {
    const session = await createSumUpHostedCheckout({
      invoice,
      portalToken,
      amount: owed,
      origin,
    });

    rememberSumUpCheckout({
      checkoutId: session.checkoutId,
      checkoutReference: session.checkoutReference,
      invoiceId: invoice.id,
      portalToken,
      amount: owed,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({
      url: session.url,
      checkoutId: session.checkoutId,
      checkoutReference: session.checkoutReference,
      provider: "sumup",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start SumUp checkout." },
      { status: 502 },
    );
  }
}

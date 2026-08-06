import { NextResponse } from "next/server";

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { isStripeConfigured } from "@/lib/stripe-key-store";
import { getStripeClient, invoiceOwed } from "@/lib/stripe-payments";

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
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Online card pay is not configured yet. Use bank transfer or ask the office." },
      { status: 503 },
    );
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not available." }, { status: 503 });
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

  // Ensure portal token exists for return URLs / webhook matching.
  let portalToken = invoice.portalToken;
  if (!portalToken) {
    portalToken = `${invoice.ref.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${invoice.id.slice(0, 8)}`;
    const hub = getHubDetailState();
    const next = listInvoices().map((row) => (row.id === invoice.id ? { ...row, portalToken } : row));
    saveHubDetailState({ ...hub, invoices: next });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const amountPence = Math.round(owed * 100);
  if (amountPence < 30) {
    return NextResponse.json({ error: "Amount is too small for card payment." }, { status: 400 });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${origin}/client/invoices/${portalToken}?paid=1`,
      cancel_url: `${origin}/client/invoices/${portalToken}?cancelled=1`,
      customer_email: undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: amountPence,
            product_data: {
              name: `${invoice.ref} — ${invoice.title || "Invoice"}`,
              description: `Payment to ${invoice.customer}`,
            },
          },
        },
      ],
      metadata: {
        invoiceId: invoice.id,
        invoiceRef: invoice.ref,
        portalToken,
      },
      payment_intent_data: {
        metadata: {
          invoiceId: invoice.id,
          invoiceRef: invoice.ref,
          portalToken,
        },
      },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start Stripe Checkout." },
      { status: 502 },
    );
  }
}

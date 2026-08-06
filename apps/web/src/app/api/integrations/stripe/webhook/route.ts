import { NextResponse } from "next/server";

import { getStripeWebhookSecret } from "@/lib/stripe-key-store";
import { applyStripePaymentToInvoice, getStripeClient } from "@/lib/stripe-payments";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  let event: Awaited<ReturnType<typeof stripe.webhooks.constructEvent>>;

  try {
    if (webhookSecret) {
      const signature = request.headers.get("stripe-signature");
      if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } else {
      // Dev / pilot without webhook secret — parse JSON only (not for production).
      event = JSON.parse(rawBody) as typeof event;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook" },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      id?: string;
      amount_total?: number | null;
      payment_intent?: string | { id?: string } | null;
      customer_details?: { email?: string | null } | null;
      metadata?: Record<string, string>;
      currency?: string;
    };
    const invoiceId = session.metadata?.invoiceId;
    if (!invoiceId) return NextResponse.json({ ok: true, skipped: "no invoice metadata" });

    const amount = (Number(session.amount_total) || 0) / 100;
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    const result = applyStripePaymentToInvoice({
      invoiceId,
      amount,
      paymentIntentId,
      sessionId: session.id,
      customerEmail: session.customer_details?.email || undefined,
    });

    return NextResponse.json({ ok: result.ok, result });
  }

  return NextResponse.json({ ok: true, ignored: event.type });
}

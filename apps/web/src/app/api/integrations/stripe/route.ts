import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  clearStoredStripeConfig,
  getStripePublishableKey,
  isStripeConfigured,
  saveStoredStripeConfig,
  stripeKeySource,
} from "@/lib/stripe-key-store";

export const runtime = "nodejs";

function statusPayload() {
  return {
    connected: isStripeConfigured(),
    source: stripeKeySource(),
    publishableKey: getStripePublishableKey() ? `${getStripePublishableKey().slice(0, 8)}…` : "",
    hasPublishableKey: Boolean(getStripePublishableKey()),
  };
}

export async function GET() {
  return NextResponse.json(statusPayload());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    secretKey?: string;
    publishableKey?: string;
    webhookSecret?: string;
  } | null;

  if (!body?.secretKey?.trim() && !isStripeConfigured()) {
    return NextResponse.json({ error: "Paste a Stripe secret key (sk_…)." }, { status: 400 });
  }

  saveStoredStripeConfig({
    secretKey: body?.secretKey,
    publishableKey: body?.publishableKey,
    webhookSecret: body?.webhookSecret,
  });

  return NextResponse.json({ ...statusPayload(), ok: true });
}

export async function DELETE(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditInvoice && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  clearStoredStripeConfig();
  return NextResponse.json({ ...statusPayload(), ok: true });
}

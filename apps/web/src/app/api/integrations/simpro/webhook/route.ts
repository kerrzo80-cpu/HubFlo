import { NextRequest, NextResponse } from "next/server";

import { isValidWebhookSecret, queueSimproWebhookEvent } from "@/lib/simpro-sync";

export async function POST(request: NextRequest) {
  if (!isValidWebhookSecret(request.headers)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = queueSimproWebhookEvent(payload, request.headers);
  return NextResponse.json({ ok: true, event }, { status: 202 });
}

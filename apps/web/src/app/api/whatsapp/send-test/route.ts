import { NextResponse } from "next/server";

import { parseJsonRequestBody } from "@/lib/http";

type WhatsAppTestPayload = {
  to: string;
  message: string;
};

export async function POST(request: Request) {
  const payload = await parseJsonRequestBody<Partial<WhatsAppTestPayload>>(request);

  if (!payload?.to || !payload.message) {
    return NextResponse.json({ error: "WhatsApp number and message are required." }, { status: 400 });
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const missing = [
    !accessToken ? "WHATSAPP_ACCESS_TOKEN" : null,
    !phoneNumberId ? "WHATSAPP_PHONE_NUMBER_ID" : null,
  ].filter(Boolean);

  if (missing.length) {
    return NextResponse.json(
      {
        status: "not_configured",
        missing,
        preview: {
          to: payload.to,
          message: payload.message,
        },
      },
      { status: 200 },
    );
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: payload.to.replace(/[^\d]/g, ""),
      type: "text",
      text: {
        preview_url: false,
        body: payload.message,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    return NextResponse.json(
      {
        status: "failed",
        providerStatus: response.status,
        providerResponse: body,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    status: "sent",
    providerResponse: body,
  });
}

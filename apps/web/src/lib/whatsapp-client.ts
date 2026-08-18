export type WhatsAppSendInput = {
  to: string;
  message: string;
  actorEmployeeId?: string;
  actorName?: string;
  jobId?: string;
  jobRef?: string;
};

export type WhatsAppSendResult =
  | {
      status: "sent";
      to: string;
      message: string;
      actorEmployeeId?: string;
      actorName?: string;
      jobId?: string;
      jobRef?: string;
      providerMessageId?: string;
      providerResponse: unknown;
    }
  | {
      status: "not_configured";
      missing: string[];
      preview: { to: string; message: string };
      actorEmployeeId?: string;
      actorName?: string;
      jobId?: string;
      jobRef?: string;
    }
  | {
      status: "failed";
      providerStatus: number;
      providerResponse: unknown;
      actorEmployeeId?: string;
      actorName?: string;
      jobId?: string;
      jobRef?: string;
    };

function digitsOnly(value: string) {
  return value.replace(/[^\d]/g, "");
}

export function getWhatsAppConfigStatus() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "";
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() || "";
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim() || "";
  const missing = [
    !accessToken ? "WHATSAPP_ACCESS_TOKEN" : null,
    !phoneNumberId ? "WHATSAPP_PHONE_NUMBER_ID" : null,
  ].filter(Boolean) as string[];

  return {
    configured: missing.length === 0,
    missing,
    phoneNumberIdPresent: Boolean(phoneNumberId),
    verifyTokenPresent: Boolean(verifyToken),
    webhookSecretPresent: Boolean(webhookSecret),
    displayFrom: "NeXa WhatsApp",
  };
}

export async function sendWhatsAppMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
  const to = digitsOnly(input.to);
  const message = input.message.trim();
  if (!to || !message) {
    throw new Error("WhatsApp number and message are required.");
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const missing = [
    !accessToken ? "WHATSAPP_ACCESS_TOKEN" : null,
    !phoneNumberId ? "WHATSAPP_PHONE_NUMBER_ID" : null,
  ].filter(Boolean) as string[];

  if (missing.length) {
    return {
      status: "not_configured",
      missing,
      preview: { to, message },
      actorEmployeeId: input.actorEmployeeId,
      actorName: input.actorName,
      jobId: input.jobId,
      jobRef: input.jobRef,
    };
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
      to,
      type: "text",
      text: {
        preview_url: false,
        body: message,
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: "failed",
      providerStatus: response.status,
      providerResponse: body,
      actorEmployeeId: input.actorEmployeeId,
      actorName: input.actorName,
      jobId: input.jobId,
      jobRef: input.jobRef,
    };
  }

  const providerMessageId =
    typeof body === "object"
    && body
    && "messages" in body
    && Array.isArray((body as { messages?: Array<{ id?: string }> }).messages)
      ? (body as { messages: Array<{ id?: string }> }).messages[0]?.id
      : undefined;

  return {
    status: "sent",
    to,
    message,
    actorEmployeeId: input.actorEmployeeId,
    actorName: input.actorName,
    jobId: input.jobId,
    jobRef: input.jobRef,
    providerMessageId,
    providerResponse: body,
  };
}

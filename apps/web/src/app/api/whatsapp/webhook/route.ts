import { NextResponse } from "next/server";

import { appendJobCommunication, matchInboundToJob } from "@/lib/job-comms-match";
import { getWhatsAppConfigStatus } from "@/lib/whatsapp-client";

function extractTextBody(message: Record<string, unknown>) {
  if (message.type === "text" && message.text && typeof message.text === "object") {
    const text = (message.text as { body?: unknown }).body;
    return typeof text === "string" ? text : "";
  }
  if (typeof message.body === "string") return message.body;
  return "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "WhatsApp webhook verification failed.",
      status: getWhatsAppConfigStatus(),
    },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET?.trim();
  if (webhookSecret) {
    const provided = request.headers.get("x-hub-signature-256") || request.headers.get("x-hubflo-whatsapp-secret") || "";
    // Soft check: Meta signs payloads; until Graph app secrets are wired we also accept a shared header secret.
    if (provided !== webhookSecret && provided !== `sha256=${webhookSecret}`) {
      // Still accept unsigned traffic when only VERIFY_TOKEN is configured for Meta handshake.
      if (!process.env.WHATSAPP_VERIFY_TOKEN?.trim()) {
        return NextResponse.json({ error: "Invalid WhatsApp webhook secret." }, { status: 401 });
      }
    }
  }

  const payload = await request.json().catch(() => null) as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<Record<string, unknown>>;
          contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          metadata?: { display_phone_number?: string; phone_number_id?: string };
        };
      }>;
    }>;
  } | null;

  const captured: Array<Record<string, unknown>> = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contacts = value?.contacts ?? [];
      for (const message of value?.messages ?? []) {
        const from = typeof message.from === "string" ? message.from : "";
        const text = extractTextBody(message);
        if (!from || !text) continue;
        const contactName = contacts.find((item) => item.wa_id === from)?.profile?.name;
        const match = matchInboundToJob({
          fromPhone: from,
          body: text,
          subject: text.slice(0, 80),
        });
        const communication = appendJobCommunication({
          recordType: "job",
          recordId: match.job?.id ?? "unmatched",
          relatedJobId: match.job?.id,
          direction: "inbound",
          channel: "WhatsApp",
          subject: match.job ? `WhatsApp reply · ${match.job.ref}` : "WhatsApp reply",
          body: text,
          from: contactName ? `${contactName} (${from})` : from,
          to: value?.metadata?.display_phone_number || "NeXa WhatsApp",
          messageId: typeof message.id === "string" ? message.id : undefined,
          status: "Received",
        });
        captured.push({
          matchReason: match.matchReason,
          jobId: match.job?.id ?? null,
          jobRef: match.job?.ref ?? null,
          communication,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, captured: captured.length, results: captured });
}

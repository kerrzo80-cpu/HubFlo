import { NextResponse } from "next/server";

import { employeeHeaderName } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendJobCommunication } from "@/lib/job-comms-match";
import { sendWhatsAppMessage } from "@/lib/whatsapp-client";

type WhatsAppTestPayload = {
  to: string;
  message: string;
  jobId?: string;
  jobRef?: string;
  actorName?: string;
  recordCommunication?: boolean;
};

export async function POST(request: Request) {
  const payload = await parseJsonRequestBody<Partial<WhatsAppTestPayload>>(request);

  if (!payload?.to || !payload.message) {
    return NextResponse.json({ error: "WhatsApp number and message are required." }, { status: 400 });
  }

  const actorEmployeeId = request.headers.get(employeeHeaderName)?.trim() || undefined;
  const result = await sendWhatsAppMessage({
    to: payload.to,
    message: payload.message,
    actorEmployeeId,
    actorName: payload.actorName,
    jobId: payload.jobId,
    jobRef: payload.jobRef,
  });

  if (result.status === "sent" && payload.recordCommunication && payload.jobId) {
    appendJobCommunication({
      recordType: "job",
      recordId: payload.jobId,
      relatedJobId: payload.jobId,
      direction: "outbound",
      channel: "WhatsApp",
      subject: payload.jobRef ? `WhatsApp · ${payload.jobRef}` : "WhatsApp message",
      body: payload.message,
      from: payload.actorName?.trim() || "NeXa WhatsApp",
      to: payload.to,
      messageId: result.providerMessageId,
      status: "Sent",
      actorEmployeeId,
      actorName: payload.actorName,
    });
  }

  if (result.status === "failed") {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json(result);
}

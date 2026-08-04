import { NextResponse } from "next/server";

import { appendJobCommunication, matchInboundToJob } from "@/lib/job-comms-match";

function hasIntegrationAccess(request: Request) {
  const expectedToken = process.env.HUBFLO_INTEGRATION_TOKEN;
  if (!expectedToken) return true;
  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

type InboundEmailBody = {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  body?: string;
  messageId?: string;
  jobId?: string;
  jobRef?: string;
};

export async function POST(request: Request) {
  if (!hasIntegrationAccess(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as InboundEmailBody | null;
  const from = typeof body?.from === "string" ? body.from.trim() : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const text = (typeof body?.text === "string" ? body.text : typeof body?.body === "string" ? body.body : "").trim();
  if (!from || !subject || !text) {
    return NextResponse.json({ error: "from, subject and text are required." }, { status: 422 });
  }

  const match = matchInboundToJob({
    jobId: body?.jobId,
    jobRef: body?.jobRef,
    subject,
    body: text,
    fromEmail: from,
  });

  const communication = appendJobCommunication({
    recordType: "job",
    recordId: match.job?.id ?? "unmatched",
    relatedJobId: match.job?.id,
    direction: "inbound",
    channel: "Outlook",
    subject,
    body: text,
    from,
    to: typeof body?.to === "string" ? body.to : "NeXa",
    messageId: typeof body?.messageId === "string" ? body.messageId : undefined,
    status: "Received",
  });

  return NextResponse.json({
    ok: true,
    matchReason: match.matchReason,
    jobId: match.job?.id ?? null,
    jobRef: match.job?.ref ?? null,
    communication,
  }, { status: 201 });
}

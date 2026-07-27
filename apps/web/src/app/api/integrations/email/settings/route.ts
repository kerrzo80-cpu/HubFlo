import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getEmailIntegrationStatus, saveEmailIntegrationSettings, type EmailIntegrationInput } from "@/lib/email-integration-store";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(getEmailIntegrationStatus());
}

export async function PUT(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null) as Partial<EmailIntegrationInput> | null;
  if (!body?.provider || !body.senderEmail || !body.username) {
    return NextResponse.json({ error: "Provider, sender email and username are required." }, { status: 422 });
  }
  const status = saveEmailIntegrationSettings({
    provider: body.provider,
    senderEmail: body.senderEmail,
    username: body.username,
    secret: typeof body.secret === "string" ? body.secret : "",
    smtpHost: typeof body.smtpHost === "string" ? body.smtpHost : undefined,
    smtpPort: typeof body.smtpPort === "number" ? body.smtpPort : undefined,
    secure: typeof body.secure === "boolean" ? body.secure : undefined,
  });
  return NextResponse.json(status);
}

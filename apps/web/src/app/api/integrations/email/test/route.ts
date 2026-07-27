import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getEmailIntegrationStatus, testEmailIntegrationConnection } from "@/lib/email-integration-store";

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const status = await testEmailIntegrationConnection();
    return NextResponse.json({
      ok: true,
      message: `Connected to ${status.smtpHost}:${status.smtpPort}.`,
      status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to test the email connection.",
        status: getEmailIntegrationStatus(),
      },
      { status: 422 },
    );
  }
}

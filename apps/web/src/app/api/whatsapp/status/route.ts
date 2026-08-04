import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getWhatsAppConfigStatus } from "@/lib/whatsapp-client";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.canCreateQuote && !access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getWhatsAppConfigStatus();
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const webhookUrl = host ? `${proto}://${host}/api/whatsapp/webhook` : "/api/whatsapp/webhook";

  return NextResponse.json({
    ...status,
    webhookUrl,
    verifyTokenHint: status.verifyTokenPresent ? "Set in WHATSAPP_VERIFY_TOKEN" : "Add WHATSAPP_VERIFY_TOKEN on the server",
  });
}

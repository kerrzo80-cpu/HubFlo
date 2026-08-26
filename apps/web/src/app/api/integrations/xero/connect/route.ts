import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { nexaPublicOrigin } from "@/lib/accounting-provider-store";
import { startXeroAuthorization } from "@/lib/xero-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  const origin = nexaPublicOrigin(request);
  if (!access.showFinance && !access.canEditInvoice && !access.canCustomize) {
    return NextResponse.redirect(
      `${origin}/?xero=error&message=${encodeURIComponent("You need Finance access to connect Xero.")}`,
      302,
    );
  }

  try {
    const started = startXeroAuthorization(request);
    return NextResponse.redirect(started.authUrl, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start Xero connect.";
    return NextResponse.redirect(`${origin}/?xero=error&message=${encodeURIComponent(message)}`, 302);
  }
}

import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getXeroAuthStatus } from "@/lib/xero-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canEditInvoice && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getXeroAuthStatus();
  if (!status.authUrl) {
    return NextResponse.json(
      {
        error: "Xero connect needs XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI.",
        status,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    authUrl: status.authUrl,
    status,
  });
}

import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getXeroAuthStatus } from "@/lib/xero-auth";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canEditInvoice) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(getXeroAuthStatus());
}

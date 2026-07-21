import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getSimproBridgeStatus } from "@/lib/simpro-bridge";
import { getSimproSyncStatus } from "@/lib/simpro-sync";

export async function GET(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote && !access.showQuotes && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ...getSimproBridgeStatus(),
    sync: getSimproSyncStatus(),
    checkedAt: new Date().toISOString(),
  });
}

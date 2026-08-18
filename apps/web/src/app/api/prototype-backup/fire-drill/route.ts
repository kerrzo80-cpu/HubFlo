import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getLastFireDrillResult, runRestoreFireDrill } from "@/lib/pilot-backup";

/**
 * Safe restore fire-drill: shadow write → read-back hash → cleanup.
 * Never overwrites live business stores.
 */
export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) {
    return NextResponse.json({ error: "Forbidden — Owner/Admin only." }, { status: 403 });
  }

  const result = runRestoreFireDrill({ persist: true });
  return NextResponse.json(
    {
      ...result,
      message: result.ok
        ? "Fire-drill passed — backup bytes round-trip through store write/read."
        : "Fire-drill found mismatches — see mismatches[].",
    },
    { status: result.ok ? 200 : 500 },
  );
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ result: getLastFireDrillResult() });
}

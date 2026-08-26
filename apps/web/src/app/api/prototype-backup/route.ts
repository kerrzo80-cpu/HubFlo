import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { collectPilotBackup, currentStoreVerification } from "@/lib/pilot-backup";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const backup = collectPilotBackup();
  const verification = currentStoreVerification();

  if (format === "json" || format === "verify") {
    return NextResponse.json({
      ...backup,
      verification,
    });
  }

  const body = JSON.stringify(backup, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Disposition": `attachment; filename="nexa-pilot-backup-${backup.generatedAt.slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

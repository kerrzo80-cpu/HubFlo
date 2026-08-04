import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { cleanupImportedSimproRecords, getSimproSyncStatus } from "@/lib/simpro-sync";

type CleanupBody = {
  actor?: string;
  entities?: Array<"jobs" | "quotes">;
};

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<CleanupBody>(request);
  const result = cleanupImportedSimproRecords({
    actor: body?.actor,
    entities: body?.entities,
  });

  return NextResponse.json({
    ...result,
    status: getSimproSyncStatus(),
  });
}

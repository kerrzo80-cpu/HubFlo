import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { tickSimproImport } from "@/lib/simpro-import-service";
import { simproEntityLinkStats } from "@/lib/simpro-entity-links";

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

function canTickWithSecret(request: NextRequest) {
  const expected = process.env.NEXA_IMPORT_TICK_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-nexa-import-tick-secret")?.trim();
  return Boolean(provided && provided === expected);
}

export async function POST(request: NextRequest) {
  const allowed = canManageIntegrations(request) || canTickWithSecret(request);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await parseJsonRequestBody<{ runId?: string }>(request)) ?? {};
  try {
    const result = await tickSimproImport(body.runId?.trim() || undefined);
    return NextResponse.json({
      ok: true,
      ...result,
      linkStats: simproEntityLinkStats(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to tick import.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

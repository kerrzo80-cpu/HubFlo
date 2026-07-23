import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  exchangeSimproAuthorizationCode,
  getSimproReconnectStatus,
} from "@/lib/simpro-auth";
import { getSimproSyncStatus } from "@/lib/simpro-sync";

type ReconnectRequestBody = {
  code?: string;
};

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ...getSimproReconnectStatus(),
    sync: getSimproSyncStatus(),
  });
}

export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<ReconnectRequestBody>(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = body.code?.trim() ?? "";
  if (!code) {
    return NextResponse.json({ error: "Paste the fresh simPRO authorisation code or full redirect URL." }, { status: 400 });
  }

  try {
    const result = await exchangeSimproAuthorizationCode(code);
    return NextResponse.json({
      ok: true,
      actor: request.headers.get(employeeHeaderName) || "NeXa user",
      result,
      reconnect: getSimproReconnectStatus(),
      sync: getSimproSyncStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reconnect simPRO.";
    return NextResponse.json(
      {
        error: message,
        reconnect: getSimproReconnectStatus(),
        sync: getSimproSyncStatus(),
      },
      { status: 400 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { getSimproDirectConfigStatus } from "@/lib/simpro-auth";
import { getLastSimproDiscovery, runSimproDiscovery } from "@/lib/simpro-discovery";

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = getSimproDirectConfigStatus();
  return NextResponse.json({
    configured: status.configured,
    missing: status.configured ? [] : status.missing,
    companyId: status.companyId,
    lastRun: getLastSimproDiscovery(),
  });
}

export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actor = request.headers.get(employeeHeaderName) || "NeXa admin";
  try {
    const result = await runSimproDiscovery(actor);
    return NextResponse.json({
      ok: result.ok,
      result,
      // Explicitly never include tokens
      secretsIncluded: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run Simpro discovery.";
    const lower = message.toLowerCase();
    const status =
      lower.includes("not configured") || lower.includes("missing")
        ? 400
        : lower.includes("unauthenticated") || lower.includes("invalid refresh")
          ? 401
          : 500;
    return NextResponse.json(
      {
        ok: false,
        error: message,
        lastRun: getLastSimproDiscovery(),
        secretsIncluded: false,
      },
      { status },
    );
  }
}

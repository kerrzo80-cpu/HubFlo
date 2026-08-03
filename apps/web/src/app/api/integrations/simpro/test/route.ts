import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getSimproBridgeStatus, testSimproOutboundBridge } from "@/lib/simpro-bridge";

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await testSimproOutboundBridge();
    const bridge = getSimproBridgeStatus();
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.message,
          mode: result.mode,
          endpoint: result.endpoint,
          bridge,
          checkedAt: result.checkedAt,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
      mode: result.mode,
      endpoint: result.endpoint,
      bridge,
      checkedAt: result.checkedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to test the simPRO connection.",
        bridge: getSimproBridgeStatus(),
      },
      { status: 422 },
    );
  }
}

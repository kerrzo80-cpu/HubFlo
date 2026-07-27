import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { resolveSimproDirectConfig } from "@/lib/simpro-auth";

export async function POST(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const config = await resolveSimproDirectConfig();
    const endpoint = `${config.baseUrl}/companies/${config.companyId}/customers/?pageSize=1`;
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;

    if (!response.ok) {
      throw new Error(body?.error || body?.message || `simPRO returned HTTP ${response.status}.`);
    }

    return NextResponse.json({
      ok: true,
      message: `simPRO authenticated successfully for company ${config.companyId}.`,
      endpoint,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to test the simPRO connection.",
      },
      { status: 422 },
    );
  }
}

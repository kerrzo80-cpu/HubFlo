import { NextRequest, NextResponse } from "next/server";

import { getSimproAuthDiagnostics, resolveSimproDirectConfig } from "@/lib/simpro-auth";

export async function GET(request: NextRequest) {
  const diagnostics = getSimproAuthDiagnostics();
  const shouldProbe = request.nextUrl.searchParams.get("probe") === "1";

  let probe:
    | {
        ok: true;
        baseUrl: string;
        companyId: string;
      }
    | {
        ok: false;
        error: string;
      }
    | undefined;

  if (shouldProbe) {
    try {
      const config = await resolveSimproDirectConfig();
      probe = {
        ok: true,
        baseUrl: config.baseUrl,
        companyId: config.companyId,
      };
    } catch (error) {
      probe = {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown simPRO probe failure",
      };
    }
  }

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    diagnostics,
    probe,
  });
}

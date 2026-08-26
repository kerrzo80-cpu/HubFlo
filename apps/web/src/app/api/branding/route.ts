import { NextResponse } from "next/server";

import { applyEnvCompanyFallback, toPublicBranding } from "@/lib/branding";
import { getHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

/** Public owner branding for login, PWA titles/icons and sibling apps. */
export async function GET() {
  const hub = getHubDetailState();
  return NextResponse.json({
    ok: true,
    branding: toPublicBranding(applyEnvCompanyFallback(hub.businessSettings)),
  });
}

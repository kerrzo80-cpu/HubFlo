import { NextResponse } from "next/server";

import { hostFromRequest } from "@/lib/tenancy/request-context";
import { resolveTenantFromHost } from "@/lib/tenancy/resolve-tenant";
import { migrateLegacyStoresForEwg } from "@/lib/tenancy/tenant-server-store";
import { toPublicTenantView } from "@/lib/tenancy/types";

export const runtime = "nodejs";

/** Public tenant branding for login / shell — no secrets. */
export async function GET(request: Request) {
  try {
    migrateLegacyStoresForEwg();
  } catch {
    // ignore
  }
  const host = hostFromRequest(request);
  const resolved = resolveTenantFromHost(host);
  if (!resolved) {
    return NextResponse.json({ error: `Unknown company host: ${host}` }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    tenant: toPublicTenantView(resolved.tenant, resolved.host),
  });
}

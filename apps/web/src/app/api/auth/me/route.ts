import { NextResponse } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth-request";
import { isUserAuthenticationEnabled } from "@/lib/auth-store";
import { hostFromRequest } from "@/lib/tenancy/request-context";
import { resolveTenantFromHost } from "@/lib/tenancy/resolve-tenant";
import { listMemberships } from "@/lib/tenancy/tenant-store";
import { toPublicTenantView } from "@/lib/tenancy/types";
import { getWorkspaceMode } from "@/lib/workspace-mode";

export async function GET(request: Request) {
  const workspaceMode = getWorkspaceMode();
  const host = hostFromRequest(request);
  const resolved = resolveTenantFromHost(host);
  const tenant = resolved ? toPublicTenantView(resolved.tenant, resolved.host) : null;

  if (!isUserAuthenticationEnabled()) {
    return NextResponse.json({ mode: "pilot", workspaceMode, user: null, tenant });
  }
  const user = getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const memberships = resolved
    ? listMemberships(resolved.tenant.id).filter((item) => item.userId === user.id)
    : [];
  return NextResponse.json({
    mode: "users",
    workspaceMode,
    user,
    tenant,
    memberships,
  });
}

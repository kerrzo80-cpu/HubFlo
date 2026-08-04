import { hostFromRequest, runWithTenantContext } from "@/lib/tenancy/request-context";
import { resolveTenantFromHost } from "@/lib/tenancy/resolve-tenant";
import { migrateLegacyStoresForEwg } from "@/lib/tenancy/tenant-server-store";
import type { TenantRecord } from "@/lib/tenancy/types";

export async function withTenantFromRequest<T>(
  request: Request,
  handler: (tenant: TenantRecord, host: string) => Promise<T>,
): Promise<T> {
  const host = hostFromRequest(request);
  const resolved = resolveTenantFromHost(host);
  if (!resolved) {
    throw Object.assign(new Error(`Unknown tenant host: ${host || "(empty)"}`), { status: 404 });
  }
  migrateLegacyStoresForEwg();
  return runWithTenantContext(
    {
      tenantId: resolved.tenant.id,
      tenantSlug: resolved.tenant.slug,
      host: resolved.host,
      tenant: resolved.tenant,
    },
    () => handler(resolved.tenant, resolved.host),
  );
}

import { findTenantByHost, getTenantById } from "@/lib/tenancy/tenant-store";
import type { TenantRecord } from "@/lib/tenancy/types";
import { PLATFORM_ROOT_DOMAIN } from "@/lib/tenancy/types";

export type ResolvedTenant = {
  tenant: TenantRecord;
  host: string;
  matchedBy: "host" | "slug" | "legacy-fallback";
};

export function resolveTenantFromHost(hostname: string): ResolvedTenant | null {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  if (!host) return null;

  const byHost = findTenantByHost(host);
  if (!byHost) return null;

  const matchedBy: ResolvedTenant["matchedBy"] = byHost.hosts
    .map((item) => item.toLowerCase())
    .includes(host)
    ? "host"
    : host.startsWith(`${byHost.slug}.`)
      ? "slug"
      : "legacy-fallback";

  return { tenant: byHost, host, matchedBy };
}

export function tenantUrlForSlug(slug: string, protocol = "https") {
  return `${protocol}://${slug}.${PLATFORM_ROOT_DOMAIN}`;
}

export function assertTenantActive(tenantId: string): TenantRecord {
  const tenant = getTenantById(tenantId);
  if (!tenant || !tenant.active) {
    throw new Error("Tenant is inactive or missing.");
  }
  return tenant;
}

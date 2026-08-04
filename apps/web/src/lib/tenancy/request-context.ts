import { AsyncLocalStorage } from "node:async_hooks";

import type { TenantRecord } from "@/lib/tenancy/types";
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from "@/lib/tenancy/types";

export type TenantRequestContext = {
  tenantId: string;
  tenantSlug: string;
  host: string;
  tenant?: TenantRecord;
};

const storage = new AsyncLocalStorage<TenantRequestContext>();

export function runWithTenantContext<T>(context: TenantRequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getTenantContext(): TenantRequestContext | null {
  return storage.getStore() || null;
}

export function requireTenantContext(): TenantRequestContext {
  const context = getTenantContext();
  if (!context?.tenantId) {
    throw new Error("Missing tenant context — request must resolve a tenant host.");
  }
  return context;
}

export function requireTenantId(): string {
  return requireTenantContext().tenantId;
}

export function tenantIdFromHeaders(headers: Headers): string | null {
  const fromTrusted = headers.get(TENANT_ID_HEADER)?.trim();
  if (fromTrusted) return fromTrusted;
  return null;
}

export function tenantSlugFromHeaders(headers: Headers): string | null {
  return headers.get(TENANT_SLUG_HEADER)?.trim() || null;
}

export function hostFromRequest(request: Request | { headers: Headers }): string {
  const headers = "headers" in request ? request.headers : request;
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (forwarded || headers.get("host") || "").trim().toLowerCase();
  return host.replace(/:\d+$/, "");
}

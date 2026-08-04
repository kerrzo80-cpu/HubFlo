import {
  loadServerStore,
  readServerStoreSnapshot,
  writeServerStore,
} from "@/lib/server-store";
import { requireTenantId, getTenantContext } from "@/lib/tenancy/request-context";
import { EWG_TENANT_ID } from "@/lib/tenancy/types";
import { getLegacyMigrationMarker, markLegacyStoresMigrated } from "@/lib/tenancy/tenant-store";

/**
 * Namespaced store keys: tenant__{tenantId}__{storeName}
 * Legacy (pre-multi-tenant) global rows are copied into the EWG tenant once.
 */
const LEGACY_STORE_NAMES = [
  "auth-store",
  "hub-detail-store",
  "workflow-store",
  "people-store",
  "lead-store",
  "takeoff-store",
  "survey-estimator-v1",
  "daywork-sheets-store",
  "daywork-write-log",
  "engineer-workflow-store",
  "engineer-time-checks",
  "nexa-setup-config-v1",
  "nexa-stock-v1",
  "nexa-site-assets-v1",
  "nexa-prebuilds-v1",
  "nexa-recurring-v1",
  "variation-portal-store",
  "record-documents-store",
  "nexa-openai-config",
  "nexa-assistant-actions",
  "email-integration",
] as const;

export function tenantStoreKey(tenantId: string, name: string) {
  if (!tenantId.trim()) throw new Error("tenantId required for store access");
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Invalid store name");
  return `tenant__${tenantId}__${name}`;
}

export function migrateLegacyStoresForEwg() {
  const marker = "legacy-blob-copy-v1";
  if (getLegacyMigrationMarker(EWG_TENANT_ID) === marker) return { migrated: false, marker };

  for (const name of LEGACY_STORE_NAMES) {
    const namespaced = tenantStoreKey(EWG_TENANT_ID, name);
    const already = readServerStoreSnapshot(namespaced);
    if (already) continue;
    const legacy = readServerStoreSnapshot(name);
    if (legacy == null) continue;
    writeServerStore(namespaced, legacy);
  }

  markLegacyStoresMigrated(EWG_TENANT_ID, marker);
  return { migrated: true, marker };
}

export function loadTenantServerStore<T>(name: string, fallback: T, tenantId = requireTenantId()): T {
  migrateLegacyStoresForEwg();
  return loadServerStore(tenantStoreKey(tenantId, name), fallback);
}

export function writeTenantServerStore<T>(name: string, value: T, tenantId = requireTenantId()): void {
  migrateLegacyStoresForEwg();
  writeServerStore(tenantStoreKey(tenantId, name), value);
}

export function readTenantServerStoreSnapshot(name: string, tenantId = requireTenantId()) {
  migrateLegacyStoresForEwg();
  return readServerStoreSnapshot(tenantStoreKey(tenantId, name));
}

/** Prefer ALS tenant; fall back only when explicitly allowed (scripts). */
export function optionalTenantId() {
  return getTenantContext()?.tenantId || null;
}

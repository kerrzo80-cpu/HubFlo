import { loadServerStore, writeServerStore, readServerStoreSnapshot } from "@/lib/server-store";
import {
  defaultEwgTenant,
  defaultTenantAiSettings,
  EWG_TENANT_ID,
  isReservedTenantSlug,
  normaliseTenantSlug,
  type TenantAiSettings,
  type TenantMembership,
  type TenantModuleId,
  type TenantRecord,
} from "@/lib/tenancy/types";

type TenantRegistry = {
  tenants: TenantRecord[];
  memberships: TenantMembership[];
  migratedLegacyStores?: Record<string, string>;
};

const REGISTRY_STORE = "nexa-tenants-v1";
const emptyRegistry: TenantRegistry = { tenants: [], memberships: [], migratedLegacyStores: {} };

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readRegistry(): TenantRegistry {
  const snapshot = readServerStoreSnapshot(REGISTRY_STORE) as Partial<TenantRegistry> | null;
  if (!snapshot) {
    return loadServerStore<TenantRegistry>(REGISTRY_STORE, emptyRegistry);
  }
  return {
    tenants: Array.isArray(snapshot.tenants) ? snapshot.tenants : [],
    memberships: Array.isArray(snapshot.memberships) ? snapshot.memberships : [],
    migratedLegacyStores: snapshot.migratedLegacyStores || {},
  };
}

function writeRegistry(registry: TenantRegistry) {
  writeServerStore(REGISTRY_STORE, registry);
}

function ensureEwgTenant(registry: TenantRegistry): TenantRegistry {
  if (registry.tenants.some((tenant) => tenant.id === EWG_TENANT_ID)) return registry;
  const next = clone(registry);
  next.tenants.push(defaultEwgTenant());
  writeRegistry(next);
  return next;
}

export function listTenants(): TenantRecord[] {
  return ensureEwgTenant(readRegistry()).tenants.map((tenant) => clone(tenant));
}

export function getTenantById(tenantId: string): TenantRecord | null {
  const tenant = ensureEwgTenant(readRegistry()).tenants.find((item) => item.id === tenantId);
  return tenant ? clone(tenant) : null;
}

export function getTenantBySlug(slug: string): TenantRecord | null {
  const normalised = normaliseTenantSlug(slug);
  const tenant = ensureEwgTenant(readRegistry()).tenants.find(
    (item) => item.slug === normalised && item.active,
  );
  return tenant ? clone(tenant) : null;
}

export function findTenantByHost(hostname: string): TenantRecord | null {
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  if (!host) return null;
  const registry = ensureEwgTenant(readRegistry());

  const exact = registry.tenants.find(
    (tenant) => tenant.active && tenant.hosts.map((item) => item.toLowerCase()).includes(host),
  );
  if (exact) return clone(exact);

  // {slug}.nexaapp.com or {slug}.localhost for local multi-tenant testing
  const parts = host.split(".");
  if (parts.length >= 2) {
    const slug = parts[0];
    if (slug && slug !== "www") {
      const bySlug = registry.tenants.find((tenant) => tenant.active && tenant.slug === slug);
      if (bySlug) return clone(bySlug);
    }
  }

  // Legacy single-host Render / local → EWG
  if (
    host.includes("onrender.com") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local")
  ) {
    return getTenantById(EWG_TENANT_ID);
  }

  return null;
}

export function createTenant(input: {
  name: string;
  slug: string;
  branding?: Partial<TenantRecord["branding"]>;
  commercial?: Partial<TenantRecord["commercial"]>;
  enabledModules?: TenantModuleId[];
  hosts?: string[];
}): TenantRecord {
  const registry = ensureEwgTenant(readRegistry());
  const slug = normaliseTenantSlug(input.slug);
  if (!slug || isReservedTenantSlug(slug)) {
    throw new Error("Choose a different company slug.");
  }
  if (registry.tenants.some((tenant) => tenant.slug === slug)) {
    throw new Error("That company slug is already in use.");
  }
  const now = nowIso();
  const base = defaultEwgTenant(now);
  const tenant: TenantRecord = {
    ...base,
    id: `tenant-${slug}`,
    slug,
    name: input.name.trim() || slug,
    hosts: Array.from(
      new Set([
        ...(input.hosts || []),
        `${slug}.nexaapp.com`,
        `${slug}.localhost`,
      ].map((host) => host.toLowerCase())),
    ),
    branding: {
      ...base.branding,
      ...input.branding,
      companyName: input.branding?.companyName || input.name.trim() || slug,
      tradingName: input.branding?.tradingName || input.name.trim() || slug,
      logoUrl: input.branding?.logoUrl || "",
      primaryColor: input.branding?.primaryColor || "#157fa8",
      accentColor: input.branding?.accentColor || "#0f5f7d",
    },
    commercial: {
      ...base.commercial,
      ...input.commercial,
    },
    enabledModules: input.enabledModules?.length ? input.enabledModules : base.enabledModules,
    createdAt: now,
    updatedAt: now,
  };
  registry.tenants.push(tenant);
  writeRegistry(registry);
  writeTenantAiSettings(defaultTenantAiSettings(tenant.id, now));
  return clone(tenant);
}

export function updateTenant(tenantId: string, patch: Partial<TenantRecord>): TenantRecord {
  const registry = ensureEwgTenant(readRegistry());
  const index = registry.tenants.findIndex((tenant) => tenant.id === tenantId);
  if (index < 0) throw new Error("Tenant not found.");
  const current = registry.tenants[index]!;
  const next: TenantRecord = {
    ...current,
    ...patch,
    id: current.id,
    slug: current.slug,
    branding: { ...current.branding, ...(patch.branding || {}) },
    commercial: { ...current.commercial, ...(patch.commercial || {}) },
    hosts: patch.hosts ? Array.from(new Set(patch.hosts.map((host) => host.toLowerCase()))) : current.hosts,
    enabledModules: patch.enabledModules || current.enabledModules,
    updatedAt: nowIso(),
  };
  registry.tenants[index] = next;
  writeRegistry(registry);
  return clone(next);
}

export function listMemberships(tenantId?: string): TenantMembership[] {
  const registry = ensureEwgTenant(readRegistry());
  return registry.memberships
    .filter((item) => (tenantId ? item.tenantId === tenantId : true))
    .map((item) => clone(item));
}

export function upsertMembership(input: {
  tenantId: string;
  userId: string;
  role: string;
  status?: TenantMembership["status"];
}): TenantMembership {
  const registry = ensureEwgTenant(readRegistry());
  const existing = registry.memberships.find(
    (item) => item.tenantId === input.tenantId && item.userId === input.userId,
  );
  const now = nowIso();
  if (existing) {
    existing.role = input.role;
    existing.status = input.status || existing.status;
    existing.updatedAt = now;
    writeRegistry(registry);
    return clone(existing);
  }
  const membership: TenantMembership = {
    id: `membership-${input.tenantId}-${input.userId}`,
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
    status: input.status || "active",
    createdAt: now,
    updatedAt: now,
  };
  registry.memberships.push(membership);
  writeRegistry(registry);
  return clone(membership);
}

export function userHasActiveMembership(tenantId: string, userId: string) {
  return listMemberships(tenantId).some(
    (item) => item.userId === userId && item.status === "active",
  );
}

export function markLegacyStoresMigrated(tenantId: string, marker: string) {
  const registry = ensureEwgTenant(readRegistry());
  registry.migratedLegacyStores = {
    ...(registry.migratedLegacyStores || {}),
    [tenantId]: marker,
  };
  writeRegistry(registry);
}

export function getLegacyMigrationMarker(tenantId: string) {
  return ensureEwgTenant(readRegistry()).migratedLegacyStores?.[tenantId] || null;
}

function aiStoreName(tenantId: string) {
  return `tenant__${tenantId}__ai-settings`;
}

export function getTenantAiSettings(tenantId: string): TenantAiSettings {
  return loadServerStore(aiStoreName(tenantId), defaultTenantAiSettings(tenantId));
}

export function writeTenantAiSettings(settings: TenantAiSettings) {
  writeServerStore(aiStoreName(settings.tenantId), settings);
  return clone(settings);
}

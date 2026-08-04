/**
 * Multi-tenant SaaS types for NeXa (nexaapp.com / {slug}.nexaapp.com).
 * Milestone 1: detection, branding, scoped storage. Custom domains supported via hosts[].
 */

export const TENANT_ID_HEADER = "x-nexa-tenant-id";
export const TENANT_SLUG_HEADER = "x-nexa-tenant-slug";
export const PLATFORM_ROOT_DOMAIN = process.env.NEXA_ROOT_DOMAIN?.trim().toLowerCase() || "nexaapp.com";

/** Stable id for the founding Errol Watson Group tenant (legacy single-tenant data). */
export const EWG_TENANT_ID = "tenant-ewg";
export const EWG_TENANT_SLUG = "ewg";

export type TenantModuleId =
  | "core"
  | "field"
  | "survey"
  | "takeoff"
  | "heat-design"
  | "ask-blake"
  | "xero"
  | "simpro";

export type TenantBranding = {
  companyName: string;
  tradingName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  address?: string;
  vatNumber?: string;
  companyNumber?: string;
};

export type TenantCommercialSettings = {
  labourRate?: string;
  materialMarkupPercent?: string;
  templateFooter?: string;
  currency: string;
  timezone: string;
};

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  /** Explicit hostnames (custom domains + legacy Render hosts). */
  hosts: string[];
  branding: TenantBranding;
  commercial: TenantCommercialSettings;
  enabledModules: TenantModuleId[];
  createdAt: string;
  updatedAt: string;
};

export type TenantMembershipStatus = "invited" | "active" | "suspended";

export type TenantMembership = {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: TenantMembershipStatus;
  createdAt: string;
  updatedAt: string;
};

export type TenantAiSettings = {
  tenantId: string;
  enabled: boolean;
  tone: string;
  assistantName: string;
  instructions: string;
  tradeType: string;
  permissions: {
    canAnswerTrade: boolean;
    canUseJobContext: boolean;
    canProposeActions: boolean;
  };
  usageLimits: {
    dailyRequests: number;
    monthlyTokens: number;
  };
  model: string;
  /** AES-GCM ciphertext of optional tenant-provided OpenAI key. Never returned to clients. */
  encryptedApiKey?: string;
  /** Masked display only — last 4 of key when set. */
  apiKeyLastFour?: string;
  updatedAt: string;
  updatedBy?: string;
};

export type PublicTenantView = {
  id: string;
  slug: string;
  name: string;
  branding: TenantBranding;
  commercial: Pick<TenantCommercialSettings, "currency" | "timezone" | "templateFooter">;
  enabledModules: TenantModuleId[];
  host: string;
  urlHint: string;
};

export const DEFAULT_TENANT_MODULES: TenantModuleId[] = [
  "core",
  "field",
  "survey",
  "takeoff",
  "heat-design",
  "ask-blake",
];

export function defaultEwgTenant(now = new Date().toISOString()): TenantRecord {
  return {
    id: EWG_TENANT_ID,
    slug: EWG_TENANT_SLUG,
    name: "Errol Watson Group",
    active: true,
    hosts: [
      "nexa-live.onrender.com",
      "nexa-pilot.onrender.com",
      "localhost",
      "127.0.0.1",
    ],
    branding: {
      companyName: "Errol Watson Group",
      tradingName: "Errol Watson Group",
      logoUrl: "/ewg-logo.png",
      primaryColor: "#157fa8",
      accentColor: "#0f5f7d",
      contactEmail: "office@errolwatsongroup.com",
      contactPhone: "",
      website: "",
      address: "",
      vatNumber: "",
      companyNumber: "",
    },
    commercial: {
      labourRate: "",
      materialMarkupPercent: "",
      templateFooter: "Errol Watson Group — Daywork & service operations",
      currency: "GBP",
      timezone: "Europe/London",
    },
    enabledModules: [...DEFAULT_TENANT_MODULES, "xero", "simpro"],
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultTenantAiSettings(tenantId: string, now = new Date().toISOString()): TenantAiSettings {
  return {
    tenantId,
    enabled: true,
    tone: "practical, concise, site-safe",
    assistantName: "Blake",
    instructions: "Help field engineers and office staff with trade, job and scheduling questions.",
    tradeType: "plumbing-heating",
    permissions: {
      canAnswerTrade: true,
      canUseJobContext: true,
      canProposeActions: true,
    },
    usageLimits: {
      dailyRequests: 500,
      monthlyTokens: 2_000_000,
    },
    model: "gpt-4.1-mini",
    updatedAt: now,
  };
}

export function normaliseTenantSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function isReservedTenantSlug(slug: string) {
  return [
    "www",
    "app",
    "api",
    "admin",
    "platform",
    "status",
    "mail",
    "cdn",
    "static",
    "nexa",
    "hubflo",
  ].includes(slug);
}

export function toPublicTenantView(tenant: TenantRecord, host: string): PublicTenantView {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    branding: { ...tenant.branding },
    commercial: {
      currency: tenant.commercial.currency,
      timezone: tenant.commercial.timezone,
      templateFooter: tenant.commercial.templateFooter,
    },
    enabledModules: [...tenant.enabledModules],
    host,
    urlHint: `${tenant.slug}.${PLATFORM_ROOT_DOMAIN}`,
  };
}

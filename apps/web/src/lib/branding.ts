/** Owner white-label / personalising settings shared across Core, Field, Survey, Takeoffs, Heat Design and Trainer. */

import {
  DEFAULT_COMPANY_LOGO_URL,
  PLATFORM_LOCKUP_LIGHT_URL,
  PLATFORM_MARK_URL,
  PLATFORM_NAME,
  PLATFORM_WORDMARK_DARK_URL,
} from "@/lib/product-brand";

export type BusinessBrandingSettings = {
  companyName: string;
  tradingName: string;
  workspaceName: string;
  contactEmail: string;
  phone: string;
  address: string;
  vatNumber: string;
  companyNumber: string;
  /** Unique Taxpayer Reference (UTR) for HMRC / subcontractor CIS where applicable. */
  utrNumber: string;
  defaultFromEmail: string;
  clientPortalBrandLine: string;
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoUrl: string;
  /** Square icon for home-screen / PWA; falls back to logoUrl. */
  appIconUrl: string;
  /** Per-app logos / home-screen icons. Empty = fall back to appIconUrl → logoUrl. */
  coreLogoUrl: string;
  fieldLogoUrl: string;
  surveyLogoUrl: string;
  takeoffsLogoUrl: string;
  heatDesignLogoUrl: string;
  trainerLogoUrl: string;
  portalWelcomeText: string;
  portalAcceptanceText: string;
  /** When true, Blake product chrome is hidden — platform feels like the owner brand. */
  hidePlatformName: boolean;
  /** Short owner product label used when platform name is shown (e.g. EWG). */
  productName: string;
  coreAppName: string;
  fieldAppName: string;
  surveyAppName: string;
  takeoffsAppName: string;
  heatDesignAppName: string;
  trainerAppName: string;
};

export type PublicBranding = {
  companyName: string;
  tradingName: string;
  productName: string;
  workspaceName: string;
  hidePlatformName: boolean;
  brandPrimaryColor: string;
  brandAccentColor: string;
  logoUrl: string;
  appIconUrl: string;
  coreLogoUrl: string;
  fieldLogoUrl: string;
  surveyLogoUrl: string;
  takeoffsLogoUrl: string;
  heatDesignLogoUrl: string;
  trainerLogoUrl: string;
  coreAppName: string;
  fieldAppName: string;
  surveyAppName: string;
  takeoffsAppName: string;
  heatDesignAppName: string;
  trainerAppName: string;
  clientPortalBrandLine: string;
};

/** Product defaults for an empty company. Never bake in Errol Watson Group / EWG logos. */
export const defaultBusinessBrandingSettings: BusinessBrandingSettings = {
  companyName: "Company",
  tradingName: "",
  workspaceName: "",
  contactEmail: "",
  phone: "",
  address: "",
  vatNumber: "",
  companyNumber: "",
  utrNumber: "",
  defaultFromEmail: "",
  clientPortalBrandLine: "Control every moving part.",
  brandPrimaryColor: "#157fa8",
  brandAccentColor: "#0f5f7d",
  logoUrl: "",
  appIconUrl: "",
  coreLogoUrl: "",
  fieldLogoUrl: "",
  surveyLogoUrl: "",
  takeoffsLogoUrl: "",
  heatDesignLogoUrl: "",
  trainerLogoUrl: "",
  portalWelcomeText: "Welcome. Review quotes, jobs and invoices in one place.",
  portalAcceptanceText: "By accepting this quotation online you confirm the scope, price and terms shown.",
  hidePlatformName: false,
  productName: "Company",
  coreAppName: "Core",
  fieldAppName: "Field",
  surveyAppName: "Survey",
  takeoffsAppName: "Takeoffs",
  heatDesignAppName: "Heat Design",
  trainerAppName: "Ayla Trainer",
};

export function displayCompanyName(brand?: { companyName?: string; tradingName?: string } | null) {
  const trading = String(brand?.tradingName || "").trim();
  const company = String(brand?.companyName || "").trim();
  return trading || company || "Company";
}

/** Fill blank company name from NEXA_COMPANY_NAME. Does not override a saved office name. */
export function applyEnvCompanyFallback(
  raw?: Partial<BusinessBrandingSettings> | Record<string, unknown> | null,
  env: NodeJS.ProcessEnv = process.env,
): BusinessBrandingSettings {
  const brand = normalizeBusinessBranding(raw);
  const envName = env.NEXA_COMPANY_NAME?.trim();
  if (!envName) return brand;
  const unset = !brand.companyName.trim() || brand.companyName.trim() === "Company";
  if (!unset) return brand;
  return {
    ...brand,
    companyName: envName,
    tradingName: brand.tradingName.trim() || envName,
    workspaceName: brand.workspaceName.trim() || `${envName} workspace`,
    productName: brand.productName.trim() === "Company" ? envName : brand.productName,
  };
}

export type BrandAppKey = "core" | "field" | "survey" | "estimator" | "takeoffs" | "heat-design" | "trainer";

export type BrandAppLogoField =
  | "coreLogoUrl"
  | "fieldLogoUrl"
  | "surveyLogoUrl"
  | "takeoffsLogoUrl"
  | "heatDesignLogoUrl"
  | "trainerLogoUrl";

export function brandAppLogoField(app: BrandAppKey): BrandAppLogoField {
  switch (app) {
    case "core":
      return "coreLogoUrl";
    case "field":
      return "fieldLogoUrl";
    case "survey":
    case "estimator":
      return "surveyLogoUrl";
    case "takeoffs":
      return "takeoffsLogoUrl";
    case "heat-design":
      return "heatDesignLogoUrl";
    case "trainer":
      return "trainerLogoUrl";
    default:
      return "coreLogoUrl";
  }
}

function trimLogoUrl(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeBusinessBranding(raw?: Partial<BusinessBrandingSettings> | Record<string, unknown> | null): BusinessBrandingSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<BusinessBrandingSettings>;
  return {
    ...defaultBusinessBrandingSettings,
    ...source,
    hidePlatformName:
      typeof source.hidePlatformName === "boolean"
        ? source.hidePlatformName
        : defaultBusinessBrandingSettings.hidePlatformName,
    brandPrimaryColor: String(source.brandPrimaryColor || defaultBusinessBrandingSettings.brandPrimaryColor).trim() || defaultBusinessBrandingSettings.brandPrimaryColor,
    brandAccentColor: String(source.brandAccentColor || defaultBusinessBrandingSettings.brandAccentColor).trim() || defaultBusinessBrandingSettings.brandAccentColor,
    logoUrl: trimLogoUrl(source.logoUrl),
    appIconUrl: trimLogoUrl(source.appIconUrl || source.logoUrl),
    coreLogoUrl: trimLogoUrl(source.coreLogoUrl),
    fieldLogoUrl: trimLogoUrl(source.fieldLogoUrl),
    surveyLogoUrl: trimLogoUrl(source.surveyLogoUrl),
    takeoffsLogoUrl: trimLogoUrl(source.takeoffsLogoUrl),
    heatDesignLogoUrl: trimLogoUrl(source.heatDesignLogoUrl),
    trainerLogoUrl: trimLogoUrl(source.trainerLogoUrl),
    productName: String(source.productName || defaultBusinessBrandingSettings.productName).trim() || defaultBusinessBrandingSettings.productName,
    coreAppName: String(source.coreAppName || defaultBusinessBrandingSettings.coreAppName).trim() || defaultBusinessBrandingSettings.coreAppName,
    fieldAppName: String(source.fieldAppName || defaultBusinessBrandingSettings.fieldAppName).trim() || defaultBusinessBrandingSettings.fieldAppName,
    surveyAppName: String(source.surveyAppName || defaultBusinessBrandingSettings.surveyAppName).trim() || defaultBusinessBrandingSettings.surveyAppName,
    takeoffsAppName: String(source.takeoffsAppName || defaultBusinessBrandingSettings.takeoffsAppName).trim() || defaultBusinessBrandingSettings.takeoffsAppName,
    heatDesignAppName: String(source.heatDesignAppName || defaultBusinessBrandingSettings.heatDesignAppName).trim() || defaultBusinessBrandingSettings.heatDesignAppName,
    trainerAppName: String(source.trainerAppName || defaultBusinessBrandingSettings.trainerAppName).trim() || defaultBusinessBrandingSettings.trainerAppName,
  };
}

export function toPublicBranding(settings?: Partial<BusinessBrandingSettings> | Record<string, unknown> | null): PublicBranding {
  const brand = normalizeBusinessBranding(settings);
  return {
    companyName: brand.companyName,
    tradingName: brand.tradingName,
    productName: brand.productName,
    workspaceName: brand.workspaceName,
    hidePlatformName: brand.hidePlatformName,
    brandPrimaryColor: brand.brandPrimaryColor,
    brandAccentColor: brand.brandAccentColor,
    logoUrl: brand.logoUrl,
    appIconUrl: brand.appIconUrl || brand.logoUrl,
    coreLogoUrl: brand.coreLogoUrl,
    fieldLogoUrl: brand.fieldLogoUrl,
    surveyLogoUrl: brand.surveyLogoUrl,
    takeoffsLogoUrl: brand.takeoffsLogoUrl,
    heatDesignLogoUrl: brand.heatDesignLogoUrl,
    trainerLogoUrl: brand.trainerLogoUrl,
    coreAppName: brand.coreAppName,
    fieldAppName: brand.fieldAppName,
    surveyAppName: brand.surveyAppName,
    takeoffsAppName: brand.takeoffsAppName,
    heatDesignAppName: brand.heatDesignAppName,
    trainerAppName: brand.trainerAppName,
    clientPortalBrandLine: brand.clientPortalBrandLine,
  };
}

export function appDisplayName(brand: PublicBranding | BusinessBrandingSettings, app: BrandAppKey): string {
  switch (app) {
    case "core":
      return brand.coreAppName;
    case "field":
      return brand.fieldAppName;
    case "survey":
    case "estimator":
      return brand.surveyAppName;
    case "takeoffs":
      return brand.takeoffsAppName;
    case "heat-design":
      return brand.heatDesignAppName;
    case "trainer":
      return brand.trainerAppName;
    default:
      return brand.productName;
  }
}

export function operationsLabel(brand: PublicBranding | BusinessBrandingSettings): string {
  if (brand.hidePlatformName) {
    return `${brand.productName || brand.companyName} Operations`;
  }
  return `${PLATFORM_NAME} Operations`;
}

export function platformLabel(brand: PublicBranding | BusinessBrandingSettings): string {
  if (brand.hidePlatformName) return brand.productName || brand.companyName;
  return PLATFORM_NAME;
}

function lightenHex(hex: string, amount: number): string {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(cleaned.slice(offset, offset + 2), 16);
    return Math.min(255, Math.round(value + (255 - value) * amount));
  });
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function darkenHex(hex: string, amount: number): string {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(cleaned.slice(offset, offset + 2), 16);
    return Math.max(0, Math.round(value * (1 - amount)));
  });
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Apply owner colours to CSS variables used across Core and sibling apps. */
export function applyBrandCssVariables(brand: Pick<PublicBranding, "brandPrimaryColor" | "brandAccentColor">) {
  if (typeof document === "undefined") return;
  const primary = brand.brandPrimaryColor || defaultBusinessBrandingSettings.brandPrimaryColor;
  const accent = brand.brandAccentColor || defaultBusinessBrandingSettings.brandAccentColor;
  const root = document.documentElement;
  root.style.setProperty("--nexa-accent", primary);
  root.style.setProperty("--nexa-accent-2", accent);
  root.style.setProperty("--nexa-cyan", primary);
  root.style.setProperty("--nexa-cyan-light", lightenHex(primary, 0.35));
  root.style.setProperty("--nexa-cyan-deep", darkenHex(primary, 0.25));
  root.style.setProperty("--nexa-cyan-soft", lightenHex(primary, 0.88));
  root.style.setProperty("--nexa-verdigris", primary);
  root.style.setProperty("--nexa-verdigris-soft", lightenHex(primary, 0.88));
  root.style.setProperty("--brand", primary);
  root.style.setProperty("--blue", lightenHex(primary, 0.35));
  root.style.setProperty("--blue-dark", primary);
  root.style.setProperty("--blue-deep", darkenHex(primary, 0.25));
  root.style.setProperty("--blue-soft", lightenHex(primary, 0.88));
}

/** Company / trading logo for PDFs, certificates and Customise Forms — never the blake. product mark. */
export function resolveCompanyLogoUrl(brand: PublicBranding | BusinessBrandingSettings): string {
  return trimLogoUrl(brand.logoUrl) || DEFAULT_COMPANY_LOGO_URL;
}

/** In-app product chrome logo (per-app upload → blake. wordmark). Not for customer-facing forms. */
export function resolveBrandLogoUrl(brand: PublicBranding | BusinessBrandingSettings, app?: BrandAppKey): string {
  if (app) {
    const specific = trimLogoUrl(brand[brandAppLogoField(app)]);
    if (specific) return specific;
  }
  return PLATFORM_WORDMARK_DARK_URL;
}

/**
 * Logos for coloured chrome bars (Core header, blue rail, Field topbar).
 * Prefer the blake. wordmark — square per-app marks read as a boxed “edge” on blue.
 */
export function resolveBrandChromeLogoUrl(
  brand: PublicBranding | BusinessBrandingSettings,
  app?: BrandAppKey,
): string {
  if (app) {
    const specific = trimLogoUrl(brand[brandAppLogoField(app)]);
    if (specific) {
      if (/logo-core|ewg-mark|appIcon|icon/i.test(specific) && !/logo-field|logo-survey|logo-takeoffs|logo-heat|logo-trainer/i.test(specific)) {
        return PLATFORM_WORDMARK_DARK_URL;
      }
      return specific;
    }
  }
  return PLATFORM_WORDMARK_DARK_URL;
}

/** Append home=1 so /api/branding/assets/* returns the composed home-screen icon. */
function withHomeIconParam(url: string): string {
  const trimmed = trimLogoUrl(url);
  if (!trimmed.includes("/api/branding/assets/")) return trimmed;
  if (/[?&]home=1(?:&|$)/.test(trimmed) || /[?&]apple=1(?:&|$)/.test(trimmed)) return trimmed;
  return trimmed.includes("?") ? `${trimmed}&home=1` : `${trimmed}?home=1`;
}

/** Home-screen / PWA icon for an app (per-app → blake. mark). Company logo stays on forms. */
export function resolveBrandIconUrl(brand: PublicBranding | BusinessBrandingSettings, app?: BrandAppKey): string {
  if (app) {
    const specific = trimLogoUrl(brand[brandAppLogoField(app)]);
    if (specific) return withHomeIconParam(specific);
  }
  return PLATFORM_MARK_URL;
}

/** Dark-rail lockup for Core sidebar — blake. unless a Core-specific logo was uploaded. */
export function resolvePlatformRailLockup(brand: PublicBranding | BusinessBrandingSettings): string {
  const coreLogo = trimLogoUrl(brand.coreLogoUrl);
  if (coreLogo) return coreLogo;
  return PLATFORM_LOCKUP_LIGHT_URL;
}

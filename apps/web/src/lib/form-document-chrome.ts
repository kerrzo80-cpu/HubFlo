import type { BusinessBrandingSettings } from "@/lib/branding";
import { normalizeBusinessBranding, resolveCompanyLogoUrl } from "@/lib/branding";

export type FormDocumentLayout =
  | "quote"
  | "job-sheet"
  | "application-payment"
  | "invoice"
  | "purchase-order"
  | "daywork-account"
  | "gas-safe-lgsr";

export type FormDocumentTemplate = {
  id: string;
  layout: FormDocumentLayout;
  name: string;
  title: string;
  intro: string;
  footer: string;
  terms: string;
  defaultAudience: "Client" | "Engineer" | "Office" | "Supplier";
  includeCostCentreBreakdown: boolean;
  includePnl: boolean;
  includeAcceptance: boolean;
  includeBankDetails: boolean;
  /** Small kicker / subtitle under the masthead title. */
  headerNote: string;
  showLogo: boolean;
  /** Empty = use Personalising company logo. */
  logoUrl: string;
  /** Empty = use Personalising primary colour. */
  headerColor: string;
  showCompanyDetails: boolean;
  showVatCompanyNumbers: boolean;
  acceptanceLabel: string;
};

export type FormDocumentChrome = {
  logoUrl: string;
  showLogo: boolean;
  tradingName: string;
  address: string;
  phone: string;
  contactEmail: string;
  vatNumber: string;
  companyNumber: string;
  brandLine: string;
  title: string;
  headerNote: string;
  headerColor: string;
  showCompanyDetails: boolean;
  showVatCompanyNumbers: boolean;
  acceptanceLabel: string;
  intro: string;
  footer: string;
  terms: string;
};

const defaultChromeFields = {
  headerNote: "",
  showLogo: true,
  logoUrl: "",
  headerColor: "",
  showCompanyDetails: true,
  showVatCompanyNumbers: true,
  acceptanceLabel: "Online acceptance recorded",
};

export function normalizeFormDocumentTemplate(
  template: Partial<FormDocumentTemplate> & Pick<FormDocumentTemplate, "id" | "layout" | "name" | "title">,
  fallback?: FormDocumentTemplate,
): FormDocumentTemplate {
  const base = fallback || {
    id: template.id,
    layout: template.layout,
    name: template.name,
    title: template.title,
    intro: "",
    footer: "",
    terms: "",
    defaultAudience: "Client" as const,
    includeCostCentreBreakdown: false,
    includePnl: false,
    includeAcceptance: false,
    includeBankDetails: false,
    ...defaultChromeFields,
  };
  return {
    ...base,
    ...template,
    headerNote: String(template.headerNote ?? base.headerNote ?? ""),
    showLogo: typeof template.showLogo === "boolean" ? template.showLogo : base.showLogo,
    logoUrl: String(template.logoUrl ?? base.logoUrl ?? ""),
    headerColor: String(template.headerColor ?? base.headerColor ?? ""),
    showCompanyDetails:
      typeof template.showCompanyDetails === "boolean" ? template.showCompanyDetails : base.showCompanyDetails,
    showVatCompanyNumbers:
      typeof template.showVatCompanyNumbers === "boolean" ? template.showVatCompanyNumbers : base.showVatCompanyNumbers,
    acceptanceLabel: String(template.acceptanceLabel ?? base.acceptanceLabel ?? defaultChromeFields.acceptanceLabel),
  };
}

export function resolveFormDocumentChrome(
  template: FormDocumentTemplate,
  businessRaw?: Partial<BusinessBrandingSettings> | Record<string, unknown> | null,
): FormDocumentChrome {
  const business = normalizeBusinessBranding(businessRaw);
  const headerColor = template.headerColor?.trim() || business.brandPrimaryColor || "#157fa8";
  const logoUrl = template.logoUrl?.trim() || resolveCompanyLogoUrl(business);
  return {
    logoUrl,
    showLogo: template.showLogo !== false,
    tradingName: business.tradingName || business.companyName,
    address: business.address,
    phone: business.phone,
    contactEmail: business.contactEmail,
    vatNumber: business.vatNumber,
    companyNumber: business.companyNumber,
    brandLine: business.clientPortalBrandLine,
    title: template.title,
    headerNote: template.headerNote || "",
    headerColor,
    showCompanyDetails: template.showCompanyDetails !== false,
    showVatCompanyNumbers: template.showVatCompanyNumbers !== false,
    acceptanceLabel: template.acceptanceLabel || defaultChromeFields.acceptanceLabel,
    intro: template.intro,
    footer: template.footer,
    terms: template.terms,
  };
}

/** Parse #RRGGBB into pdf-lib rgb 0–1 channels. */
export function hexToPdfRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16) / 255,
    g: Number.parseInt(cleaned.slice(2, 4), 16) / 255,
    b: Number.parseInt(cleaned.slice(4, 6), 16) / 255,
  };
}

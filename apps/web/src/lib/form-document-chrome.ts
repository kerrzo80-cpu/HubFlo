import type { BusinessBrandingSettings } from "@/lib/branding";
import { normalizeBusinessBranding } from "@/lib/branding";
import { scrubCompanyRegistrationDisplay } from "@/lib/commercial-safeguards";

export type FormDocumentLayout =
  | "quote"
  | "job-sheet"
  | "application-payment"
  | "invoice"
  | "purchase-order"
  | "daywork-account"
  | "gas-safe-lgsr"
  | "gas-safe-warning-notice"
  | "gas-safe-installation";

/** How commercial lines are laid out on the PDF / email attachment. */
export type FormDocumentPresentation = "description" | "itemised" | "cost-centres";

export const FORM_PRESENTATION_OPTIONS: Array<{
  key: FormDocumentPresentation;
  label: string;
  detail: string;
}> = [
  { key: "description", label: "Description", detail: "One summary description and total." },
  { key: "cost-centres", label: "Cost centres", detail: "One row per cost centre with client wording." },
  { key: "itemised", label: "Itemised", detail: "Line-by-line materials, labour or invoice lines." },
];

export type FormDocumentTemplate = {
  id: string;
  layout: FormDocumentLayout;
  name: string;
  title: string;
  intro: string;
  footer: string;
  terms: string;
  defaultAudience: "Client" | "Engineer" | "Office" | "Supplier";
  /** Preferred line layout for this form variant. */
  presentation: FormDocumentPresentation;
  includeCostCentreBreakdown: boolean;
  includePnl: boolean;
  includeAcceptance: boolean;
  includeBankDetails: boolean;
  /** Cost centre type names this Gas Safe / cert form applies to. */
  linkedCostCentreTypes: string[];
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

export function isGasSafeFormLayout(layout: FormDocumentLayout | string): boolean {
  return (
    layout === "gas-safe-lgsr" ||
    layout === "gas-safe-warning-notice" ||
    layout === "gas-safe-installation"
  );
}

export function defaultPresentationForLayout(
  layout: FormDocumentLayout,
  includeCostCentreBreakdown?: boolean,
): FormDocumentPresentation {
  if (isGasSafeFormLayout(layout) || layout === "daywork-account") return "description";
  if (layout === "purchase-order") return "itemised";
  if (layout === "invoice") return includeCostCentreBreakdown ? "cost-centres" : "itemised";
  if (includeCostCentreBreakdown) return "cost-centres";
  return "description";
}

export function resolveFormPresentation(
  template: Pick<FormDocumentTemplate, "presentation" | "includeCostCentreBreakdown" | "layout">,
): FormDocumentPresentation {
  if (template.presentation === "description" || template.presentation === "itemised" || template.presentation === "cost-centres") {
    return template.presentation;
  }
  return defaultPresentationForLayout(template.layout, template.includeCostCentreBreakdown);
}

export function normalizeFormDocumentTemplate(
  template: Partial<FormDocumentTemplate> & Pick<FormDocumentTemplate, "id" | "layout" | "name" | "title">,
  fallback?: FormDocumentTemplate,
): FormDocumentTemplate {
  const inferredPresentation = defaultPresentationForLayout(
    template.layout,
    typeof template.includeCostCentreBreakdown === "boolean"
      ? template.includeCostCentreBreakdown
      : fallback?.includeCostCentreBreakdown,
  );
  const base = fallback || {
    id: template.id,
    layout: template.layout,
    name: template.name,
    title: template.title,
    intro: "",
    footer: "",
    terms: "",
    defaultAudience: "Client" as const,
    presentation: inferredPresentation,
    includeCostCentreBreakdown: inferredPresentation === "cost-centres",
    includePnl: false,
    includeAcceptance: false,
    includeBankDetails: false,
    linkedCostCentreTypes: [] as string[],
    ...defaultChromeFields,
  };
  const presentation = resolveFormPresentation({
    layout: template.layout ?? base.layout,
    includeCostCentreBreakdown:
      typeof template.includeCostCentreBreakdown === "boolean"
        ? template.includeCostCentreBreakdown
        : base.includeCostCentreBreakdown,
    presentation: (template.presentation as FormDocumentPresentation | undefined) ?? base.presentation,
  });
  const linkedCostCentreTypes = Array.isArray(template.linkedCostCentreTypes)
    ? template.linkedCostCentreTypes.map((item) => String(item).trim()).filter(Boolean)
    : Array.isArray(base.linkedCostCentreTypes)
      ? base.linkedCostCentreTypes
      : [];
  return {
    ...base,
    ...template,
    presentation,
    includeCostCentreBreakdown:
      typeof template.includeCostCentreBreakdown === "boolean"
        ? template.includeCostCentreBreakdown
        : presentation === "cost-centres",
    linkedCostCentreTypes,
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
  const logoUrl = template.logoUrl?.trim() || business.logoUrl || "";
  const registration = scrubCompanyRegistrationDisplay({
    vatNumber: business.vatNumber,
    companyNumber: business.companyNumber,
  });
  return {
    logoUrl,
    showLogo: template.showLogo !== false,
    tradingName: business.tradingName || business.companyName,
    address: business.address,
    phone: business.phone,
    contactEmail: business.contactEmail,
    vatNumber: registration.vatNumber,
    companyNumber: registration.companyNumber,
    brandLine: business.clientPortalBrandLine,
    title: template.title,
    headerNote: template.headerNote || "",
    headerColor,
    showCompanyDetails: template.showCompanyDetails !== false,
    showVatCompanyNumbers: template.showVatCompanyNumbers !== false && registration.showLine,
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

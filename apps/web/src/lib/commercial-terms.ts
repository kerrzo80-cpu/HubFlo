import type { ClientRecord, ClientSite, VatTreatment } from "@/lib/people-seed-data";

export type CommercialTerms = {
  vatTreatment: VatTreatment;
  vatRateOverride: string;
  cis: boolean;
  retentionPercent: number;
  mainContractorDiscountPercent: number;
  /** Which layer supplied each value (for UI hints). */
  sources: {
    vat: "site" | "client" | "default";
    cis: "site" | "client" | "default";
    retention: "site" | "client" | "default";
    discount: "site" | "client" | "default";
  };
};

function parsePercent(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(99.9, parsed));
}

function hasOwn<T extends object>(record: T | null | undefined, key: keyof T) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined && record[key] !== null && record[key] !== "");
}

/**
 * Site overrides client; blank/undefined site fields inherit.
 * CIS uses explicit boolean on site when `cis` key is present (including false).
 */
export function resolveCommercialTerms(
  client?: Pick<ClientRecord, "vatTreatment" | "vatRateOverride" | "cis" | "retentionPercent" | "mainContractorDiscountPercent"> | null,
  site?: Pick<ClientSite, "vatTreatment" | "vatRateOverride" | "cis" | "retentionPercent" | "mainContractorDiscountPercent"> | null,
  defaults?: { vatTreatment?: VatTreatment; vatRate?: string },
): CommercialTerms {
  const defaultVat = defaults?.vatTreatment ?? "Standard 20%";
  const defaultRate = defaults?.vatRate ?? "20";

  const vatFromSite = Boolean(site?.vatTreatment);
  const vatTreatment = (site?.vatTreatment ?? client?.vatTreatment ?? defaultVat) as VatTreatment;
  const vatRateOverride = vatFromSite
    ? String(site?.vatRateOverride ?? "")
    : String(client?.vatRateOverride ?? defaultRate);

  const cisFromSite = site != null && typeof site.cis === "boolean";
  const cisFromClient = client != null && typeof client.cis === "boolean";
  const cis = cisFromSite ? Boolean(site!.cis) : cisFromClient ? Boolean(client!.cis) : false;

  const retentionFromSite = hasOwn(site, "retentionPercent");
  const retentionFromClient = hasOwn(client, "retentionPercent");
  const retentionPercent = retentionFromSite
    ? parsePercent(site!.retentionPercent)
    : retentionFromClient
      ? parsePercent(client!.retentionPercent)
      : 0;

  const discountFromSite = hasOwn(site, "mainContractorDiscountPercent");
  const discountFromClient = hasOwn(client, "mainContractorDiscountPercent");
  const mainContractorDiscountPercent = discountFromSite
    ? parsePercent(site!.mainContractorDiscountPercent)
    : discountFromClient
      ? parsePercent(client!.mainContractorDiscountPercent)
      : 0;

  return {
    vatTreatment,
    vatRateOverride,
    cis,
    retentionPercent,
    mainContractorDiscountPercent,
    sources: {
      vat: vatFromSite ? "site" : client?.vatTreatment ? "client" : "default",
      cis: cisFromSite ? "site" : cisFromClient ? "client" : "default",
      retention: retentionFromSite ? "site" : retentionFromClient ? "client" : "default",
      discount: discountFromSite ? "site" : discountFromClient ? "client" : "default",
    },
  };
}

export function applyMainContractorDiscount(
  chargeTotal: number,
  discountPercent: number,
): { chargeTotal: number; discountAmount: number; discountPercent: number } {
  const pct = Math.max(0, Math.min(99.9, discountPercent));
  const discountAmount = Math.round(chargeTotal * (pct / 100) * 100) / 100;
  return {
    chargeTotal: Math.max(0, Math.round((chargeTotal - discountAmount) * 100) / 100),
    discountAmount,
    discountPercent: pct,
  };
}

export function commercialTermsSummary(terms: CommercialTerms) {
  const bits = [
    terms.vatTreatment,
    terms.cis ? "CIS" : null,
    terms.retentionPercent > 0 ? `Retention ${terms.retentionPercent}%` : null,
    terms.mainContractorDiscountPercent > 0
      ? `Main contractor discount ${terms.mainContractorDiscountPercent}%`
      : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

export type DiscountableLine = {
  id: string;
  description: string;
  category: "Materials" | "Labour" | "Variations" | "Other";
  costToUs: number;
  chargeToClient: number;
  note?: string;
};

/** Append a negative main-contractor discount line when percent &gt; 0. */
export function applyCommercialDiscountToLines<T extends DiscountableLine>(
  lines: T[],
  chargeTotal: number,
  discountPercent: number,
): { lines: T[]; chargeTotal: number; discountAmount: number; discountPercent: number } {
  const applied = applyMainContractorDiscount(chargeTotal, discountPercent);
  if (applied.discountAmount <= 0) {
    return { lines, chargeTotal, discountAmount: 0, discountPercent: 0 };
  }
  const discountLine = {
    id: `inv-mcd-${Date.now()}`,
    description: `Main contractor discount (${applied.discountPercent}%)`,
    category: "Other" as const,
    costToUs: 0,
    chargeToClient: -applied.discountAmount,
    note: "From client/site commercial terms",
  } as T;
  return {
    lines: [...lines, discountLine],
    chargeTotal: applied.chargeTotal,
    discountAmount: applied.discountAmount,
    discountPercent: applied.discountPercent,
  };
}

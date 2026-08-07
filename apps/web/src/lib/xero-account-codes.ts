/**
 * simPRO-style Xero chart mapping: different sales types post to different
 * Xero account codes. Configured under Setup → Finance → Xero.
 */

export type XeroAccountCodes = {
  /** Standard sales / progress claims / invoice in full */
  salesStandard: string;
  /** Optional labour line override (falls back to salesStandard) */
  salesLabour: string;
  /** Optional materials / other line override */
  salesMaterials: string;
  /** Deposit invoices */
  salesDeposit: string;
  /** Retention release invoices */
  salesRetention: string;
  /** Credit notes */
  salesCreditNote: string;
  /** CIS / construction reverse-charge style sales (when invoice flagged CIS) */
  salesCis: string;
  /** Supplier bill expense account */
  purchaseBill: string;
  /** Bank / clearing account used when posting payments */
  paymentBank: string;
};

export const DEFAULT_XERO_ACCOUNT_CODES: XeroAccountCodes = {
  salesStandard: "200",
  salesLabour: "",
  salesMaterials: "",
  salesDeposit: "",
  salesRetention: "",
  salesCreditNote: "",
  salesCis: "",
  purchaseBill: "310",
  paymentBank: "",
};

export type XeroSalesClaimType =
  | "deposit"
  | "valuation"
  | "progress-claim"
  | "retention-release"
  | "credit-note"
  | "full"
  | string
  | undefined;

function cleanCode(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function normalizeXeroAccountCodes(input?: Partial<XeroAccountCodes> | null): XeroAccountCodes {
  const raw = input && typeof input === "object" ? input : {};
  return {
    salesStandard: cleanCode(raw.salesStandard, DEFAULT_XERO_ACCOUNT_CODES.salesStandard),
    salesLabour: cleanCode(raw.salesLabour),
    salesMaterials: cleanCode(raw.salesMaterials),
    salesDeposit: cleanCode(raw.salesDeposit),
    salesRetention: cleanCode(raw.salesRetention),
    salesCreditNote: cleanCode(raw.salesCreditNote),
    salesCis: cleanCode(raw.salesCis),
    purchaseBill: cleanCode(raw.purchaseBill, DEFAULT_XERO_ACCOUNT_CODES.purchaseBill),
    paymentBank: cleanCode(raw.paymentBank),
  };
}

/** Resolve financeSettings blob (hub or Core) into account codes. */
export function xeroAccountCodesFromFinanceSettings(financeSettings: unknown): XeroAccountCodes {
  const settings =
    financeSettings && typeof financeSettings === "object"
      ? (financeSettings as Record<string, unknown>)
      : {};
  const nested = normalizeXeroAccountCodes(
    settings.xeroAccountCodes && typeof settings.xeroAccountCodes === "object"
      ? (settings.xeroAccountCodes as Partial<XeroAccountCodes>)
      : null,
  );
  // Back-compat: lone payment bank field used by SumUp → Xero push.
  if (!nested.paymentBank) {
    nested.paymentBank = cleanCode(settings.xeroPaymentAccountCode);
  }
  return nested;
}

export function resolveSalesAccountCode(options: {
  codes?: Partial<XeroAccountCodes> | null;
  claimType?: XeroSalesClaimType;
  lineCategory?: string;
  cis?: boolean;
}) {
  const codes = normalizeXeroAccountCodes(options.codes);
  if (options.cis && codes.salesCis) return codes.salesCis;
  if (options.claimType === "credit-note" && codes.salesCreditNote) return codes.salesCreditNote;
  if (options.claimType === "retention-release" && codes.salesRetention) return codes.salesRetention;
  if (options.claimType === "deposit" && codes.salesDeposit) return codes.salesDeposit;

  const category = String(options.lineCategory || "").toLowerCase();
  if (category === "labour" && codes.salesLabour) return codes.salesLabour;
  if ((category === "materials" || category === "material" || category === "other") && codes.salesMaterials) {
    return codes.salesMaterials;
  }
  return codes.salesStandard || DEFAULT_XERO_ACCOUNT_CODES.salesStandard;
}

export function resolvePurchaseAccountCode(codes?: Partial<XeroAccountCodes> | null) {
  return normalizeXeroAccountCodes(codes).purchaseBill || DEFAULT_XERO_ACCOUNT_CODES.purchaseBill;
}

/**
 * Map NeXa VAT treatment → Xero TaxType.
 * Prefers Setup → Tax codes when provided; otherwise sensible UK defaults.
 */
export function resolveSalesTaxType(options: {
  vatRate?: number;
  vatTreatment?: string;
  setupTaxCodes?: Array<{ name?: string; code?: string; rate?: number; xeroTaxType?: string; archived?: boolean }>;
}) {
  const treatment = String(options.vatTreatment || "").toLowerCase();
  const setup = (options.setupTaxCodes || []).filter((row) => !row.archived);

  const byName = (needle: string) =>
    setup.find((row) => String(row.name || "").toLowerCase().includes(needle))?.xeroTaxType?.trim();

  if (treatment.includes("reverse")) {
    return byName("reverse") || byName("drc") || "RRCOUTPUT";
  }
  if (treatment.includes("zero")) {
    return byName("zero") || "NONE";
  }
  if (treatment.includes("custom")) {
    const rate = Number(options.vatRate) || 0;
    const byRate = setup.find((row) => Number(row.rate) === rate)?.xeroTaxType?.trim();
    if (byRate) return byRate;
  }

  const rate = Number(options.vatRate) || 0;
  if (rate <= 0) return byName("zero") || "NONE";
  return byName("standard") || "OUTPUT2";
}

export const XERO_ACCOUNT_CODE_FIELDS: Array<{
  key: keyof XeroAccountCodes;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    key: "salesStandard",
    label: "Standard sales",
    hint: "Invoice in full and progress claims",
    placeholder: "200",
  },
  {
    key: "salesLabour",
    label: "Labour sales",
    hint: "Optional — labour lines only; blank uses Standard",
    placeholder: "Same as standard",
  },
  {
    key: "salesMaterials",
    label: "Materials / other sales",
    hint: "Optional — materials & other lines; blank uses Standard",
    placeholder: "Same as standard",
  },
  {
    key: "salesDeposit",
    label: "Deposits",
    hint: "Deposit invoices",
    placeholder: "Same as standard",
  },
  {
    key: "salesRetention",
    label: "Retention release",
    hint: "Retention release invoices",
    placeholder: "Same as standard",
  },
  {
    key: "salesCreditNote",
    label: "Credit notes",
    hint: "Customer credit notes",
    placeholder: "Same as standard",
  },
  {
    key: "salesCis",
    label: "CIS sales",
    hint: "When an invoice is marked CIS",
    placeholder: "Leave blank until CIS is used",
  },
  {
    key: "purchaseBill",
    label: "Purchase bills",
    hint: "Supplier / PO bills",
    placeholder: "310",
  },
  {
    key: "paymentBank",
    label: "Payment bank / clearing",
    hint: "Account used when posting SumUp or recorded payments into Xero",
    placeholder: "Auto-pick bank if blank",
  },
];

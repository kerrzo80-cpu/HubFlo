/**
 * simPRO-style Xero chart mapping: different sales types post to different
 * Xero account codes. Configured under Setup → Finance → Xero.
 */

import {
  normalizeXeroDefaultAccounts,
  normalizeXeroTaxCodeMappings,
  resolveCostCentrePurchaseAccount,
  resolveCostCentreSalesAccount,
  type XeroCostCentreMapping,
  type XeroDefaultAccountKey,
  type XeroMappedSlot,
  type XeroTaxCodeMapping,
} from "@/lib/xero-mapping";

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
  /** Contractor / subcontractor bills */
  contractorInvoice: string;
  /** Postage / freight overhead */
  freight: string;
  /** CIS tax suffered (screenshot: 825 CIS Liability) */
  cisTaxSuffered: string;
  /** CIS liability (screenshot: 826 CIS Asset) */
  cisLiability: string;
};

export const DEFAULT_XERO_ACCOUNT_CODES: XeroAccountCodes = {
  salesStandard: "200",
  salesLabour: "",
  salesMaterials: "",
  salesDeposit: "",
  salesRetention: "502",
  salesCreditNote: "",
  salesCis: "",
  purchaseBill: "310",
  paymentBank: "",
  contractorInvoice: "312",
  freight: "433",
  cisTaxSuffered: "825",
  cisLiability: "826",
};

export type { XeroCostCentreMapping, XeroDefaultAccountKey, XeroMappedSlot, XeroTaxCodeMapping };

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
    salesRetention: cleanCode(raw.salesRetention, DEFAULT_XERO_ACCOUNT_CODES.salesRetention),
    salesCreditNote: cleanCode(raw.salesCreditNote),
    salesCis: cleanCode(raw.salesCis),
    purchaseBill: cleanCode(raw.purchaseBill, DEFAULT_XERO_ACCOUNT_CODES.purchaseBill),
    paymentBank: cleanCode(raw.paymentBank),
    contractorInvoice: cleanCode(raw.contractorInvoice, DEFAULT_XERO_ACCOUNT_CODES.contractorInvoice),
    freight: cleanCode(raw.freight, DEFAULT_XERO_ACCOUNT_CODES.freight),
    cisTaxSuffered: cleanCode(raw.cisTaxSuffered, DEFAULT_XERO_ACCOUNT_CODES.cisTaxSuffered),
    cisLiability: cleanCode(raw.cisLiability, DEFAULT_XERO_ACCOUNT_CODES.cisLiability),
  };
}

export function xeroAccountCodesFromDefaultAccounts(
  defaults?: Partial<Record<XeroDefaultAccountKey, Partial<XeroMappedSlot>>> | null,
): Partial<XeroAccountCodes> {
  const mapped = normalizeXeroDefaultAccounts(defaults);
  return {
    salesStandard: mapped.income.accountCode || DEFAULT_XERO_ACCOUNT_CODES.salesStandard,
    salesDeposit: mapped.deposit.accountCode,
    salesRetention: mapped.retentionAsset.accountCode || DEFAULT_XERO_ACCOUNT_CODES.salesRetention,
    purchaseBill: mapped.expense.accountCode || DEFAULT_XERO_ACCOUNT_CODES.purchaseBill,
    paymentBank: mapped.deposit.accountCode,
    contractorInvoice: mapped.contractorInvoice.accountCode,
    freight: mapped.freight.accountCode,
    cisTaxSuffered: mapped.cisTaxSuffered.accountCode,
    cisLiability: mapped.cisLiability.accountCode,
  };
}

/** Resolve financeSettings blob (hub or Core) into account codes. */
export function xeroAccountCodesFromFinanceSettings(financeSettings: unknown): XeroAccountCodes {
  const settings =
    financeSettings && typeof financeSettings === "object"
      ? (financeSettings as Record<string, unknown>)
      : {};
  const nested = normalizeXeroAccountCodes({
    ...(settings.xeroDefaultAccounts && typeof settings.xeroDefaultAccounts === "object"
      ? xeroAccountCodesFromDefaultAccounts(
          settings.xeroDefaultAccounts as Partial<Record<XeroDefaultAccountKey, Partial<XeroMappedSlot>>>,
        )
      : {}),
    ...(settings.xeroAccountCodes && typeof settings.xeroAccountCodes === "object"
      ? (settings.xeroAccountCodes as Partial<XeroAccountCodes>)
      : {}),
  });
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
  costCentre?: string;
  costCentreMappings?: XeroCostCentreMapping[] | null;
}) {
  const codes = normalizeXeroAccountCodes(options.codes);
  if (options.cis && codes.salesCis) return codes.salesCis;
  if (options.claimType === "credit-note" && codes.salesCreditNote) return codes.salesCreditNote;
  if (options.claimType === "retention-release" && codes.salesRetention) return codes.salesRetention;
  if (options.claimType === "deposit" && (codes.salesDeposit || codes.paymentBank)) {
    return codes.salesDeposit || codes.paymentBank;
  }
  const fromCostCentre = resolveCostCentreSalesAccount({
    mappings: options.costCentreMappings,
    costCentre: options.costCentre,
    fallbackCode: "",
  });
  if (fromCostCentre) return fromCostCentre;

  const category = String(options.lineCategory || "").toLowerCase();
  if (category === "labour" && codes.salesLabour) return codes.salesLabour;
  if ((category === "materials" || category === "material" || category === "other") && codes.salesMaterials) {
    return codes.salesMaterials;
  }
  return codes.salesStandard || DEFAULT_XERO_ACCOUNT_CODES.salesStandard;
}

export function resolvePurchaseAccountCode(
  codes?: Partial<XeroAccountCodes> | null,
  options?: { costCentre?: string; costCentreMappings?: XeroCostCentreMapping[] | null; contractor?: boolean },
) {
  const nested = normalizeXeroAccountCodes(codes);
  if (options?.contractor && nested.contractorInvoice) return nested.contractorInvoice;
  const fromCostCentre = resolveCostCentrePurchaseAccount({
    mappings: options?.costCentreMappings,
    costCentre: options?.costCentre,
    fallbackCode: "",
  });
  if (fromCostCentre) return fromCostCentre;
  return nested.purchaseBill || DEFAULT_XERO_ACCOUNT_CODES.purchaseBill;
}

/**
 * Map NeXa VAT treatment → Xero TaxType.
 * Prefers Setup → Tax codes when provided; otherwise sensible UK defaults.
 */
export function resolveSalesTaxType(options: {
  vatRate?: number;
  vatTreatment?: string;
  setupTaxCodes?: Array<{
    name?: string;
    code?: string;
    rate?: number;
    xeroTaxType?: string;
    xeroTaxTypeIncome?: string;
    archived?: boolean;
  }>;
  taxCodeMappings?: XeroTaxCodeMapping[] | null;
}) {
  const treatment = String(options.vatTreatment || "").toLowerCase();
  const setup = (options.setupTaxCodes || []).filter((row) => !row.archived);
  const mapped = normalizeXeroTaxCodeMappings(options.taxCodeMappings);

  const mappedType = (needle: string) =>
    mapped.find((row) => row.code.toLowerCase() === needle || row.name.toLowerCase().includes(needle))
      ?.incomeTaxType;

  const byName = (needle: string) =>
    setup.find((row) => String(row.name || "").toLowerCase().includes(needle) || String(row.code || "").toLowerCase() === needle)
      ?.xeroTaxTypeIncome?.trim() ||
    setup.find((row) => String(row.name || "").toLowerCase().includes(needle) || String(row.code || "").toLowerCase() === needle)
      ?.xeroTaxType?.trim();

  if (treatment.includes("reverse") || treatment === "drc") {
    return byName("reverse") || byName("drc") || mappedType("drc") || "RRCOUTPUT";
  }
  if (treatment.includes("zero") || treatment === "exc") {
    return byName("zero") || byName("exc") || mappedType("exc") || "ZERORATEDOUTPUT";
  }
  if (treatment.includes("custom")) {
    const rate = Number(options.vatRate) || 0;
    const byRate = setup.find((row) => Number(row.rate) === rate)?.xeroTaxType?.trim();
    if (byRate) return byRate;
  }

  const rate = Number(options.vatRate) || 0;
  if (rate <= 0) return byName("zero") || mappedType("exc") || "ZERORATEDOUTPUT";
  return byName("standard") || byName("vat") || mappedType("vat") || "OUTPUT2";
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
    hint: "Retention release invoices (simPRO 502 Retentions)",
    placeholder: "502",
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
    hint: "Supplier / PO bills (simPRO 310 COGS)",
    placeholder: "310",
  },
  {
    key: "contractorInvoice",
    label: "Contractor invoices",
    hint: "Subcontractor bills (simPRO 312)",
    placeholder: "312",
  },
  {
    key: "freight",
    label: "Freight",
    hint: "Postage, freight & courier (simPRO 433)",
    placeholder: "433",
  },
  {
    key: "cisTaxSuffered",
    label: "CIS tax suffered",
    hint: "simPRO 825 CIS Liability",
    placeholder: "825",
  },
  {
    key: "cisLiability",
    label: "CIS liability",
    hint: "simPRO 826 CIS Asset",
    placeholder: "826",
  },
  {
    key: "paymentBank",
    label: "Payment bank / clearing",
    hint: "Petty Cash / bank used for deposits and posted payments",
    placeholder: "Petty Cash if blank",
  },
];

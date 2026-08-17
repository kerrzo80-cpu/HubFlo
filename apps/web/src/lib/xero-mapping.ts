/**
 * simPRO-style Xero mapping seeded from the office Xero setup
 * (Defaults / Cost centres / Tax codes). Codes are the intended chart
 * values; after Connect, Finance → Xero lets office pick from the live
 * Xero accounts and tax types.
 */

export type XeroMappedSlot = {
  accountCode: string;
  accountName: string;
  taxType: string;
};

export type XeroDefaultAccountKey =
  | "income"
  | "deposit"
  | "expense"
  | "contractorInvoice"
  | "retentionAsset"
  | "retentionLiability"
  | "financeCharge"
  | "freight"
  | "restockingFee"
  | "cisTaxSuffered"
  | "cisLiability";

export type XeroCostCentreMapping = {
  costCentre: string;
  incomeAccountCode: string;
  incomeAccountName: string;
  incomeTaxType: string;
  expenseAccountCode: string;
  expenseAccountName: string;
  expenseTaxType: string;
};

export type XeroTaxCodeMapping = {
  code: string;
  name: string;
  rate: number;
  incomeTaxType: string;
  incomeTaxName: string;
  expenseTaxType: string;
  expenseTaxName: string;
};

export type XeroChartAccount = {
  code: string;
  name: string;
  type: string;
  taxType: string;
  status: string;
};

export type XeroChartTaxRate = {
  taxType: string;
  name: string;
  canApplyToRevenue: boolean;
  canApplyToExpenses: boolean;
  status: string;
};

const PETTY: XeroMappedSlot = { accountCode: "", accountName: "Petty Cash", taxType: "NONE" };

export const SEEDED_XERO_DEFAULT_ACCOUNTS: Record<XeroDefaultAccountKey, XeroMappedSlot> = {
  income: { accountCode: "200", accountName: "Sales", taxType: "OUTPUT2" },
  deposit: { ...PETTY },
  expense: { accountCode: "310", accountName: "Cost of Goods Sold", taxType: "INPUT2" },
  contractorInvoice: { accountCode: "312", accountName: "Sub-Contractors", taxType: "INPUT2" },
  retentionAsset: { accountCode: "502", accountName: "Retentions", taxType: "NONE" },
  retentionLiability: { ...PETTY },
  financeCharge: { ...PETTY },
  freight: { accountCode: "433", accountName: "Postage, Freight & Courier", taxType: "EXEMPTINPUT" },
  restockingFee: { ...PETTY },
  cisTaxSuffered: { accountCode: "825", accountName: "CIS Liability", taxType: "NONE" },
  cisLiability: { accountCode: "826", accountName: "CIS Asset", taxType: "NONE" },
};

export const XERO_DEFAULT_ACCOUNT_FIELDS: Array<{
  key: XeroDefaultAccountKey;
  label: string;
}> = [
  { key: "income", label: "Income" },
  { key: "deposit", label: "Deposit" },
  { key: "expense", label: "Expense" },
  { key: "contractorInvoice", label: "Contractor invoice" },
  { key: "retentionAsset", label: "Retention asset" },
  { key: "retentionLiability", label: "Retention liability" },
  { key: "financeCharge", label: "Finance charge" },
  { key: "freight", label: "Freight" },
  { key: "restockingFee", label: "Restocking fee" },
  { key: "cisTaxSuffered", label: "CIS tax suffered" },
  { key: "cisLiability", label: "CIS liability" },
];

const STANDARD_INCOME: Pick<XeroCostCentreMapping, "incomeAccountCode" | "incomeAccountName" | "incomeTaxType"> = {
  incomeAccountCode: "200",
  incomeAccountName: "Sales",
  incomeTaxType: "OUTPUT2",
};

const STANDARD_EXPENSE: Pick<XeroCostCentreMapping, "expenseAccountCode" | "expenseAccountName" | "expenseTaxType"> = {
  expenseAccountCode: "310",
  expenseAccountName: "Cost of Goods Sold",
  expenseTaxType: "INPUT2",
};

/** Exact cost-centre names from the simPRO Xero mapping screenshots. */
export const SEEDED_XERO_COST_CENTRE_NAMES = [
  "Bathrooms",
  "Boiler servicing",
  "Electrical",
  "General Plumbing",
  "Heating",
  "Job Survey",
  "Joinery",
  "Letting agents",
  "New builds",
  "Painting & Decorating",
  "Membership",
] as const;

export const SEEDED_XERO_TAX_CODE_MAPPINGS: XeroTaxCodeMapping[] = [
  {
    code: "VAT",
    name: "VAT 20%",
    rate: 20,
    incomeTaxType: "OUTPUT2",
    incomeTaxName: "20% (VAT on Income)",
    expenseTaxType: "INPUT2",
    expenseTaxName: "20% (VAT on Expenses)",
  },
  {
    code: "EXC",
    name: "Zero rated",
    rate: 0,
    incomeTaxType: "ZERORATEDOUTPUT",
    incomeTaxName: "Zero Rated Income",
    expenseTaxType: "ZERORATEDINPUT",
    expenseTaxName: "Zero Rated Expense",
  },
  {
    code: "DRC",
    name: "Domestic reverse charge",
    rate: 0,
    incomeTaxType: "RRCOUTPUT",
    incomeTaxName: "Domestic Reverse Charge @ 20% (VAT on Income)",
    expenseTaxType: "RRCINPUT",
    expenseTaxName: "Domestic Reverse Charge @ 20% (VAT on Expenses)",
  },
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function slot(raw: Partial<XeroMappedSlot> | undefined, seed: XeroMappedSlot): XeroMappedSlot {
  return {
    accountCode: raw && "accountCode" in raw ? clean(raw.accountCode) : seed.accountCode,
    accountName: clean(raw?.accountName) || seed.accountName,
    taxType: clean(raw?.taxType) || seed.taxType,
  };
}

export function normalizeXeroDefaultAccounts(
  input?: Partial<Record<XeroDefaultAccountKey, Partial<XeroMappedSlot>>> | null,
): Record<XeroDefaultAccountKey, XeroMappedSlot> {
  const raw = input && typeof input === "object" ? input : {};
  const next = {} as Record<XeroDefaultAccountKey, XeroMappedSlot>;
  for (const field of XERO_DEFAULT_ACCOUNT_FIELDS) {
    next[field.key] = slot(raw[field.key], SEEDED_XERO_DEFAULT_ACCOUNTS[field.key]);
  }
  return next;
}

function standardCostCentreRow(name: string): XeroCostCentreMapping {
  const membership = name.trim().toLowerCase() === "membership";
  if (membership) {
    return {
      costCentre: name,
      incomeAccountCode: "",
      incomeAccountName: "Petty Cash",
      incomeTaxType: "NONE",
      expenseAccountCode: "",
      expenseAccountName: "Petty Cash",
      expenseTaxType: "NONE",
    };
  }
  return {
    costCentre: name,
    ...STANDARD_INCOME,
    ...STANDARD_EXPENSE,
  };
}

export function mergeXeroCostCentreMappings(
  stored?: XeroCostCentreMapping[] | null,
  extraNames: string[] = [],
): XeroCostCentreMapping[] {
  const byName = new Map<string, XeroCostCentreMapping>();
  for (const name of SEEDED_XERO_COST_CENTRE_NAMES) {
    byName.set(name.toLowerCase(), standardCostCentreRow(name));
  }
  for (const name of extraNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!byName.has(key)) byName.set(key, standardCostCentreRow(trimmed));
  }
  for (const row of stored || []) {
    const name = clean(row.costCentre);
    if (!name) continue;
    const seed = byName.get(name.toLowerCase()) || standardCostCentreRow(name);
    byName.set(name.toLowerCase(), {
      costCentre: name,
      incomeAccountCode: row.incomeAccountCode !== undefined ? clean(row.incomeAccountCode) : seed.incomeAccountCode,
      incomeAccountName: clean(row.incomeAccountName) || seed.incomeAccountName,
      incomeTaxType: clean(row.incomeTaxType) || seed.incomeTaxType,
      expenseAccountCode: row.expenseAccountCode !== undefined ? clean(row.expenseAccountCode) : seed.expenseAccountCode,
      expenseAccountName: clean(row.expenseAccountName) || seed.expenseAccountName,
      expenseTaxType: clean(row.expenseTaxType) || seed.expenseTaxType,
    });
  }
  return [...byName.values()].sort((left, right) => left.costCentre.localeCompare(right.costCentre));
}

export function normalizeXeroTaxCodeMappings(stored?: XeroTaxCodeMapping[] | null): XeroTaxCodeMapping[] {
  const byCode = new Map<string, XeroTaxCodeMapping>();
  for (const seed of SEEDED_XERO_TAX_CODE_MAPPINGS) {
    byCode.set(seed.code.toUpperCase(), { ...seed });
  }
  for (const row of stored || []) {
    const code = clean(row.code).toUpperCase();
    if (!code) continue;
    const seed = byCode.get(code) || SEEDED_XERO_TAX_CODE_MAPPINGS[0];
    byCode.set(code, {
      code,
      name: clean(row.name) || seed.name,
      rate: Number.isFinite(Number(row.rate)) ? Number(row.rate) : seed.rate,
      incomeTaxType: clean(row.incomeTaxType) || seed.incomeTaxType,
      incomeTaxName: clean(row.incomeTaxName) || seed.incomeTaxName,
      expenseTaxType: clean(row.expenseTaxType) || seed.expenseTaxType,
      expenseTaxName: clean(row.expenseTaxName) || seed.expenseTaxName,
    });
  }
  const order = SEEDED_XERO_TAX_CODE_MAPPINGS.map((row) => row.code);
  return [...byCode.values()].sort((left, right) => {
    const leftRank = order.indexOf(left.code);
    const rightRank = order.indexOf(right.code);
    if (leftRank >= 0 || rightRank >= 0) {
      return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
    }
    return left.code.localeCompare(right.code);
  });
}

export function matchXeroAccount(
  slot: { accountCode?: string; accountName?: string },
  accounts: XeroChartAccount[],
) {
  const code = clean(slot.accountCode).toLowerCase();
  const name = clean(slot.accountName).toLowerCase();
  if (code) {
    const byCode = accounts.find((row) => row.code.toLowerCase() === code);
    if (byCode) return byCode;
  }
  if (name) {
    const byName = accounts.find((row) => row.name.toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
}

export function matchXeroTaxRate(
  slot: { taxType?: string; taxName?: string },
  rates: XeroChartTaxRate[],
) {
  const taxType = clean(slot.taxType).toLowerCase();
  const taxName = clean(slot.taxName).toLowerCase();
  if (taxType) {
    const byType = rates.find((row) => row.taxType.toLowerCase() === taxType);
    if (byType) return byType;
  }
  if (taxName) {
    const byName = rates.find((row) => row.name.toLowerCase() === taxName);
    if (byName) return byName;
    const includes = rates.find((row) => row.name.toLowerCase().includes(taxName) || taxName.includes(row.name.toLowerCase()));
    if (includes) return includes;
  }
  return null;
}

export function resolveCostCentreSalesAccount(options: {
  mappings?: XeroCostCentreMapping[] | null;
  costCentre?: string;
  fallbackCode?: string;
}) {
  const name = clean(options.costCentre).toLowerCase();
  if (name) {
    const row = (options.mappings || []).find((item) => item.costCentre.trim().toLowerCase() === name);
    if (row?.incomeAccountCode) return row.incomeAccountCode;
  }
  return clean(options.fallbackCode);
}

export function resolveCostCentrePurchaseAccount(options: {
  mappings?: XeroCostCentreMapping[] | null;
  costCentre?: string;
  fallbackCode?: string;
}) {
  const name = clean(options.costCentre).toLowerCase();
  if (name) {
    const row = (options.mappings || []).find((item) => item.costCentre.trim().toLowerCase() === name);
    if (row?.expenseAccountCode) return row.expenseAccountCode;
  }
  return clean(options.fallbackCode);
}

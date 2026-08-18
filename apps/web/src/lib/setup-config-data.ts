import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type SetupStatusBucket = "lead" | "quote" | "job" | "invoice";

export type SetupStatusOption = {
  id: string;
  bucket: SetupStatusBucket;
  label: string;
  archived?: boolean;
};

export type SetupLostReason = {
  id: string;
  label: string;
  archived?: boolean;
};

export type SetupTaxCode = {
  id: string;
  code: string;
  name: string;
  rate: number;
  xeroTaxType?: string;
  xeroTaxTypeIncome?: string;
  xeroTaxTypeExpense?: string;
  archived?: boolean;
};

export type SetupEmailTemplate = {
  id: string;
  key: "quote" | "invoice" | "invoice-overdue" | "statement" | "remittance" | "po" | "follow-up" | "job-confirmation" | "job-eta" | "job-complete";
  name: string;
  subject: string;
  body: string;
  archived?: boolean;
};

export type SetupAssetType = {
  id: string;
  name: string;
  serviceIntervalMonths: number;
  certificateRequired: boolean;
  archived?: boolean;
};

export type SetupSecurityGroup = {
  id: string;
  name: string;
  role: string;
  permissions: Record<string, boolean>;
  archived?: boolean;
};

type SetupConfigStore = {
  statuses: SetupStatusOption[];
  lostReasons: SetupLostReason[];
  taxCodes: SetupTaxCode[];
  emailTemplates: SetupEmailTemplate[];
  assetTypes: SetupAssetType[];
  securityGroups: SetupSecurityGroup[];
};

const STORE = "nexa-setup-config-v1";

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

const defaults: SetupConfigStore = {
  statuses: [
    { id: "st-lead-new", bucket: "lead", label: "Needs scheduling" },
    { id: "st-lead-survey", bucket: "lead", label: "Survey booked" },
    { id: "st-lead-quoted", bucket: "lead", label: "Quoted" },
    { id: "st-lead-lost", bucket: "lead", label: "Lost" },
    { id: "st-quote-draft", bucket: "quote", label: "Draft" },
    { id: "st-quote-sent", bucket: "quote", label: "Sent" },
    { id: "st-quote-accepted", bucket: "quote", label: "Accepted" },
    { id: "st-quote-declined", bucket: "quote", label: "Declined" },
    { id: "st-job-progress", bucket: "job", label: "In progress" },
    { id: "st-job-complete", bucket: "job", label: "Completed" },
    { id: "st-job-ready", bucket: "job", label: "Ready to invoice" },
    { id: "st-job-invoiced", bucket: "job", label: "Invoiced" },
    { id: "st-inv-draft", bucket: "invoice", label: "Draft" },
    { id: "st-inv-sent", bucket: "invoice", label: "Sent" },
    { id: "st-inv-paid", bucket: "invoice", label: "Paid" },
  ],
  lostReasons: [
    { id: "lost-price", label: "Price" },
    { id: "lost-timing", label: "Timing / availability" },
    { id: "lost-scope", label: "Scope change" },
    { id: "lost-competitor", label: "Went elsewhere" },
    { id: "lost-no-response", label: "No response" },
  ],
  taxCodes: [
    { id: "tax-std", code: "OUTPUT2", name: "Standard 20%", rate: 20, xeroTaxType: "OUTPUT2", xeroTaxTypeIncome: "OUTPUT2", xeroTaxTypeExpense: "INPUT2" },
    { id: "tax-vat", code: "VAT", name: "VAT 20%", rate: 20, xeroTaxType: "OUTPUT2", xeroTaxTypeIncome: "OUTPUT2", xeroTaxTypeExpense: "INPUT2" },
    { id: "tax-zero", code: "NONE", name: "Zero rated", rate: 0, xeroTaxType: "ZERORATEDOUTPUT", xeroTaxTypeIncome: "ZERORATEDOUTPUT", xeroTaxTypeExpense: "ZERORATEDINPUT" },
    { id: "tax-exc", code: "EXC", name: "Zero rated", rate: 0, xeroTaxType: "ZERORATEDOUTPUT", xeroTaxTypeIncome: "ZERORATEDOUTPUT", xeroTaxTypeExpense: "ZERORATEDINPUT" },
    { id: "tax-drc", code: "RRCOUT", name: "Domestic reverse charge", rate: 0, xeroTaxType: "RRCOUTPUT", xeroTaxTypeIncome: "RRCOUTPUT", xeroTaxTypeExpense: "RRCINPUT" },
    { id: "tax-code-drc", code: "DRC", name: "Domestic reverse charge", rate: 0, xeroTaxType: "RRCOUTPUT", xeroTaxTypeIncome: "RRCOUTPUT", xeroTaxTypeExpense: "RRCINPUT" },
  ],
  emailTemplates: [
    {
      id: "em-quote",
      key: "quote",
      name: "Quote send",
      subject: "Your quotation {{ref}} from {{company}}",
      body: "Hi {{contact}},\n\nPlease find quotation {{ref}} for {{description}}.\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-invoice",
      key: "invoice",
      name: "Invoice send",
      subject: "Invoice {{ref}} from {{company}}",
      body: "Hi {{contact}},\n\nPlease find invoice {{ref}}.\nAmount due: {{total}}.\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-invoice-overdue",
      key: "invoice-overdue",
      name: "Invoice overdue chase",
      subject: "Payment reminder · {{ref}} · {{daysOverdue}} days overdue",
      body: "Hi {{contact}},\n\nOur records show invoice {{ref}} is {{daysOverdue}} days overdue (due {{dueDate}}).\n\nOutstanding balance: {{outstanding}}.\nOriginal total: {{total}}.\nPaid to date: {{paid}}.\n\nPlease arrange payment or let us know if there is a query.\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-statement",
      key: "statement",
      name: "Customer statement",
      subject: "Account statement from {{company}} · {{date}}",
      body: "Hi {{contact}},\n\nPlease find your outstanding account statement as at {{date}}.\n\nTotal outstanding: {{outstanding}}.\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-remittance",
      key: "remittance",
      name: "Payment remittance advice",
      subject: "Remittance advice · {{ref}} · {{paymentAmount}}",
      body: "Hi {{contact}},\n\nThank you. We have allocated the following payment against invoice {{ref}}.\n\nPayment date: {{paymentDate}}\nAmount received: {{paymentAmount}}\nMethod: {{paymentMethod}}\nReference: {{paymentReference}}\n\nPaid to date: {{paid}}\nOutstanding balance: {{outstanding}}\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-po",
      key: "po",
      name: "Purchase order send",
      subject: "Purchase order {{ref}}",
      body: "Hi,\n\nPlease supply against purchase order {{ref}}.\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-follow",
      key: "follow-up",
      name: "Quote follow-up",
      subject: "Following up on quotation {{ref}}",
      body: "Hi {{contact}},\n\nJust checking you received quotation {{ref}}. Happy to adjust scope if needed.\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-job",
      key: "job-confirmation",
      name: "Job confirmation",
      subject: "Job {{ref}} confirmed · {{date}} {{time}}",
      body: "Hi {{contact}},\n\nWe have booked job {{ref}} for {{date}} at {{time}}.\n\nEngineer: {{engineer}}\nSite: {{site}}\nScope: {{description}}\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-job-eta",
      key: "job-eta",
      name: "Job ETA / on the way",
      subject: "On the way · {{ref}} · ETA {{eta}}",
      body: "Hi {{contact}},\n\nOur engineer {{engineer}} is on the way for job {{ref}}.\n\nETA: about {{eta}}.\nSite: {{site}}\n\nKind regards,\n{{company}}",
    },
    {
      id: "em-job-complete",
      key: "job-complete",
      name: "Job complete / work finished",
      subject: "Work complete · {{ref}}",
      body: "Hi {{contact}},\n\nOur engineer has finished work on job {{ref}}.\n\nSite: {{site}}\nScope: {{description}}\n\nKind regards,\n{{company}}",
    },
  ],
  assetTypes: [
    { id: "at-gas", name: "Gas appliance", serviceIntervalMonths: 12, certificateRequired: true },
    { id: "at-oil", name: "Oil Boiler", serviceIntervalMonths: 12, certificateRequired: true },
    { id: "at-pipe", name: "Pipework", serviceIntervalMonths: 24, certificateRequired: false },
    { id: "at-cyl", name: "Cylinder", serviceIntervalMonths: 24, certificateRequired: false },
    { id: "at-ctrl", name: "Controls", serviceIntervalMonths: 12, certificateRequired: false },
    { id: "at-other", name: "Other", serviceIntervalMonths: 12, certificateRequired: false },
  ],
  securityGroups: [
    {
      id: "sg-owner",
      name: "Owner / Admin",
      role: "Owner/Admin",
      permissions: {
        showCore: true,
        showField: true,
        showSurveyor: true,
        showTakeoff: true,
        showCustomers: true,
        showJobs: true,
        showQuotes: true,
        showAssets: true,
        showStock: true,
        showFinance: true,
        showSchedule: true,
        canCreateJob: true,
        canCreateQuote: true,
        canCreateLead: true,
        canEditJobs: true,
        canDeleteJobs: true,
        canRequestPurchase: true,
        canApprovePurchase: true,
        canCustomize: true,
        canEditInvoice: true,
      },
    },
    {
      id: "sg-manager",
      name: "Manager",
      role: "Manager",
      permissions: {
        showCore: true,
        showField: true,
        showSurveyor: true,
        showTakeoff: true,
        showCustomers: true,
        showJobs: true,
        showQuotes: true,
        showAssets: true,
        showStock: true,
        showFinance: true,
        showSchedule: true,
        canCreateJob: true,
        canCreateQuote: true,
        canCreateLead: true,
        canEditJobs: true,
        canDeleteJobs: false,
        canRequestPurchase: true,
        canApprovePurchase: true,
        canCustomize: true,
        canEditInvoice: true,
      },
    },
    {
      id: "sg-engineer",
      name: "Engineer (Field only)",
      role: "Engineer",
      permissions: {
        showCore: false,
        showField: true,
        showSurveyor: false,
        showTakeoff: false,
        showCustomers: false,
        showJobs: false,
        showQuotes: false,
        showAssets: false,
        showStock: false,
        showFinance: false,
        showSchedule: false,
        canCreateJob: false,
        canCreateQuote: false,
        canCreateLead: false,
        canEditJobs: false,
        canDeleteJobs: false,
        canRequestPurchase: false,
        canApprovePurchase: false,
        canCustomize: false,
        canEditInvoice: false,
      },
    },
  ],
};

function ensureSeededTaxCodes(stored: SetupTaxCode[]): SetupTaxCode[] {
  const byCode = new Map(stored.map((row) => [String(row.code || "").toUpperCase(), row]));
  const next = [...stored];
  for (const seed of defaults.taxCodes) {
    const existing = byCode.get(seed.code.toUpperCase());
    if (!existing) {
      next.push(seed);
      byCode.set(seed.code.toUpperCase(), seed);
      continue;
    }
    existing.xeroTaxTypeIncome = existing.xeroTaxTypeIncome || seed.xeroTaxTypeIncome;
    existing.xeroTaxTypeExpense = existing.xeroTaxTypeExpense || seed.xeroTaxTypeExpense;
  }
  return next;
}

function readStore(): SetupConfigStore {
  const stored = loadServerStore<SetupConfigStore>(STORE, defaults);
  const existingTemplates = stored.emailTemplates?.length ? stored.emailTemplates : defaults.emailTemplates;
  const knownKeys = new Set(existingTemplates.map((row) => row.key));
  const mergedTemplates = [
    ...existingTemplates,
    ...defaults.emailTemplates.filter((row) => !knownKeys.has(row.key)),
  ];
  return {
    statuses: stored.statuses?.length ? stored.statuses : defaults.statuses,
    lostReasons: stored.lostReasons?.length ? stored.lostReasons : defaults.lostReasons,
    taxCodes: ensureSeededTaxCodes(stored.taxCodes?.length ? stored.taxCodes : defaults.taxCodes),
    emailTemplates: mergedTemplates,
    assetTypes: stored.assetTypes?.length ? stored.assetTypes : defaults.assetTypes,
    securityGroups: stored.securityGroups?.length ? stored.securityGroups : defaults.securityGroups,
  };
}

function writeStore(store: SetupConfigStore) {
  writeServerStore(STORE, store);
  return store;
}

export function getSetupConfig() {
  const store = readStore();
  return {
    statuses: store.statuses.filter((row) => !row.archived),
    lostReasons: store.lostReasons.filter((row) => !row.archived),
    taxCodes: store.taxCodes.filter((row) => !row.archived),
    emailTemplates: store.emailTemplates.filter((row) => !row.archived),
    assetTypes: store.assetTypes.filter((row) => !row.archived),
    securityGroups: store.securityGroups.filter((row) => !row.archived),
  };
}

export function upsertSetupListItem(
  listKey: keyof SetupConfigStore,
  item: Record<string, unknown> & { id?: string },
) {
  const store = readStore();
  const list = [...((store[listKey] as Array<Record<string, unknown> & { id: string }>) || [])];
  if (item.id) {
    const next = list.map((row) => (row.id === item.id ? { ...row, ...item, id: item.id } : row));
    (store as unknown as Record<string, unknown>)[listKey] = next;
  } else {
    list.unshift({ ...item, id: uid(String(listKey).slice(0, 3)) });
    (store as unknown as Record<string, unknown>)[listKey] = list;
  }
  writeStore(store);
  return getSetupConfig();
}

export function archiveSetupListItem(listKey: keyof SetupConfigStore, id: string) {
  const store = readStore();
  const list = ((store[listKey] as Array<{ id: string; archived?: boolean }>) || []).map((row) =>
    row.id === id ? { ...row, archived: true } : row,
  );
  (store as unknown as Record<string, unknown>)[listKey] = list;
  writeStore(store);
  return getSetupConfig();
}

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
  archived?: boolean;
};

export type SetupEmailTemplate = {
  id: string;
  key: "quote" | "invoice" | "po" | "follow-up" | "job-confirmation";
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
    { id: "tax-std", code: "OUTPUT2", name: "Standard 20%", rate: 20, xeroTaxType: "OUTPUT2" },
    { id: "tax-zero", code: "NONE", name: "Zero rated", rate: 0, xeroTaxType: "NONE" },
    { id: "tax-drc", code: "RRCOUT", name: "Domestic reverse charge", rate: 0, xeroTaxType: "RRCOUTPUT" },
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
      subject: "Job {{ref}} confirmed",
      body: "Hi {{contact}},\n\nWe have booked job {{ref}} for {{date}}.\n\nKind regards,\n{{company}}",
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
      name: "Engineer",
      role: "Engineer",
      permissions: {
        showCustomers: true,
        showJobs: true,
        showQuotes: false,
        showAssets: true,
        showStock: true,
        showFinance: false,
        showSchedule: true,
        canCreateJob: false,
        canCreateQuote: false,
        canCreateLead: false,
        canEditJobs: true,
        canDeleteJobs: false,
        canRequestPurchase: true,
        canApprovePurchase: false,
        canCustomize: false,
        canEditInvoice: false,
      },
    },
  ],
};

function readStore(): SetupConfigStore {
  const stored = loadServerStore<SetupConfigStore>(STORE, defaults);
  return {
    statuses: stored.statuses?.length ? stored.statuses : defaults.statuses,
    lostReasons: stored.lostReasons?.length ? stored.lostReasons : defaults.lostReasons,
    taxCodes: stored.taxCodes?.length ? stored.taxCodes : defaults.taxCodes,
    emailTemplates: stored.emailTemplates?.length ? stored.emailTemplates : defaults.emailTemplates,
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

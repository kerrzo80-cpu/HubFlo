import {
  appendAuditEvent,
  getClientSites,
  getClients,
  type AuditEvent,
} from "@/lib/people-data";
import { checkQuoteConversion } from "@hubflo/domain";
import { peekHubJobReviews, getHubDetailState } from "@/lib/hub-detail-store";
import { compareReferenceDesc, numberedReference } from "@/lib/numbering";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { useDemoSeedData } from "@/lib/workspace-mode";
import { jobInvoiceReviewComplete } from "@/lib/job-invoice-review";

export type JobHealth = "red" | "amber" | "green" | "blue";

export type QuoteStatus = "Draft" | "Sent" | "Accepted" | "Declined" | "Converted" | "Lost";

const QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  Draft: ["Sent", "Lost"],
  Sent: ["Accepted", "Declined", "Lost", "Sent"],
  Accepted: ["Converted", "Lost"],
  Declined: ["Lost", "Draft"],
  Converted: [],
  Lost: ["Draft"],
};

export function assertQuoteStatusTransition(from: QuoteStatus | string, to: QuoteStatus | string): string | null {
  if (from === to) return null;
  const allowed = QUOTE_STATUS_TRANSITIONS[from as QuoteStatus];
  if (!allowed) return `Unknown quote status “${from}”.`;
  if (!allowed.includes(to as QuoteStatus)) {
    return `Cannot move quote from ${from} to ${to}.`;
  }
  return null;
}
export type PurchaseStatus =
  | "Requested"
  | "Draft"
  | "Pending cost"
  | "Part received"
  | "Received"
  | "Disputed"
  | "Approved"
  | "Issued"
  | "Rejected";

export interface Job {
  id: string;
  ref: string;
  clientId?: string;
  siteId?: string;
  simproJobId?: string;
  simproStatus?: "Queued" | "Sent" | "Failed";
  simproSentAt?: string;
  sourceQuoteId?: string;
  sourceQuoteRef?: string;
  sourceTenderId?: string;
  sourceTenderName?: string;
  customer: string;
  site: string;
  description: string;
  manager: string;
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledDurationHours?: number;
  confirmationSentAt?: string;
  confirmationSentTo?: string;
  etaSentAt?: string;
  etaSentTo?: string;
  etaMinutes?: number;
  completionSentAt?: string;
  completionSentTo?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  actualDurationHours?: number;
  labourCostVariance?: number;
  status: string;
  health: JobHealth;
  value: number;
  next: string;
  due: string;
  /** ISO timestamp used for newest-first directory ordering. */
  createdAt?: string;
}

/** Legacy Ready-to-invoice records without the mandatory three-person review belong in Complete. */
function withEnforcedInvoiceReview(job: Job, reviews?: Record<string, unknown>): Job {
  if (job.status !== "Ready to invoice") return job;
  const review = (reviews ?? peekHubJobReviews())[job.id];
  if (jobInvoiceReviewComplete(review)) return job;
  return {
    ...job,
    status: "Completed",
    health: "green",
    next: "Three-person review required before Ready to invoice.",
  };
}

export interface Quote {
  id: string;
  ref: string;
  clientId?: string;
  siteId?: string;
  sourceLeadId?: string;
  sourceLeadRef?: string;
  convertedJobId?: string;
  convertedJobRef?: string;
  customer: string;
  description: string;
  owner: string;
  status: QuoteStatus;
  value: number;
  next: string;
  due: string;
  portalToken?: string;
  portalUrl?: string;
  outlookMessageId?: string;
  sentAt?: string;
  viewedAt?: string;
  respondedAt?: string;
  simproQuoteId?: string;
  simproStatus?: "Queued" | "Sent" | "Failed";
  simproSentAt?: string;
  /** Chain continuity ids (survey / takeoff / heat design). */
  metadata?: Record<string, string | undefined>;
  /** ISO timestamp used for newest-first directory ordering. */
  createdAt?: string;
}

export interface PurchaseRequest {
  id: string;
  jobId: string;
  jobRef: string;
  costCentreId?: string;
  costCentreName?: string;
  requestedBy: string;
  supplier: string;
  supplierEmail?: string;
  item: string;
  lines?: PurchaseOrderLine[];
  estimatedCost: number;
  actualCost?: number;
  reason: string;
  status: PurchaseStatus;
  poNumber: string;
  createdAt: string;
  sentAt?: string;
  invoiceFileName?: string;
  invoiceReceivedAt?: string;
  supplierInvoiceAmount?: number;
  supplierInvoiceRef?: string;
  receivedAt?: string;
  updatedAt?: string;
  /** ISO date (YYYY-MM-DD) when status last changed — used for Field day alerts. */
  statusChangedOn?: string;
  xeroBillId?: string;
  xeroBillNumber?: string;
  xeroExportedAt?: string;
  xeroAccountsStatus?: "Not sent" | "Queued" | "Sent";
  supplierPaymentStatus?: "Unpaid" | "Part paid" | "Paid";
  supplierPaidAmount?: number;
  supplierPayments?: Array<{
    id: string;
    paidAt: string;
    amount: number;
    method: string;
    reference?: string;
    note?: string;
    actor?: string;
    source?: "manual" | "xero";
    sourcePaymentId?: string;
    sourceBillId?: string;
    importedAt?: string;
    reconciled?: boolean;
  }>;
  xeroPaymentsCheckedAt?: string;
}

export interface PurchaseOrderLine {
  id: string;
  description: string;
  quantity: number;
  estimatedCost: number;
  actualCost?: number;
  receivedPercent: number;
  catalogItemId?: string;
  sku?: string;
}

export interface WorkflowStore {
  jobs: Job[];
  quotes: Quote[];
  purchaseRequests: PurchaseRequest[];
}

export type QuoteConversionResult = {
  quote: Quote;
  job: Job;
  auditEvents: AuditEvent[];
};

const seedJobs: Job[] = [
  {
    id: "job-1048",
    ref: "J-1048",
    clientId: "client-northfield",
    siteId: "site-hopetoun",
    customer: "Northfield Properties",
    site: "10 Hopetoun Court, Aberdeen",
    description: "Boiler service and remedial works",
    manager: "Errol Watson",
    status: "Waiting on parts",
    health: "red",
    value: 2840,
    next: "Order pump valves",
    due: "Today",
    createdAt: "2026-06-18T09:00:00.000Z",
  },
  {
    id: "job-1052",
    ref: "J-1052",
    clientId: "client-morrison",
    siteId: "site-queens-road",
    customer: "Morrison & Co.",
    site: "42 Queen's Road, Aberdeen",
    description: "Office heating upgrade",
    manager: "Brian Kerr",
    status: "In progress",
    health: "green",
    value: 18900,
    next: "Engineer visit",
    due: "Tomorrow",
    createdAt: "2026-06-20T10:00:00.000Z",
  },
  {
    id: "job-1056",
    ref: "J-1056",
    customer: "A. Davidson",
    site: "7 Cairn View, Westhill",
    description: "Bathroom installation",
    manager: "Errol Watson",
    status: "Approval required",
    health: "amber",
    value: 9450,
    next: "Review variation V-003",
    due: "Today",
    createdAt: "2026-06-22T11:00:00.000Z",
  },
  {
    id: "job-1041",
    ref: "J-1041",
    customer: "Granite Developments",
    site: "Plot 18, Kings Park",
    description: "First and second fix plumbing",
    manager: "Brian Kerr",
    status: "Ready to invoice",
    health: "green",
    value: 24760,
    next: "Raise final invoice",
    due: "Today",
    createdAt: "2026-06-15T08:00:00.000Z",
  },
  {
    id: "job-1039",
    ref: "J-1039",
    clientId: "client-aberdeen-care",
    siteId: "site-rubislaw",
    customer: "Aberdeen Property Care",
    site: "16 Rubislaw Park",
    description: "Heating fault investigation",
    manager: "Errol Watson",
    status: "Scheduled",
    health: "blue",
    value: 1260,
    next: "Attend site",
    due: "24 Jun",
    createdAt: "2026-06-12T08:00:00.000Z",
  },
];

const seedQuotes: Quote[] = [
  {
    id: "quote-2061",
    ref: "Q-2061",
    clientId: "client-northfield",
    siteId: "site-hopetoun",
    customer: "Northfield Properties",
    description: "Boiler replacement package",
    owner: "Errol Watson",
    status: "Sent",
    value: 4200,
    next: "Await customer signature",
    due: "Today",
    createdAt: "2026-06-20T09:00:00.000Z",
  },
  {
    id: "quote-2062",
    ref: "Q-2062",
    clientId: "client-morrison",
    siteId: "site-queens-road",
    customer: "Morrison & Co.",
    description: "Office heating balancing",
    owner: "Brian Kerr",
    status: "Accepted",
    value: 9300,
    next: "Create job and schedule",
    due: "Today",
    createdAt: "2026-06-21T10:00:00.000Z",
  },
  {
    id: "quote-2063",
    ref: "Q-2063",
    clientId: "client-aberdeen-care",
    siteId: "site-rubislaw",
    customer: "Aberdeen Property Care",
    description: "Annual service plan extension",
    owner: "Errol Watson",
    status: "Declined",
    value: 1800,
    next: "Awaiting re-quote request",
    due: "Tomorrow",
    createdAt: "2026-06-22T11:00:00.000Z",
  },
];

const seedPurchaseRequests: PurchaseRequest[] = [
  {
    id: "po-01",
    jobId: "job-1056",
    jobRef: "J-1056",
    requestedBy: "Chris Lawson",
    supplier: "Aldrite Plumbing Ltd",
    item: "Pipes and fittings for bathroom line work",
    estimatedCost: 780,
    reason: "Need additional fittings for non-standard route",
    status: "Approved",
    poNumber: "PO-1003",
    createdAt: "2026-06-21T09:00:00.000Z",
  },
  {
    id: "po-02",
    jobId: "job-1048",
    jobRef: "J-1048",
    requestedBy: "Chris Lawson",
    supplier: "Valve Source",
    item: "Pump and control valve",
    estimatedCost: 420,
    reason: "Pump failed, no stock equivalent available",
    status: "Requested",
    poNumber: "",
    createdAt: "2026-06-22T13:20:00.000Z",
  },
];

export const quoteStatuses: QuoteStatus[] = [
  "Draft",
  "Sent",
  "Accepted",
  "Declined",
  "Converted",
  "Lost",
];

const defaultStore: WorkflowStore = {
  jobs: useDemoSeedData() ? clone(seedJobs) : [],
  quotes: useDemoSeedData() ? clone(seedQuotes) : [],
  purchaseRequests: useDemoSeedData() ? clone(seedPurchaseRequests) : [],
};

const workflowStore = loadServerStore("workflow-store", defaultStore);

function persistWorkflowStore() {
  writeServerStore("workflow-store", workflowStore);
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function getStore(): WorkflowStore {
  const persisted = readServerStoreSnapshot("workflow-store") as WorkflowStore | null;
  if (persisted && Array.isArray(persisted.jobs) && Array.isArray(persisted.quotes) && Array.isArray(persisted.purchaseRequests)) {
    workflowStore.jobs = clone(persisted.jobs);
    workflowStore.quotes = clone(persisted.quotes);
    workflowStore.purchaseRequests = clone(persisted.purchaseRequests);
  }
  return workflowStore;
}

function deriveJobHealth(status: string, options?: { scheduledDate?: string; due?: string }): JobHealth {
  if (["Waiting on parts", "Waiting on customer"].includes(status)) return "red";
  if (status === "Approval required") return "amber";
  if (["Ready to invoice", "Invoiced", "Completed"].includes(status)) return "green";

  const today = new Date().toISOString().slice(0, 10);
  const openStatuses = ["Pending", "In Progress", "Scheduled", "Survey", "Quoted"];
  const isOpen = openStatuses.includes(status) || !["Ready to invoice", "Invoiced", "Completed", "Cancelled"].includes(status);
  if (isOpen) {
    const scheduleOrDue = String(options?.scheduledDate || options?.due || "").slice(0, 10);
    if (scheduleOrDue && scheduleOrDue < today) return "amber";
  }
  // Unknown / blue operational states are "in flight", not "on track".
  return "amber";
}

function determineNextJobRef(jobs: Job[]): string {
  return numberedReference("job", getHubDetailState().financeSettings, jobs.map((job) => job.ref));
}

function determineNextQuoteRef(quotes: Quote[]): string {
  return numberedReference("quote", getHubDetailState().financeSettings, quotes.map((quote) => quote.ref));
}

function findClient(clientId?: string, customer?: string) {
  const peopleClients = getClients();
  if (clientId) {
    const match = peopleClients.find((client) => client.id === clientId);
    if (match) return match;
  }

  return peopleClients.find(
    (client) => customer && client.name.toLowerCase() === customer.toLowerCase(),
  );
}

function findSite(siteId?: string, clientId?: string, siteName?: string) {
  const peopleSites = getClientSites();
  if (siteId) {
    const match = peopleSites.find((site) => site.id === siteId);
    if (match) return match;
  }

  return peopleSites.find((site) => {
    if (clientId && site.clientId !== clientId) return false;
    if (!siteName) return true;
    return (
      site.name.toLowerCase() === siteName.toLowerCase() ||
      site.address.toLowerCase().includes(siteName.toLowerCase())
    );
  });
}

function nextPoNumber(existing: PurchaseRequest[]): string {
  return numberedReference("purchaseOrder", getHubDetailState().financeSettings, existing.map((request) => request.poNumber));
}

function workflowStoreTimestamp() {
  return new Date()
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

/** Best-effort parse of workflow timestamps like "04 Aug 2026 15:30" into YYYY-MM-DD. */
export function isoDateFromWorkflowTimestamp(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (!match) return "";
  const day = Number(match[1]);
  const year = Number(match[3]);
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const month = months[match[2] || ""];
  if (month === undefined || !day || !year) return "";
  const date = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function purchaseStatusIssuesPoNumber(status: PurchaseStatus) {
  return ["Draft", "Approved", "Issued", "Pending cost", "Part received", "Received"].includes(status);
}

export function getJobs(): Job[] {
  if (useDemoSeedData()) {
    try {
      const { ensureGasCertTrialInCore } = require("@/lib/gas-cert-trial-core") as {
        ensureGasCertTrialInCore: () => Job | null;
      };
      ensureGasCertTrialInCore();
    } catch {
      // Trial bootstrap is best-effort.
    }
  }
  // Read reviews once — calling getHubDetailState() per Ready-to-invoice job cloned the
  // entire hub and OOMed live (parallel clients/jobs/quotes 502s).
  const reviews = peekHubJobReviews();
  return clone(getStore().jobs)
    .map((job) => withEnforcedInvoiceReview(job, reviews))
    .sort((left, right) => compareReferenceDesc(left.ref, right.ref));
}

export function resetWorkflowStore(): WorkflowStore {
  const store = getStore();
  store.jobs = [];
  store.quotes = [];
  store.purchaseRequests = [];
  persistWorkflowStore();
  return clone(store);
}

export function getJob(id: string): Job | undefined {
  const match = getStore().jobs.find((job) => job.id === id);
  if (!match) return undefined;
  return clone(withEnforcedInvoiceReview(match, peekHubJobReviews()));
}

export function saveJob(job: Job): Job {
  const store = getStore();
  const current = store.jobs.find((existing) => existing.id === job.id);
  if (current) {
    Object.assign(current, job);
    persistWorkflowStore();
    return clone(current);
  }
  store.jobs = [job, ...store.jobs];
  persistWorkflowStore();
  return clone(job);
}

export function updateJob(id: string, patch: Partial<Job>): Job | null {
  const store = getStore();
  const index = store.jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const current = store.jobs[index];
  if (!current) return null;
  const resolvedClient = (patch.clientId ?? current.clientId)
    ? findClient(patch.clientId ?? current.clientId, patch.customer ?? current.customer)
    : undefined;
  const resolvedSite = (patch.siteId ?? current.siteId)
    ? findSite(
        patch.siteId ?? current.siteId,
        resolvedClient?.id ?? patch.clientId ?? current.clientId,
        patch.site ?? current.site,
      )
    : undefined;
  const nextHealth = patch.status || patch.scheduledDate !== undefined || patch.due !== undefined
    ? deriveJobHealth(patch.status ?? current.status, {
        scheduledDate: patch.scheduledDate ?? current.scheduledDate,
        due: patch.due ?? current.due,
      })
    : current.health;
  const updated: Job = {
    ...current,
    ...patch,
    id: current.id,
    health: nextHealth,
    clientId: patch.clientId ?? resolvedClient?.id ?? current.clientId,
    siteId: patch.siteId ?? resolvedSite?.id ?? current.siteId,
    customer: resolvedClient?.name ?? patch.customer ?? current.customer,
    site: resolvedSite?.address ?? patch.site ?? current.site,
  };
  store.jobs[index] = updated;
  persistWorkflowStore();
  return clone(updated);
}

export function removeJob(id: string): boolean {
  const store = getStore();
  const currentCount = store.jobs.length;
  store.jobs = store.jobs.filter((job) => job.id !== id);
  if (store.jobs.length < currentCount) {
    persistWorkflowStore();
    return true;
  }
  return false;
}

export function createJob(
  payload: Omit<Job, "id" | "ref" | "health"> & { id?: string; ref?: string; health?: JobHealth },
): Job {
  const jobs = getStore().jobs;
  const nextRef = payload.ref ?? determineNextJobRef(jobs);
  const client = findClient(payload.clientId, payload.customer);
  const site = findSite(payload.siteId, client?.id ?? payload.clientId, payload.site);
  const created: Job = {
    id: payload.id ?? crypto.randomUUID(),
    ...payload,
    clientId: payload.clientId ?? client?.id,
    siteId: payload.siteId ?? site?.id,
    customer: client?.name ?? payload.customer,
    site: site?.address ?? payload.site,
    ref: nextRef,
    health: payload.health ?? deriveJobHealth(payload.status, {
      scheduledDate: payload.scheduledDate,
      due: payload.due,
    }),
  };
  return saveJob(created);
}

function backfillCreatedAtFromSimproLinks() {
  try {
    const { findSimproEntityLinkByNexa } = require("@/lib/simpro-entity-links") as {
      findSimproEntityLinkByNexa: (input: {
        entityType: "quote" | "job";
        nexaId: string;
      }) => { sourceModifiedAt?: string } | null;
    };
    const store = getStore();
    let mutated = false;
    for (const quote of store.quotes) {
      if (quote.createdAt || !quote.simproQuoteId) continue;
      const link = findSimproEntityLinkByNexa({ entityType: "quote", nexaId: quote.id });
      if (link?.sourceModifiedAt && Number.isFinite(Date.parse(link.sourceModifiedAt))) {
        quote.createdAt = new Date(link.sourceModifiedAt).toISOString();
        mutated = true;
      }
    }
    for (const job of store.jobs) {
      if (job.createdAt || !job.simproJobId) continue;
      const link = findSimproEntityLinkByNexa({ entityType: "job", nexaId: job.id });
      if (link?.sourceModifiedAt && Number.isFinite(Date.parse(link.sourceModifiedAt))) {
        job.createdAt = new Date(link.sourceModifiedAt).toISOString();
        mutated = true;
      }
    }
    if (mutated) persistWorkflowStore();
  } catch {
    // Link lookup is best-effort for directory ordering.
  }
}

export function getQuotes(): Quote[] {
  return clone(getStore().quotes).sort((left, right) => compareReferenceDesc(left.ref, right.ref));
}

export function createQuote(payload: Omit<Quote, "id" | "ref"> & { id?: string; ref?: string }): Quote {
  const store = getStore();
  const client = findClient(payload.clientId, payload.customer);
  const site = findSite(payload.siteId, client?.id ?? payload.clientId);
  const created: Quote = {
    id: payload.id ?? crypto.randomUUID(),
    clientId: payload.clientId ?? client?.id,
    siteId: payload.siteId ?? site?.id,
    sourceLeadId: payload.sourceLeadId,
    sourceLeadRef: payload.sourceLeadRef,
    convertedJobId: payload.convertedJobId,
    convertedJobRef: payload.convertedJobRef,
    customer: client?.name ?? payload.customer,
    description: payload.description,
    owner: payload.owner,
    status: payload.status,
    value: payload.value,
    next: payload.next,
    due: payload.due,
    portalToken: payload.portalToken,
    portalUrl: payload.portalUrl,
    outlookMessageId: payload.outlookMessageId,
    sentAt: payload.sentAt,
    viewedAt: payload.viewedAt,
    respondedAt: payload.respondedAt,
    simproQuoteId: payload.simproQuoteId,
    simproStatus: payload.simproStatus,
    simproSentAt: payload.simproSentAt,
    metadata: payload.metadata,
    ref: payload.ref || determineNextQuoteRef(store.quotes),
  };
  store.quotes = [created, ...store.quotes];
  persistWorkflowStore();
  return clone(created);
}

export function updateQuoteStatus(id: string, status: QuoteStatus): Quote | null {
  const store = getStore();
  const index = store.quotes.findIndex((quote) => quote.id === id);
  if (index < 0) return null;
  const current = store.quotes[index];
  if (!current) return null;
  if (assertQuoteStatusTransition(current.status, status)) return null;

  const updated: Quote = {
    ...current,
    status,
  };
  store.quotes[index] = updated;
  persistWorkflowStore();
  return clone(updated);
}

export function updateQuote(id: string, patch: Partial<Quote>): Quote | null {
  const store = getStore();
  const index = store.quotes.findIndex((quote) => quote.id === id);
  if (index < 0) return null;
  const current = store.quotes[index];
  if (!current) return null;
  if (patch.status && assertQuoteStatusTransition(current.status, patch.status)) {
    return null;
  }
  const resolvedClient = (patch.clientId ?? current.clientId)
    ? findClient(patch.clientId ?? current.clientId, patch.customer ?? current.customer)
    : undefined;
  const resolvedSite = (patch.siteId ?? current.siteId)
    ? findSite(
        patch.siteId ?? current.siteId,
        resolvedClient?.id ?? patch.clientId ?? current.clientId,
        current.customer,
      )
    : undefined;

  const updated: Quote = {
    ...current,
    ...patch,
    id: current.id,
    ref: current.ref,
    clientId: patch.clientId ?? resolvedClient?.id ?? current.clientId,
    siteId: patch.siteId ?? resolvedSite?.id ?? current.siteId,
    customer: resolvedClient?.name ?? patch.customer ?? current.customer,
  };
  store.quotes[index] = updated;
  persistWorkflowStore();
  return clone(updated);
}

export function removeQuote(id: string): boolean {
  const store = getStore();
  const currentCount = store.quotes.length;
  store.quotes = store.quotes.filter((quote) => quote.id !== id);
  if (store.quotes.length < currentCount) {
    persistWorkflowStore();
    return true;
  }
  return false;
}

export function convertQuoteToJob(
  id: string,
  actor = "HubFlo user",
  chargeValue?: number,
): QuoteConversionResult | null {
  const store = getStore();
  const index = store.quotes.findIndex((quote) => quote.id === id);
  if (index < 0) return null;

  const quote = store.quotes[index];
  if (!quote) return null;
  if (!checkQuoteConversion(quote).allowed) return null;

  const client = findClient(quote.clientId, quote.customer);
  const site = findSite(quote.siteId, client?.id ?? quote.clientId);
  const quoteValue = Number.isFinite(chargeValue) && chargeValue !== undefined ? chargeValue : quote.value;
  const job = createJob({
    clientId: quote.clientId ?? client?.id,
    siteId: quote.siteId ?? site?.id,
    sourceQuoteId: quote.id,
    sourceQuoteRef: quote.ref,
    customer: client?.name ?? quote.customer,
    site: site?.address ?? "Site to be confirmed",
    description: quote.description,
    manager: quote.owner,
    status: "Pending",
    value: quoteValue,
    next: "Schedule staff and first visit",
    due: quote.due,
  });

  const updatedQuote: Quote = {
    ...quote,
    value: quoteValue,
    status: "Converted",
    next: `Job ${job.ref} created`,
    convertedJobId: job.id,
    convertedJobRef: job.ref,
  };

  const updatedIndex = store.quotes.findIndex((current) => current.id === id);
  if (updatedIndex >= 0) {
    store.quotes[updatedIndex] = updatedQuote;
    persistWorkflowStore();
  }

  const auditEvents = [
    appendAuditEvent({
      actor,
      action: "converted",
      recordType: "quote",
      recordId: updatedQuote.id,
      summary: `Quote ${updatedQuote.ref} converted into job ${job.ref}.`,
      source: "web",
      importance: "high",
    }),
    appendAuditEvent({
      actor,
      action: "created",
      recordType: "job",
      recordId: job.id,
      summary: `Job ${job.ref} created from quote ${updatedQuote.ref}.`,
      source: "web",
      importance: "high",
    }),
  ];

  if (client) {
    auditEvents.push(
      appendAuditEvent({
        actor,
        action: "linked",
        recordType: "client",
        recordId: client.id,
        summary: `${updatedQuote.ref} converted into ${job.ref} for ${client.name}.`,
        source: "web",
        importance: "high",
      }),
    );
  }

  if (site) {
    auditEvents.push(
      appendAuditEvent({
        actor,
        action: "linked",
        recordType: "site",
        recordId: site.id,
        summary: `Job ${job.ref} linked to ${site.name} from quote ${updatedQuote.ref}.`,
        source: "web",
        importance: "normal",
      }),
    );
  }

  return {
    quote: clone(updatedQuote),
    job: clone(job),
    auditEvents,
  };
}

export function getPurchaseRequests(): PurchaseRequest[] {
  return clone(getStore().purchaseRequests).sort((left, right) =>
    compareReferenceDesc(left.poNumber || left.id, right.poNumber || right.id),
  );
}

export type PurchaseRequestInput = Omit<PurchaseRequest, "id" | "status" | "poNumber"> & {
  status?: PurchaseStatus;
  poNumber?: string;
};

export function createPurchaseRequest(
  payload: PurchaseRequestInput,
): PurchaseRequest {
  const store = getStore();
  const status = payload.status ?? "Requested";
  const createdAt =
    payload.createdAt && Number.isFinite(Date.parse(payload.createdAt))
      ? new Date(payload.createdAt).toISOString()
      : new Date().toISOString();
  const created: PurchaseRequest = {
    id: crypto.randomUUID(),
    status,
    poNumber: payload.poNumber ?? (purchaseStatusIssuesPoNumber(status) ? nextPoNumber(store.purchaseRequests) : ""),
    createdAt,
    updatedAt: payload.updatedAt && Number.isFinite(Date.parse(payload.updatedAt))
      ? new Date(payload.updatedAt).toISOString()
      : createdAt,
    estimatedCost: payload.estimatedCost,
    actualCost: payload.actualCost,
    item: payload.item,
    lines: payload.lines,
    jobId: payload.jobId,
    jobRef: payload.jobRef,
    costCentreId: payload.costCentreId,
    costCentreName: payload.costCentreName,
    reason: payload.reason,
    requestedBy: payload.requestedBy,
    supplier: payload.supplier,
    supplierEmail: payload.supplierEmail,
    sentAt: payload.sentAt,
    invoiceFileName: payload.invoiceFileName,
    invoiceReceivedAt: payload.invoiceReceivedAt,
    supplierInvoiceAmount: payload.supplierInvoiceAmount,
    supplierInvoiceRef: payload.supplierInvoiceRef,
    receivedAt: payload.receivedAt,
    xeroBillId: payload.xeroBillId,
    xeroBillNumber: payload.xeroBillNumber,
    xeroExportedAt: payload.xeroExportedAt,
    xeroAccountsStatus: payload.xeroAccountsStatus,
    supplierPaymentStatus: payload.supplierPaymentStatus,
    supplierPaidAmount: payload.supplierPaidAmount,
    supplierPayments: payload.supplierPayments,
    xeroPaymentsCheckedAt: payload.xeroPaymentsCheckedAt,
  };
  store.purchaseRequests = [created, ...store.purchaseRequests];
  persistWorkflowStore();
  return clone(created);
}

export function updatePurchaseRequest(
  id: string,
  patch: Partial<Omit<PurchaseRequest, "id">>,
): PurchaseRequest | null {
  const store = getStore();
  const index = store.purchaseRequests.findIndex((request) => request.id === id);
  if (index < 0) return null;

  const current = store.purchaseRequests[index];
  if (!current) return null;

  const status = patch.status ?? current.status;
  const poNumber =
    patch.poNumber ??
    (current.poNumber || (purchaseStatusIssuesPoNumber(status) ? nextPoNumber(store.purchaseRequests) : ""));
  const actualCost =
    patch.actualCost ??
    (status === "Received" && current.actualCost === undefined
      ? patch.estimatedCost ?? current.estimatedCost
      : current.actualCost);
  const timestamp = workflowStoreTimestamp();
  const statusChanged =
    patch.status !== undefined && patch.status !== current.status;

  store.purchaseRequests[index] = {
    ...current,
    ...patch,
    status,
    poNumber,
    actualCost,
    sentAt: patch.sentAt ?? (status === "Pending cost" ? current.sentAt ?? timestamp : current.sentAt),
    invoiceReceivedAt: patch.invoiceReceivedAt ?? (status === "Received" ? current.invoiceReceivedAt ?? timestamp : current.invoiceReceivedAt),
    receivedAt: patch.receivedAt ?? (status === "Received" ? current.receivedAt ?? timestamp : current.receivedAt),
    updatedAt: patch.updatedAt ?? timestamp,
    statusChangedOn: statusChanged
      ? patch.statusChangedOn || isoDateToday()
      : patch.statusChangedOn ?? current.statusChangedOn,
  };
  persistWorkflowStore();
  return clone(store.purchaseRequests[index]);
}

export function updatePurchaseRequestStatus(
  id: string,
  status: Exclude<PurchaseRequest["status"], "Requested">,
): PurchaseRequest | null {
  return updatePurchaseRequest(id, { status });
}

export function removePurchaseRequest(id: string): boolean {
  const store = getStore();
  const currentCount = store.purchaseRequests.length;
  store.purchaseRequests = store.purchaseRequests.filter((request) => request.id !== id);
  if (store.purchaseRequests.length < currentCount) {
    persistWorkflowStore();
    return true;
  }
  return false;
}

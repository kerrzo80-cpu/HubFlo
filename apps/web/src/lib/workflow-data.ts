import {
  appendAuditEvent,
  getClientSites,
  getClients,
  type AuditEvent,
} from "@/lib/people-data";
import { checkQuoteConversion } from "@hubflo/domain";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type JobHealth = "red" | "amber" | "green" | "blue";
export type QuoteStatus = "Draft" | "Sent" | "Accepted" | "Declined" | "Converted" | "Lost";
export type PurchaseStatus = "Requested" | "Approved" | "Issued" | "Rejected";

export interface Job {
  id: string;
  ref: string;
  clientId?: string;
  siteId?: string;
  sourceQuoteId?: string;
  sourceQuoteRef?: string;
  customer: string;
  site: string;
  description: string;
  manager: string;
  scheduledDate?: string;
  scheduledTime?: string;
  status: string;
  health: JobHealth;
  value: number;
  next: string;
  due: string;
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
}

export interface PurchaseRequest {
  id: string;
  jobId: string;
  jobRef: string;
  costCentreId?: string;
  costCentreName?: string;
  requestedBy: string;
  supplier: string;
  item: string;
  estimatedCost: number;
  reason: string;
  status: PurchaseStatus;
  poNumber: string;
  createdAt: string;
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
  },
  {
    id: "job-1052",
    ref: "J-1052",
    clientId: "client-morrison",
    siteId: "site-queens-road",
    customer: "Morrison & Co.",
    site: "42 Queen's Road, Aberdeen",
    description: "Office heating upgrade",
    manager: "Kerry Watson",
    status: "In progress",
    health: "green",
    value: 18900,
    next: "Engineer visit",
    due: "Tomorrow",
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
  },
  {
    id: "job-1041",
    ref: "J-1041",
    customer: "Granite Developments",
    site: "Plot 18, Kings Park",
    description: "First and second fix plumbing",
    manager: "Kerry Watson",
    status: "Ready to invoice",
    health: "green",
    value: 24760,
    next: "Raise final invoice",
    due: "Today",
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
  },
  {
    id: "quote-2062",
    ref: "Q-2062",
    clientId: "client-morrison",
    siteId: "site-queens-road",
    customer: "Morrison & Co.",
    description: "Office heating balancing",
    owner: "Kerry Watson",
    status: "Accepted",
    value: 9300,
    next: "Create job and schedule",
    due: "Today",
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
  },
];

const seedPurchaseRequests: PurchaseRequest[] = [
  {
    id: "po-01",
    jobId: "job-1056",
    jobRef: "J-1056",
    requestedBy: "Engineer Jamie",
    supplier: "Aldrite Plumbing Ltd",
    item: "Pipes and fittings for bathroom line work",
    estimatedCost: 780,
    reason: "Need additional fittings for non-standard route",
    status: "Approved",
    poNumber: "PO-1003",
    createdAt: "Today",
  },
  {
    id: "po-02",
    jobId: "job-1048",
    jobRef: "J-1048",
    requestedBy: "Engineer Scott",
    supplier: "Valve Source",
    item: "Pump and control valve",
    estimatedCost: 420,
    reason: "Pump failed, no stock equivalent available",
    status: "Requested",
    poNumber: "",
    createdAt: "13:20",
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
  jobs: [],
  quotes: [],
  purchaseRequests: [],
};

void seedJobs;
void seedQuotes;
void seedPurchaseRequests;

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
  return workflowStore;
}

function deriveJobHealth(status: string): JobHealth {
  if (["Waiting on parts", "Waiting on customer"].includes(status)) return "red";
  if (status === "Approval required") return "amber";
  if (["Ready to invoice", "Invoiced", "Completed"].includes(status)) return "green";
  return "blue";
}

function determineNextJobRef(jobs: Job[]): string {
  const maxRef = Math.max(
    1000,
    ...jobs.map((job) => Number(job.ref.replace(/\D/g, "")) || 0),
  );
  return `J-${maxRef + 1}`;
}

function determineNextQuoteRef(quotes: Quote[]): string {
  const maxRef = Math.max(
    2000,
    ...quotes.map((quote) => Number(quote.ref.replace(/\D/g, "")) || 0),
  );
  return `Q-${maxRef + 1}`;
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
  const existingNumbers = existing
    .map((request) => Number(request.poNumber.replace(/[^0-9]/g, "")))
    .filter((value) => Number.isFinite(value));
  const next = Math.max(1000, ...existingNumbers) + 1;
  return `PO-${next}`;
}

export function getJobs(): Job[] {
  return clone(getStore().jobs);
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
  return clone(match);
}

export function saveJob(job: Job): Job {
  const store = getStore();
  const current = store.jobs.find((existing) => existing.id === job.id);
  if (current) {
    Object.assign(current, job);
    persistWorkflowStore();
    return clone(current);
  }
  store.jobs = [...store.jobs, job];
  persistWorkflowStore();
  return clone(job);
}

export function updateJob(id: string, patch: Partial<Job>): Job | null {
  const store = getStore();
  const index = store.jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const current = store.jobs[index];
  if (!current) return null;
  const nextHealth = patch.status ? deriveJobHealth(patch.status) : current.health;
  const updated: Job = {
    ...current,
    ...patch,
    id: current.id,
    health: nextHealth,
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
  payload: Omit<Job, "id" | "ref" | "health"> & { ref?: string; health?: JobHealth },
): Job {
  const jobs = getStore().jobs;
  const nextRef = payload.ref ?? determineNextJobRef(jobs);
  const client = findClient(payload.clientId, payload.customer);
  const site = findSite(payload.siteId, client?.id ?? payload.clientId, payload.site);
  const created: Job = {
    id: crypto.randomUUID(),
    ...payload,
    clientId: payload.clientId ?? client?.id,
    siteId: payload.siteId ?? site?.id,
    customer: client?.name ?? payload.customer,
    site: site?.address ?? payload.site,
    ref: nextRef,
    health: payload.health ?? deriveJobHealth(payload.status),
  };
  return saveJob(created);
}

export function getQuotes(): Quote[] {
  return clone(getStore().quotes);
}

export function createQuote(payload: Omit<Quote, "id">): Quote {
  const store = getStore();
  const client = findClient(payload.clientId, payload.customer);
  const site = findSite(payload.siteId, client?.id ?? payload.clientId);
  const created: Quote = {
    id: crypto.randomUUID(),
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
    ref: payload.ref || determineNextQuoteRef(store.quotes),
  };
  store.quotes = [...store.quotes, created];
  persistWorkflowStore();
  return clone(created);
}

export function updateQuoteStatus(id: string, status: QuoteStatus): Quote | null {
  const store = getStore();
  const index = store.quotes.findIndex((quote) => quote.id === id);
  if (index < 0) return null;
  const current = store.quotes[index];
  if (!current) return null;

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

  const updated: Quote = {
    ...current,
    ...patch,
    id: current.id,
    ref: current.ref,
  };
  store.quotes[index] = updated;
  persistWorkflowStore();
  return clone(updated);
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
  return clone(getStore().purchaseRequests);
}

export function createPurchaseRequest(
  payload: Omit<PurchaseRequest, "id" | "status" | "poNumber">,
): PurchaseRequest {
  const created: PurchaseRequest = {
    id: crypto.randomUUID(),
    status: "Requested",
    poNumber: "",
    createdAt: payload.createdAt,
    estimatedCost: payload.estimatedCost,
    item: payload.item,
    jobId: payload.jobId,
    jobRef: payload.jobRef,
    costCentreId: payload.costCentreId,
    costCentreName: payload.costCentreName,
    reason: payload.reason,
    requestedBy: payload.requestedBy,
    supplier: payload.supplier,
  };
  const store = getStore();
  store.purchaseRequests = [created, ...store.purchaseRequests];
  persistWorkflowStore();
  return clone(created);
}

export function updatePurchaseRequestStatus(
  id: string,
  status: Exclude<PurchaseRequest["status"], "Requested">,
): PurchaseRequest | null {
  const store = getStore();
  const index = store.purchaseRequests.findIndex((request) => request.id === id);
  if (index < 0) return null;

  const current = store.purchaseRequests[index];
  if (!current) return null;
  const generatedPoNumber =
    status === "Approved" && current.status === "Requested"
      ? nextPoNumber(store.purchaseRequests)
      : current.poNumber;

  store.purchaseRequests[index] = {
    ...current,
    status,
    poNumber: generatedPoNumber,
  };
  persistWorkflowStore();
  return clone(store.purchaseRequests[index]);
}

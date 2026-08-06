import { randomBytes } from "node:crypto";

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { listVariationPortalRequests } from "@/lib/variation-portal-data";
import { getJobs, getQuotes, updateQuote } from "@/lib/workflow-data";

const STORE_NAME = "client-portal-hub-v1";
const openQuoteStatuses = new Set(["draft", "sent", "pending", "viewed"]);
const openInvoiceStatuses = new Set(["sent", "partially paid"]);
const openInvoicePaymentStatuses = new Set(["unpaid", "part paid", "part-paid", "sent"]);
const pendingVariationStatuses = new Set(["pending", "viewed"]);
const inactiveJobStatuses = new Set(["closed", "cancelled", "canceled", "archived"]);

export type ClientHubTokenRecord = {
  token: string;
  clientId?: string;
  customerName: string;
  createdAt: string;
  lastSeenAt?: string;
};

type ClientPortalHubStore = {
  tokens: ClientHubTokenRecord[];
};

type ClientHubTokenInput = {
  clientId?: string;
  customerName: string;
};

type PortalInvoiceRecord = {
  id: string;
  ref: string;
  clientId?: string;
  customer: string;
  title?: string;
  status?: string;
  issuedDate?: string;
  dueDate?: string;
  chargeTotal?: number;
  vatRate?: number;
  paymentStatus?: string;
  paidAmount?: number;
  portalToken?: string;
  claimType?: string;
};

export type ClientHubPayload = {
  token: string;
  clientId?: string;
  customerName: string;
  lastSeenAt?: string;
  quotes: Array<{
    id: string;
    ref: string;
    description: string;
    status: string;
    value: number;
    due: string;
    next: string;
    portalToken: string;
    url: string;
  }>;
  invoices: Array<{
    id: string;
    ref: string;
    title: string;
    status: string;
    issuedDate?: string;
    dueDate?: string;
    chargeTotal: number;
    vat: number;
    grandTotal: number;
    paidAmount: number;
    owed: number;
    paymentStatus: string;
    portalToken: string;
    url: string;
  }>;
  variations: Array<{
    id: string;
    variationEventId: string;
    variationRef: string;
    jobId: string;
    jobRef: string;
    summary: string;
    description: string;
    status: string;
    sellValue: number;
    updatedAt: string;
    portalToken: string;
    url: string;
  }>;
  jobs: Array<{
    id: string;
    ref: string;
    description: string;
    site: string;
    status: string;
    next: string;
    due: string;
  }>;
};

const clientPortalHubStore = loadServerStore<ClientPortalHubStore>(STORE_NAME, { tokens: [] });

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persist() {
  writeServerStore(STORE_NAME, clientPortalHubStore);
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function tokenPart(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stablePortalToken(ref: string, id: string) {
  const refPart = tokenPart(ref) || "portal";
  const idPart = tokenPart(id).slice(0, 8) || "record";
  return `${refPart}-${idPart}`;
}

function generateHubToken(customerName: string) {
  const prefix = tokenPart(customerName).slice(0, 28) || "client";
  return `hub-${prefix}-${randomBytes(8).toString("hex")}`;
}

function matchesHubCustomer(record: ClientHubTokenRecord, customerName?: string, clientId?: string) {
  if (record.clientId && clientId && record.clientId === clientId) return true;
  return normalize(customerName) === normalize(record.customerName);
}

function invoiceGrossTotal(invoice: Pick<PortalInvoiceRecord, "chargeTotal" | "vatRate">) {
  const charge = Number(invoice.chargeTotal) || 0;
  const vatRate = Number(invoice.vatRate) || 0;
  return Math.round((charge + charge * (vatRate / 100)) * 100) / 100;
}

function publicInvoiceStatus(invoice: PortalInvoiceRecord) {
  const grandTotal = invoiceGrossTotal(invoice);
  const paidAmount = Number(invoice.paidAmount) || 0;
  return invoice.paymentStatus || (paidAmount >= grandTotal && grandTotal > 0 ? "Paid" : paidAmount > 0 ? "Part paid" : "Unpaid");
}

function invoiceOwed(invoice: PortalInvoiceRecord) {
  return Math.max(0, Math.round((invoiceGrossTotal(invoice) - (Number(invoice.paidAmount) || 0)) * 100) / 100);
}

function isInvoiceRecord(item: unknown): item is PortalInvoiceRecord {
  if (!item || typeof item !== "object") return false;
  const invoice = item as Partial<PortalInvoiceRecord>;
  return typeof invoice.id === "string" && typeof invoice.ref === "string" && typeof invoice.customer === "string";
}

function isOpenInvoice(invoice: PortalInvoiceRecord) {
  if (normalize(invoice.claimType) === "valuation") return false;
  if (invoiceOwed(invoice) <= 0.009) return false;
  const status = normalize(invoice.status);
  const paymentStatus = normalize(publicInvoiceStatus(invoice));
  return openInvoiceStatuses.has(status) || openInvoicePaymentStatuses.has(paymentStatus);
}

function clientPortalUrl(kind: "quotes" | "invoices" | "variations", token: string) {
  return `/client/${kind}/${token}`;
}

function ensureInvoicePortalTokens(invoices: PortalInvoiceRecord[]) {
  const patches = new Map<string, string>();
  const withTokens = invoices.map((invoice) => {
    if (invoice.portalToken) return invoice;
    const portalToken = stablePortalToken(invoice.ref, invoice.id);
    patches.set(invoice.id, portalToken);
    return { ...invoice, portalToken };
  });

  if (patches.size > 0) {
    const hubState = getHubDetailState();
    const rawInvoices = Array.isArray(hubState.invoices) ? hubState.invoices : [];
    saveHubDetailState({
      ...hubState,
      invoices: rawInvoices.map((item) => {
        if (!isInvoiceRecord(item)) return item;
        const portalToken = patches.get(item.id);
        return portalToken ? { ...item, portalToken } : item;
      }),
    });
  }

  return withTokens;
}

function ensureQuotePortalToken(quote: { id: string; ref: string; portalToken?: string }) {
  if (quote.portalToken) return quote.portalToken;
  const portalToken = stablePortalToken(quote.ref, quote.id);
  updateQuote(quote.id, { portalToken });
  return portalToken;
}

export function createClientHubToken(input: ClientHubTokenInput) {
  const customerName = input.customerName.trim();
  if (!customerName) throw new Error("customerName is required");

  const existing = clientPortalHubStore.tokens.find((record) =>
    matchesHubCustomer(record, customerName, input.clientId),
  );
  if (existing) {
    existing.customerName = customerName;
    existing.clientId = input.clientId ?? existing.clientId;
    persist();
    return existing.token;
  }

  const created: ClientHubTokenRecord = {
    token: generateHubToken(customerName),
    clientId: input.clientId?.trim() || undefined,
    customerName,
    createdAt: new Date().toISOString(),
  };
  clientPortalHubStore.tokens = [created, ...clientPortalHubStore.tokens];
  persist();
  return created.token;
}

export function resolveClientHubToken(token: string) {
  const cleaned = token.trim();
  const record = clientPortalHubStore.tokens.find((entry) => entry.token === cleaned);
  if (!record) return null;
  record.lastSeenAt = new Date().toISOString();
  persist();
  return clone(record);
}

export function listHubPayload(token: string): ClientHubPayload | null {
  const hubRecord = resolveClientHubToken(token);
  if (!hubRecord) return null;

  const jobs = getJobs().filter((job) => matchesHubCustomer(hubRecord, job.customer, job.clientId));
  const activeJobs = jobs.filter((job) => !inactiveJobStatuses.has(normalize(job.status)));
  const jobIds = new Set(jobs.map((job) => job.id));
  const jobRefs = new Set(jobs.map((job) => normalize(job.ref)).filter(Boolean));

  const quotes = getQuotes()
    .filter((quote) => matchesHubCustomer(hubRecord, quote.customer, quote.clientId))
    .filter((quote) => openQuoteStatuses.has(normalize(quote.status)))
    .map((quote) => {
      const portalToken = ensureQuotePortalToken(quote);
      return {
        id: quote.id,
        ref: quote.ref,
        description: quote.description,
        status: quote.status,
        value: Number(quote.value) || 0,
        due: quote.due,
        next: quote.next,
        portalToken,
        url: clientPortalUrl("quotes", portalToken),
      };
    });

  const hubState = getHubDetailState();
  const rawInvoices = Array.isArray(hubState.invoices) ? hubState.invoices : [];
  const matchingInvoices = rawInvoices
    .filter(isInvoiceRecord)
    .filter((invoice) => matchesHubCustomer(hubRecord, invoice.customer, invoice.clientId))
    .filter(isOpenInvoice);
  const invoices = ensureInvoicePortalTokens(matchingInvoices).map((invoice) => {
    const chargeTotal = Number(invoice.chargeTotal) || 0;
    const vat = Math.round(chargeTotal * ((Number(invoice.vatRate) || 0) / 100) * 100) / 100;
    const portalToken = invoice.portalToken || stablePortalToken(invoice.ref, invoice.id);
    return {
      id: invoice.id,
      ref: invoice.ref,
      title: invoice.title || "Invoice",
      status: invoice.status || "Sent",
      issuedDate: invoice.issuedDate,
      dueDate: invoice.dueDate,
      chargeTotal,
      vat,
      grandTotal: invoiceGrossTotal(invoice),
      paidAmount: Number(invoice.paidAmount) || 0,
      owed: invoiceOwed(invoice),
      paymentStatus: publicInvoiceStatus(invoice),
      portalToken,
      url: clientPortalUrl("invoices", portalToken),
    };
  });

  const variations = listVariationPortalRequests()
    .filter((variation) => pendingVariationStatuses.has(normalize(variation.status)))
    .filter((variation) => jobIds.has(variation.jobId) || jobRefs.has(normalize(variation.jobRef)))
    .map((variation) => ({
      id: variation.id,
      variationEventId: variation.variationEventId,
      variationRef: `V-${variation.variationEventId.slice(-3).toUpperCase()}`,
      jobId: variation.jobId,
      jobRef: variation.jobRef,
      summary: variation.summary,
      description: variation.description,
      status: variation.status,
      sellValue: Number(variation.sellValue) || 0,
      updatedAt: variation.updatedAt,
      portalToken: variation.token,
      url: clientPortalUrl("variations", variation.token),
    }));

  return {
    token: hubRecord.token,
    clientId: hubRecord.clientId,
    customerName: hubRecord.customerName,
    lastSeenAt: hubRecord.lastSeenAt,
    quotes,
    invoices,
    variations,
    jobs: activeJobs.map((job) => ({
      id: job.id,
      ref: job.ref,
      description: job.description,
      site: job.site,
      status: job.status,
      next: job.next,
      due: job.due,
    })),
  };
}

import {
  addClientRecord,
  addClientSiteRecord,
  appendAuditEvent,
  getClientSites,
  getClients,
  updateClientSiteRecord,
  type ClientRecord,
  type ClientSite,
} from "@/lib/people-data";
import { simproPlainDescription } from "@/lib/simpro-text";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  createJob,
  createQuote,
  getJobs,
  getQuotes,
  removeJob,
  removeQuote,
  updateJob,
  updateQuote,
  type Job,
  type Quote,
  type QuoteStatus,
} from "@/lib/workflow-data";
import { getSimproDirectConfigStatus, resolveSimproDirectConfig, type ResolvedSimproDirectConfig } from "@/lib/simpro-auth";
import { simproGetFirstOk } from "@/lib/simpro-client";
import {
  enrichNexaJobFromSimpro,
  enrichNexaQuoteFromSimpro,
  importSimproInvoiceIntoHub,
  pullSchedulesForLinkedJobs,
} from "@/lib/simpro-deep-import";
import {
  removeSimproEntityLinksByNexa,
  removeSimproEntityLinksByTypes,
  upsertSimproEntityLink,
  type SimproLinkEntityType,
} from "@/lib/simpro-entity-links";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";

type UnknownRecord = Record<string, unknown>;

export type SimproSyncEntity = "clients" | "sites" | "quotes" | "jobs" | "invoices" | "schedules";
export type SimproSyncMode = "preview" | "apply";
export type SimproSyncOperationAction = "create" | "link" | "skip" | "conflict" | "error" | "preview";
export type SimproConflictResolveAction = "link" | "create" | "skip";

export type SimproSyncCandidate = {
  nexaId: string;
  nexaName: string;
  nexaRef?: string;
};

export type SimproSyncOperation = {
  id: string;
  entity: SimproSyncEntity;
  action: SimproSyncOperationAction;
  simproId?: string;
  simproName?: string;
  nexaId?: string;
  nexaRef?: string;
  summary: string;
  detail?: string;
  candidates?: SimproSyncCandidate[];
  seed?: {
    client?: Omit<ClientRecord, "id" | "accountReference" | "status">;
    site?: Omit<ClientSite, "id">;
  };
};

export type SimproSyncRun = {
  id: string;
  mode: SimproSyncMode;
  startedAt: string;
  finishedAt: string;
  actor: string;
  entities: SimproSyncEntity[];
  totals: {
    fetched: number;
    created: number;
    linked: number;
    skipped: number;
    conflicts: number;
    errors: number;
  };
  operations: SimproSyncOperation[];
};

export type SimproSyncLink = {
  id: string;
  nexaType: SimproSyncEntity;
  nexaId: string;
  nexaRef?: string;
  nexaName: string;
  simproType: SimproSyncEntity;
  simproId: string;
  simproName: string;
  lastDirection: "simpro-to-nexa" | "nexa-to-simpro";
  lastSyncedAt: string;
};

export type SimproWebhookEvent = {
  id: string;
  receivedAt: string;
  eventType: string;
  entity?: string;
  simproId?: string;
  status: "Queued" | "Ignored" | "Rejected";
  summary: string;
  payload: unknown;
};

export type SimproSyncStatus = {
  configured: boolean;
  mode: "direct" | "missing";
  missing: string[];
  endpoint?: string;
  detectedEnvKeys: string[];
  checkedAt: string;
  linkCount: number;
  webhookInboxCount: number;
  lastRun?: SimproSyncRun;
  recentRuns: SimproSyncRun[];
};

type SimproSyncStore = {
  links: SimproSyncLink[];
  runs: SimproSyncRun[];
  webhooks: SimproWebhookEvent[];
};

const simproEntities: SimproSyncEntity[] = ["clients", "sites", "quotes", "jobs", "invoices", "schedules"];

const endpointByEntity: Record<Exclude<SimproSyncEntity, "schedules">, string> = {
  clients: "customers",
  sites: "sites",
  quotes: "quotes",
  jobs: "jobs",
  invoices: "invoices",
};

const defaultStore: SimproSyncStore = {
  links: [],
  runs: [],
  webhooks: [],
};

const simproSyncStore = loadServerStore("simpro-sync-store", defaultStore);

function persistStore() {
  writeServerStore("simpro-sync-store", simproSyncStore);
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function detectedSimproEnvKeys() {
  return Object.keys(process.env)
    .filter((key) => key.startsWith("SIMPRO_"))
    .sort();
}

function entityEndpoint(config: ResolvedSimproDirectConfig, entity: Exclude<SimproSyncEntity, "schedules">) {
  return `${config.baseUrl}/companies/${config.companyId}/${endpointByEntity[entity]}/`;
}

function normaliseText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Values that look filled in but are placeholders — never use these for matching. */
export function isPlaceholderSimproValue(value?: string) {
  const normalized = normaliseText(value);
  if (!normalized) return true;
  return /^(to confirm|tbc|n a|na|none|unknown|not set|address to confirm|site to confirm|customer to confirm|imported from simpro|to be scheduled|to be reviewed|pending client|simpro customer|simpro site)$/i.test(
    normalized,
  );
}

export function isUsableEmailForMatch(value?: string) {
  const email = (value ?? "").trim();
  if (!email.includes("@")) return false;
  if (isPlaceholderSimproValue(email)) return false;
  if (/@(example\.|email\.|test\.)/i.test(email) && /redacted|noreply|no-reply|placeholder/i.test(email)) {
    return false;
  }
  return true;
}

function firstString(record: UnknownRecord, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, part) => {
      const object = asRecord(current);
      return object ? object[part] : undefined;
    }, record);
    const text = asString(value);
    if (text) return text;
  }
  return "";
}

function firstNumber(record: UnknownRecord, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, part) => {
      const object = asRecord(current);
      return object ? object[part] : undefined;
    }, record);
    const number = asNumber(value, Number.NaN);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function identifier(record: UnknownRecord) {
  return firstString(record, ["ID", "Id", "id", "QuoteID", "JobID", "CustomerID", "SiteID", "InvoiceID"]);
}

function joinAddress(value: unknown) {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  return [
    firstString(record, ["Address", "StreetAddress", "Street", "Line1"]),
    firstString(record, ["Line2", "Suburb"]),
    firstString(record, ["City", "Town"]),
    firstString(record, ["State", "County"]),
    firstString(record, ["PostalCode", "Postcode", "ZipCode"]),
  ]
    .filter(Boolean)
    .join(", ");
}

/** Site / works address only — never customer Billing/Postal (that caused every quote to show the same address). */
export function siteAddressFromRecord(record: UnknownRecord) {
  const site = asRecord(record.Site);
  if (site) {
    const nested =
      joinAddress(site.Address) ||
      joinAddress(site.SiteAddress) ||
      joinAddress(site) ||
      firstString(site, ["Address", "SiteAddress", "Location"]);
    if (nested && !isPlaceholderSimproValue(nested)) return nested;
  }
  const direct =
    joinAddress(record.SiteAddress) ||
    firstString(record, ["SiteAddress", "Site.Address", "Location"]) ||
    // Only use top-level Address when this record IS a site (has no nested Site id pointing elsewhere).
    (!simproSiteId(record) ? joinAddress(record.Address) || firstString(record, ["Address"]) : "");
  return direct && !isPlaceholderSimproValue(direct) ? direct : "";
}

/** Customer billing / postal — for client records only. */
export function billingAddressFromRecord(record: UnknownRecord) {
  return (
    joinAddress(record.BillingAddress) ||
    joinAddress(record.PostalAddress) ||
    joinAddress(record.Address) ||
    firstString(record, ["BillingAddress", "PostalAddress", "Address"]) ||
    ""
  );
}

/** @deprecated Prefer siteAddressFromRecord / billingAddressFromRecord — kept for call sites that want either. */
function addressFromRecord(record: UnknownRecord) {
  return siteAddressFromRecord(record) || billingAddressFromRecord(record);
}

function scalarId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function simproSiteId(record: UnknownRecord) {
  const nested = asRecord(record.Site);
  if (nested) {
    const nestedId = firstString(nested, ["ID", "Id", "id"]);
    if (nestedId) return nestedId;
  }
  const bare = scalarId(record.Site);
  if (bare) return bare;
  return firstString(record, ["Site.ID", "Site.Id", "Site.id", "SiteID", "SiteId"]);
}

function simproSiteName(record: UnknownRecord) {
  const nested = asRecord(record.Site);
  if (nested) {
    const name = firstString(nested, ["Name", "SiteName", "DisplayName"]);
    if (name) return name;
  }
  return firstString(record, ["Site.Name", "SiteName"]);
}

export function jobStatusFromSimpro(value: string): string {
  const status = normaliseText(value);
  if (!status) return "Pending";
  if (status.includes("ready to invoice") || status === "invoiced") return status.includes("ready") ? "Ready to invoice" : "Invoiced";
  if (status.includes("invoice")) return "Ready to invoice";
  if (status.includes("complete") || status.includes("finished") || status === "done") return "Completed";
  if (status.includes("closed") || status.includes("archiv")) return "Closed";
  if (status.includes("schedul")) return "Scheduled";
  if (status.includes("progress") || status.includes("active") || status.includes("on site")) return "In progress";
  if (status.includes("wait") && status.includes("part")) return "Waiting on parts";
  if (status.includes("wait") && status.includes("customer")) return "Waiting on customer";
  if (status.includes("approv")) return "Approval required";
  if (status.includes("accept")) return "Accepted";
  if (status.includes("quot")) return "Quoted";
  if (status.includes("enquir")) return "Enquiry";
  if (status.includes("pending") || status.includes("new") || status.includes("open") || status.includes("import")) {
    return "Pending";
  }
  return "Pending";
}

function simproStageOrStatus(record: UnknownRecord) {
  return firstString(record, ["Stage", "Stage.Name", "Status.Name", "Status"]);
}

/** Open quotes only — exclude archived / lost / declined / converted / closed. */
export function isOpenSimproQuote(record: UnknownRecord) {
  if (record.Archived === true || record.IsArchived === true) return false;
  const stage = normaliseText(firstString(record, ["Stage", "Stage.Name"]));
  const status = normaliseText(firstString(record, ["Status.Name", "Status"]));
  const combined = `${stage} ${status}`.trim();
  if (!combined) return true;
  if (/(archiv|closed|lost|declin|reject|convert|won)/.test(combined)) return false;
  if (stage === "complete" || stage === "completed") return false;
  const mapped = quoteStatusFromSimpro(simproStageOrStatus(record));
  return mapped === "Draft" || mapped === "Sent" || mapped === "Accepted";
}

/** Pending, Progress, and Complete jobs — exclude Invoiced / Archived / Closed. */
export function isImportableSimproJob(record: UnknownRecord) {
  if (record.Archived === true || record.IsArchived === true) return false;
  const stage = normaliseText(firstString(record, ["Stage", "Stage.Name"]));
  const status = normaliseText(firstString(record, ["Status.Name", "Status"]));

  if (stage === "invoiced" || stage === "archived") return false;
  if (status === "invoiced" || status.includes("archiv") || status.includes("closed")) return false;

  const value = stage || status;
  if (!value) return true;

  // Explicit allow-list for the three simPRO job folders the user wants.
  if (/(pending|new|import|open|schedul)/.test(value)) return true;
  if (/(progress|active|on site|wait)/.test(value)) return true;
  if (/(complete|finish|done|ready to invoice)/.test(value)) return true;

  const mapped = jobStatusFromSimpro(value);
  return [
    "Pending",
    "In progress",
    "Scheduled",
    "Waiting on parts",
    "Waiting on customer",
    "Approval required",
    "Completed",
    "Ready to invoice",
  ].includes(mapped);
}

/** Unpaid / part-paid invoices only — ignore paid, voided, cancelled. */
export function isUnpaidSimproInvoice(record: UnknownRecord) {
  if (record.IsPaid === true) return false;
  if (record.IsVoided === true) return false;
  const status = normaliseText(firstString(record, ["Status.Name", "Status", "Stage.Name", "Stage"]));
  if (status.includes("cancel") || status.includes("void")) return false;
  if (status.includes("paid") && !status.includes("part") && !status.includes("unpaid")) return false;
  const paid = firstNumber(record, ["Total.Paid", "AmountPaid", "Paid"]);
  const total = firstNumber(record, ["Total.IncTax", "Total.ExTax", "Amount.IncTax", "Amount", "Total"]);
  if (total > 0 && paid >= total) return false;
  return true;
}

function invoiceIssuedTime(record: UnknownRecord) {
  const raw = firstString(record, ["DateIssued", "IssuedDate", "Date", "DateModified", "CreatedDate"]);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

export const SIMPRO_INVOICE_IMPORT_LIMIT = 30;
/** Keep quote/job Apply inside Render memory/time limits. */
export const SIMPRO_QUOTE_IMPORT_LIMIT = 20;
export const SIMPRO_JOB_IMPORT_LIMIT = 20;
/** Bulk client/site directory imports must stay small — uncapped 40×250 was crashing Apply. */
export const SIMPRO_CLIENT_IMPORT_LIMIT = 80;
export const SIMPRO_SITE_IMPORT_LIMIT = 80;
/**
 * Cost-centre hydrate per Apply. Quotes that already have centres skip the budget,
 * so re-Apply fills the rest without OOM. Kept equal to quote/job caps.
 */
export const SIMPRO_DEEP_HIERARCHY_LIMIT = 20;

function recordModifiedTime(record: UnknownRecord) {
  const raw = firstString(record, ["DateModified", "DateIssued", "DateCreated", "CreatedDate", "DueDate"]);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

/** Apply live working-set rules so we don't import archive/history that crashes the app. */
export function scopeSimproRecords(entity: Exclude<SimproSyncEntity, "schedules">, records: UnknownRecord[]) {
  if (entity === "quotes") {
    return records
      .filter(isOpenSimproQuote)
      .sort((left, right) => recordModifiedTime(right) - recordModifiedTime(left))
      .slice(0, SIMPRO_QUOTE_IMPORT_LIMIT);
  }
  if (entity === "jobs") {
    return records
      .filter(isImportableSimproJob)
      .sort((left, right) => recordModifiedTime(right) - recordModifiedTime(left))
      .slice(0, SIMPRO_JOB_IMPORT_LIMIT);
  }
  if (entity === "invoices") {
    return records
      .filter(isUnpaidSimproInvoice)
      .sort((left, right) => invoiceIssuedTime(right) - invoiceIssuedTime(left))
      .slice(0, SIMPRO_INVOICE_IMPORT_LIMIT);
  }
  if (entity === "clients") {
    return records
      .sort((left, right) => recordModifiedTime(right) - recordModifiedTime(left) || Number(identifier(right) || 0) - Number(identifier(left) || 0))
      .slice(0, SIMPRO_CLIENT_IMPORT_LIMIT);
  }
  if (entity === "sites") {
    return records
      .sort((left, right) => recordModifiedTime(right) - recordModifiedTime(left) || Number(identifier(right) || 0) - Number(identifier(left) || 0))
      .slice(0, SIMPRO_SITE_IMPORT_LIMIT);
  }
  return records;
}

function matchingSiteForRecord(record: UnknownRecord, clientId: string | undefined) {
  const externalId = simproSiteId(record);
  if (externalId) {
    const link = existingLink("sites", externalId);
    if (link) {
      const linked = getClientSites().find((item) => item.id === link.nexaId);
      if (linked) return linked;
    }
    // Prefer the deterministic simPRO site id so two quotes never collapse onto one wrong site.
    const byId = getClientSites().find((item) => item.id === `site-simpro-${externalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    if (byId) return byId;
  }

  const address = siteAddressFromRecord(record);
  // Only address match — name-only match was linking every quote for a customer to one site.
  if (!address || isPlaceholderSimproValue(address)) return undefined;
  const candidates = getClientSites().filter((item) => {
    if (clientId && item.clientId !== clientId) return false;
    return normaliseText(item.address) === normaliseText(address);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function refreshSiteFromRecord(existing: ClientSite, record: UnknownRecord) {
  const address = siteAddressFromRecord(record);
  const name = simproSiteName(record) || firstString(asRecord(record.Site) ?? record, ["Name", "SiteName", "DisplayName"]);
  const patch: Partial<ClientSite> = {};
  if (address && !isPlaceholderSimproValue(address) && (isPlaceholderSimproValue(existing.address) || existing.address !== address)) {
    patch.address = address;
  }
  if (name && !isPlaceholderSimproValue(name) && (isPlaceholderSimproValue(existing.name) || existing.name === "simPRO site")) {
    patch.name = name;
  }
  if (!Object.keys(patch).length) return existing;
  return updateClientSiteRecord(existing.id, patch) || existing;
}

function ensureSiteForRecord(record: UnknownRecord, clientId: string | undefined, mode: SimproSyncMode) {
  const existing = matchingSiteForRecord(record, clientId);
  if (existing) {
    return mode === "apply" ? refreshSiteFromRecord(existing, record) : existing;
  }
  if (mode !== "apply" || !clientId) return undefined;

  const externalId = simproSiteId(record);
  const nested = asRecord(record.Site) ?? {};
  const mapped = siteFromSimpro(
    {
      ...nested,
      ID: externalId || nested.ID,
      Name: simproSiteName(record) || nested.Name,
      Address: nested.Address || record.SiteAddress,
      Customer: asRecord(record.Customer) ?? { ID: simproCustomerId(record) },
    },
    clientId,
  );

  // Never invent an address from site name / billing — leave placeholder until site hydrate fills it.
  const site = addClientSiteRecord({
    ...mapped,
    id: externalId
      ? `site-simpro-${externalId.replace(/[^a-zA-Z0-9_-]/g, "-")}`
      : `site-simpro-auto-${crypto.randomUUID()}`,
  });
  if (externalId) {
    saveLink({
      nexaType: "sites",
      nexaId: site.id,
      nexaName: site.name,
      simproType: "sites",
      simproId: externalId,
      simproName: site.name,
      lastDirection: "simpro-to-nexa",
    });
  }
  return site;
}

function extractRecords(body: unknown) {
  if (Array.isArray(body)) return body.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  const record = asRecord(body);
  if (!record) return [];
  for (const key of ["data", "items", "results", "Results", "Records", "records"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  return [];
}

async function fetchSimproRecords(config: ResolvedSimproDirectConfig, entity: Exclude<SimproSyncEntity, "schedules">) {
  // Keep ceilings modest — full history imports were crashing the app.
  // Quotes/jobs/invoices/clients/sites are filtered after fetch to the live working set.
  const pageSize = 100;
  const maxPages =
    entity === "invoices"
      ? 6
      : entity === "quotes" || entity === "jobs"
        ? 8
        : entity === "clients" || entity === "sites"
          ? 3
          : 10;

  const url = new URL(entityEndpoint(config, entity));
  url.searchParams.set("pageSize", String(pageSize));
  if (entity === "invoices") {
    url.searchParams.set("orderby", "-DateIssued");
    url.searchParams.set("IsPaid", "false");
  } else if (entity === "quotes" || entity === "jobs") {
    url.searchParams.set("orderby", "-DateModified");
    // Ask simPRO for nested customer/site fields — list payloads often only return Customer.ID.
    url.searchParams.set(
      "columns",
      "ID,Name,Description,Customer,Site,Total,Status,Stage,DateIssued,DateModified,DateCreated,DueDate,ProjectManager,Salesperson,Archived",
    );
  } else if (entity === "clients" || entity === "sites") {
    // Newest first so the 80-record cap is useful; fall back to -ID if DateModified rejected.
    url.searchParams.set("orderby", "-DateModified");
  } else {
    url.searchParams.set("orderby", "ID");
  }

  const collected: UnknownRecord[] = [];
  const seenIds = new Set<string>();
  let reportedTotal = 0;
  let reportedPages = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      // IsPaid filter is not supported on every build — retry invoices without it.
      if (entity === "invoices" && page === 1 && url.searchParams.has("IsPaid")) {
        url.searchParams.delete("IsPaid");
        page = 0;
        continue;
      }
      // Some builds reject rich columns — fall back to default list fields.
      if ((entity === "quotes" || entity === "jobs") && page === 1 && url.searchParams.has("columns")) {
        url.searchParams.delete("columns");
        page = 0;
        continue;
      }
      // Some builds reject -DateModified on customers/sites — fall back to -ID.
      if (
        (entity === "clients" || entity === "sites") &&
        page === 1 &&
        url.searchParams.get("orderby") === "-DateModified"
      ) {
        url.searchParams.set("orderby", "-ID");
        page = 0;
        continue;
      }
      const message = firstString(asRecord(body) ?? {}, ["error", "message"]) || `simPRO returned HTTP ${response.status}`;
      throw new Error(message);
    }

    const records = extractRecords(body);
    for (const record of records) {
      const id = identifier(record);
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      collected.push(record);
    }

    reportedTotal = Number(
      response.headers.get("Result-Total") || response.headers.get("result-total") || reportedTotal || 0,
    );
    reportedPages = Number(
      response.headers.get("Result-Pages") || response.headers.get("result-pages") || reportedPages || 0,
    );

    // Newest-first lists: stop once we already have enough for the working set.
    if (entity === "invoices") {
      const unpaidSoFar = collected.filter(isUnpaidSimproInvoice).length;
      if (unpaidSoFar >= SIMPRO_INVOICE_IMPORT_LIMIT) break;
    }
    if (entity === "quotes") {
      const openSoFar = collected.filter(isOpenSimproQuote).length;
      if (openSoFar >= SIMPRO_QUOTE_IMPORT_LIMIT) break;
    }
    if (entity === "jobs") {
      const liveSoFar = collected.filter(isImportableSimproJob).length;
      if (liveSoFar >= SIMPRO_JOB_IMPORT_LIMIT) break;
    }
    if (entity === "clients" && collected.length >= SIMPRO_CLIENT_IMPORT_LIMIT) break;
    if (entity === "sites" && collected.length >= SIMPRO_SITE_IMPORT_LIMIT) break;

    if (records.length === 0) break;
    if (records.length < pageSize) break;
    if (reportedTotal > 0 && collected.length >= reportedTotal) break;
    if (reportedPages > 0 && page >= reportedPages) break;
  }

  // Scope first, then hydrate customers + sites only for the capped working set.
  const scoped = scopeSimproRecords(entity, collected);
  if (entity === "quotes" || entity === "jobs") {
    const withCustomers = await hydrateCustomersForRecords(config, scoped);
    return hydrateSitesForRecords(config, withCustomers);
  }
  return scoped;
}

function existingLink(entity: SimproSyncEntity, simproId: string) {
  return simproSyncStore.links.find((link) => link.simproType === entity && link.simproId === simproId);
}

function syncEntityToLinkType(entity: SimproSyncEntity): SimproLinkEntityType | null {
  if (entity === "clients") return "client";
  if (entity === "sites") return "site";
  if (entity === "quotes") return "quote";
  if (entity === "jobs") return "job";
  if (entity === "invoices") return "invoice";
  return null;
}

function saveLink(link: Omit<SimproSyncLink, "id" | "lastSyncedAt">) {
  const existing = existingLink(link.simproType, link.simproId);
  const next: SimproSyncLink = {
    ...link,
    id: existing?.id ?? `simpro-link-${crypto.randomUUID()}`,
    lastSyncedAt: new Date().toISOString(),
  };
  simproSyncStore.links = [next, ...simproSyncStore.links.filter((item) => item.id !== next.id)];

  const entityType = syncEntityToLinkType(link.nexaType);
  const companyId = getSimproDirectConfigStatus().companyId;
  if (entityType && companyId && link.nexaId && link.simproId) {
    try {
      upsertSimproEntityLink({
        companyId,
        entityType,
        externalId: link.simproId,
        nexaId: link.nexaId,
        nexaRef: link.nexaRef,
        nexaName: link.nexaName,
        importedReadOnly: true,
      });
    } catch {
      // Shallow link still saved; durable entity-link is best-effort when company id missing/invalid.
    }
  }
  return next;
}

export function findSimproLinkForNexa(entity: SimproSyncEntity, nexaId?: string) {
  if (!nexaId?.trim()) return undefined;
  return simproSyncStore.links.find((link) => link.nexaType === entity && link.nexaId === nexaId);
}

/** Drop shallow + durable links for a deleted NeXa record so re-import can create again. */
export function clearSimproLinksForNexaRecord(entity: SimproSyncEntity, nexaId: string) {
  const id = nexaId.trim();
  if (!id) return { syncLinksRemoved: 0, entityLinksRemoved: 0 };
  const before = simproSyncStore.links.length;
  simproSyncStore.links = simproSyncStore.links.filter(
    (link) => !(link.nexaType === entity && link.nexaId === id),
  );
  const syncLinksRemoved = before - simproSyncStore.links.length;
  const entityType = syncEntityToLinkType(entity);
  const entityLinksRemoved = entityType
    ? removeSimproEntityLinksByNexa({ nexaId: id, entityTypes: [entityType] })
    : 0;
  if (syncLinksRemoved > 0) persistStore();
  return { syncLinksRemoved, entityLinksRemoved };
}

function nexaRecordExistsForLink(link: SimproSyncLink): boolean {
  if (link.nexaType === "quotes") return Boolean(getQuotes().find((quote) => quote.id === link.nexaId));
  if (link.nexaType === "jobs") return Boolean(getJobs().find((job) => job.id === link.nexaId));
  if (link.nexaType === "clients") return Boolean(getClients().find((client) => client.id === link.nexaId));
  if (link.nexaType === "sites") return Boolean(getClientSites().find((site) => site.id === link.nexaId));
  return true;
}

/** If a sync link points at a deleted NeXa row, remove it so import can create fresh. */
function pruneOrphanLink(entity: SimproSyncEntity, simproId: string): SimproSyncLink | undefined {
  const link = existingLink(entity, simproId);
  if (!link) return undefined;
  if (nexaRecordExistsForLink(link)) return link;
  clearSimproLinksForNexaRecord(link.nexaType, link.nexaId);
  // Also drop by simPRO id in case nexaType mismatched.
  simproSyncStore.links = simproSyncStore.links.filter(
    (item) => !(item.simproType === entity && item.simproId === simproId),
  );
  persistStore();
  return undefined;
}

export function upsertSimproLink(link: Omit<SimproSyncLink, "id" | "lastSyncedAt">) {
  const saved = saveLink(link);
  persistStore();
  return saved;
}

function operation(
  entity: SimproSyncEntity,
  action: SimproSyncOperationAction,
  summary: string,
  input: Partial<SimproSyncOperation> = {},
): SimproSyncOperation {
  return {
    id: `simpro-op-${crypto.randomUUID()}`,
    entity,
    action,
    summary,
    ...input,
  };
}

function clientFromSimpro(record: UnknownRecord): Omit<ClientRecord, "id" | "accountReference" | "status"> {
  const name = usableCustomerName(record) || fallbackCustomerLabel(identifier(record));
  return {
    name,
    primaryContact: firstString(record, ["PrimaryContact.Name", "Contact.Name", "Contact", "Attention"]) || name,
    email: firstString(record, ["Email", "EmailAddress", "PrimaryContact.Email", "Contact.Email"]) || "To confirm",
    phone: firstString(record, ["Phone", "PhoneNumber", "Mobile", "PrimaryContact.Phone", "Contact.Phone"]) || "To confirm",
    billingAddress: billingAddressFromRecord(record) || "Address to confirm",
    commercialOwner: "Imported from simPRO",
    notes: "Imported from simPRO. Review customer details before using on live documents.",
  };
}

function siteFromSimpro(record: UnknownRecord, clientId: string): Omit<ClientSite, "id"> {
  const address = siteAddressFromRecord(record) || "Address to confirm";
  const name =
    firstString(record, ["Name", "SiteName", "DisplayName"]) ||
    simproSiteName(record) ||
    (address !== "Address to confirm" ? address.split(",")[0]?.trim() : "") ||
    "simPRO site";
  return {
    clientId,
    name,
    address,
    accessNotes: firstString(record, ["Notes", "AccessNotes", "Instructions"]) || "Imported from simPRO. Access notes to confirm.",
    primaryContact: firstString(record, ["Contact.Name", "PrimaryContact.Name", "Contact"]) || "To confirm",
    serviceLine: firstString(record, ["ServiceLine"]) || "Imported simPRO site",
    nextVisit: firstString(record, ["NextVisit", "NextServiceDate"]) || "To be scheduled",
  };
}

function quoteStatusFromSimpro(value: string): QuoteStatus {
  const status = normaliseText(value);
  if (status.includes("accept") || status.includes("approved")) return "Accepted";
  if (status.includes("declin") || status.includes("reject")) return "Declined";
  if (status.includes("lost")) return "Lost";
  if (status.includes("sent") || status.includes("issued")) return "Sent";
  return "Draft";
}

function findClientByNameOrEmail(name: string, email?: string) {
  const normalizedName = normaliseText(name);
  const canUseEmail = isUsableEmailForMatch(email);
  const normalizedEmail = canUseEmail ? normaliseText(email) : "";
  const canUseName = Boolean(normalizedName) && !isPlaceholderSimproValue(name);

  return getClients().filter((client) => {
    if (canUseEmail && isUsableEmailForMatch(client.email) && normaliseText(client.email) === normalizedEmail) {
      return true;
    }
    if (!canUseName) return false;
    return normaliseText(client.name) === normalizedName;
  });
}

function findSiteMatch(clientId: string | undefined, site: Omit<ClientSite, "id">) {
  const canUseAddress = Boolean(site.address) && !isPlaceholderSimproValue(site.address);
  const canUseName = Boolean(site.name) && !isPlaceholderSimproValue(site.name);
  const normalizedAddress = canUseAddress ? normaliseText(site.address) : "";
  const normalizedName = canUseName ? normaliseText(site.name) : "";
  if (!normalizedAddress && !normalizedName) return [];

  return getClientSites().filter((existing) => {
    if (clientId && existing.clientId !== clientId) return false;
    if (normalizedAddress && normaliseText(existing.address) === normalizedAddress) return true;
    if (normalizedName && normaliseText(existing.name) === normalizedName) return true;
    return false;
  });
}

function simproCustomerId(record: UnknownRecord) {
  const nested = asRecord(record.Customer);
  if (nested) {
    const nestedId = firstString(nested, ["ID", "Id", "id"]);
    if (nestedId) return nestedId;
  }
  const bare = scalarId(record.Customer) || scalarId(record.Client);
  if (bare) return bare;
  return firstString(record, ["Customer.ID", "Customer.Id", "Customer.id", "CustomerID", "ClientID", "Client.ID"]);
}

function customerNameFromFields(record: UnknownRecord) {
  return (
    firstString(record, ["CompanyName", "Name", "DisplayName", "CustomerName"]) ||
    [firstString(record, ["GivenName", "FirstName"]), firstString(record, ["FamilyName", "LastName"])]
      .filter(Boolean)
      .join(" ")
  );
}

function simproCustomerName(record: UnknownRecord) {
  const nested = asRecord(record.Customer);
  if (nested) {
    const nestedName = customerNameFromFields(nested);
    if (nestedName && !isPlaceholderSimproValue(nestedName)) return nestedName;
  }
  const flat = firstString(record, ["Customer.CompanyName", "Customer.Name", "CustomerName", "Client.Name"]);
  if (flat && !isPlaceholderSimproValue(flat)) return flat;
  return "";
}

function usableCustomerName(record: UnknownRecord) {
  const nestedName = simproCustomerName(record);
  if (nestedName) return nestedName;
  // Quote/job rows use top-level Name as the quote/job title — never treat that as the customer.
  if (record.Customer != null || record.Site != null || record.Total != null || record.Stage != null) {
    return "";
  }
  const name = customerNameFromFields(record);
  if (!name || isPlaceholderSimproValue(name)) return "";
  return name;
}

function fallbackCustomerLabel(simproId?: string) {
  return simproId ? `Customer ${simproId}` : "Customer to confirm";
}

function isBlankImportedCustomerName(value?: string) {
  const normalized = normaliseText(value);
  return !normalized || normalized === "simpro customer" || normalized === "customer to confirm" || isPlaceholderSimproValue(value);
}

/** Per-import cache so quote/job rows that only carry Customer.ID still get real names. */
const customerDetailCache = new Map<string, UnknownRecord | null>();

/** Caps full section/CC hydrate per Apply run — each one can be dozens of simPRO HTTP calls. */
let deepHierarchyBudget = SIMPRO_DEEP_HIERARCHY_LIMIT;

function clearCustomerDetailCache() {
  customerDetailCache.clear();
  clearSiteDetailCache();
  clearEntityDetailCache();
}

function resetDeepHierarchyBudget() {
  deepHierarchyBudget = SIMPRO_DEEP_HIERARCHY_LIMIT;
}

function takeDeepHierarchySlot() {
  if (deepHierarchyBudget <= 0) return false;
  deepHierarchyBudget -= 1;
  return true;
}

async function fetchSimproCustomerDetail(config: ResolvedSimproDirectConfig, customerId: string) {
  const cached = customerDetailCache.get(customerId);
  if (cached !== undefined) return cached;

  // Two display=all paths cover company + individual customers on most tenants.
  // Use simproGetFirstOk so 429/5xx retry the same way as quote detail / deep-import.
  const paths = [
    `/customers/${customerId}/?display=all`,
    `/customers/companies/${customerId}/?display=all`,
    `/customers/individuals/${customerId}/?display=all`,
  ];

  const result = await simproGetFirstOk(config, paths, { maxRetries: 2 });
  if (result.ok) {
    const record = asRecord(result.body);
    if (record && (identifier(record) || customerNameFromFields(record))) {
      customerDetailCache.set(customerId, record);
      return record;
    }
  }

  customerDetailCache.set(customerId, null);
  return null;
}

function mergeCustomerOntoRecord(record: UnknownRecord, customer: UnknownRecord) {
  const existing = asRecord(record.Customer) || {};
  return {
    ...record,
    Customer: {
      ...existing,
      ...customer,
      ID: identifier(customer) || existing.ID || simproCustomerId(record),
    },
  };
}

async function hydrateRecordCustomer(config: ResolvedSimproDirectConfig, record: UnknownRecord) {
  if (usableCustomerName(record)) return record;
  const customerId = simproCustomerId(record);
  if (!customerId) return record;
  const detail = await fetchSimproCustomerDetail(config, customerId);
  if (!detail) return record;
  return mergeCustomerOntoRecord(record, detail);
}

/** Full quote/job detail cache — list rows often omit Customer/Site entirely. */
const entityDetailCache = new Map<string, UnknownRecord | null>();

function clearEntityDetailCache() {
  entityDetailCache.clear();
}

async function fetchSimproEntityDetail(
  config: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  externalId: string,
) {
  const cacheKey = `${entity}:${externalId}`;
  const cached = entityDetailCache.get(cacheKey);
  // Only reuse successful detail — never poison the Apply run with a cached null from one 429.
  if (cached) return cached;

  // Same auth/base URL as deep-import (`getSimproReadConfig` → `resolveSimproDirectConfig`),
  // but previously this used raw fetch with no 429/5xx retries and silently cached null.
  // That left list-only headers ("Quote 2217", "Customer to confirm") while list fetch still worked.
  const result = await simproGetFirstOk(
    config,
    [`/${entity}/${externalId}/?display=all`, `/${entity}/${externalId}/`],
    { maxRetries: 3 },
  );
  if (!result.ok) return null;
  const record = asRecord(result.body);
  if (!record || !identifier(record)) return null;
  entityDetailCache.set(cacheKey, record);
  return record;
}

function mergeEntityDetailOntoRecord(record: UnknownRecord, detail: UnknownRecord) {
  const detailCustomer = asRecord(detail.Customer) ?? detail.Customer;
  const detailSite = asRecord(detail.Site) ?? detail.Site;
  return {
    ...record,
    ...detail,
    // Keep list Total/Status if detail omits them, but prefer detail Customer/Site/Name.
    Customer: detailCustomer ?? record.Customer,
    Site: detailSite ?? record.Site,
    Name: detail.Name ?? record.Name,
    Description: detail.Description ?? record.Description,
    ID: detail.ID ?? record.ID ?? identifier(record),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hydrateQuoteOrJobRecordForImport(
  config: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  record: UnknownRecord,
) {
  const externalId = identifier(record);
  if (!externalId) return record;

  // Always pull display=all for Apply — list payloads regularly omit Customer/Site.
  let detail = await fetchSimproEntityDetail(config, entity, externalId);
  if (!detail) {
    // One recovery pause for rate-limit storms, then retry without a cached null.
    await sleep(750);
    entityDetailCache.delete(`${entity}:${externalId}`);
    detail = await fetchSimproEntityDetail(config, entity, externalId);
  }
  let next = detail ? mergeEntityDetailOntoRecord(record, detail) : record;
  next = await hydrateRecordCustomer(config, next);
  next = await hydrateRecordSite(config, next);
  return next;
}

async function hydrateCustomersForRecords(config: ResolvedSimproDirectConfig, records: UnknownRecord[]) {
  const missingIds = [
    ...new Set(
      records
        .filter((record) => !usableCustomerName(record))
        .map((record) => simproCustomerId(record))
        .filter(Boolean),
    ),
  ] as string[];

  // Low concurrency — Render + simPRO both choke on bursty parallel customer lookups.
  for (let index = 0; index < missingIds.length; index += 2) {
    const batch = missingIds.slice(index, index + 2);
    await Promise.all(batch.map((id) => fetchSimproCustomerDetail(config, id)));
  }

  return records.map((record) => {
    if (usableCustomerName(record)) return record;
    const customerId = simproCustomerId(record);
    if (!customerId) return record;
    const detail = customerDetailCache.get(customerId);
    return detail ? mergeCustomerOntoRecord(record, detail) : record;
  });
}

/** Per-import cache so quote/job rows that only carry Site.ID still get real site addresses. */
const siteDetailCache = new Map<string, UnknownRecord | null>();

function clearSiteDetailCache() {
  siteDetailCache.clear();
}

async function fetchSimproSiteDetail(config: ResolvedSimproDirectConfig, siteId: string) {
  const cached = siteDetailCache.get(siteId);
  if (cached !== undefined) return cached;

  const result = await simproGetFirstOk(
    config,
    [`/sites/${siteId}/?display=all`, `/sites/${siteId}/`],
    { maxRetries: 2 },
  );
  if (result.ok) {
    const record = asRecord(result.body);
    if (record && (identifier(record) || siteAddressFromRecord(record) || simproSiteName(record))) {
      siteDetailCache.set(siteId, record);
      return record;
    }
  }

  siteDetailCache.set(siteId, null);
  return null;
}

function mergeSiteOntoRecord(record: UnknownRecord, site: UnknownRecord) {
  const existing = asRecord(record.Site) || {};
  return {
    ...record,
    Site: {
      ...existing,
      ...site,
      ID: identifier(site) || existing.ID || simproSiteId(record),
    },
  };
}

function siteNeedsHydrate(record: UnknownRecord) {
  if (!simproSiteId(record)) return false;
  return !siteAddressFromRecord(record);
}

async function hydrateSitesForRecords(config: ResolvedSimproDirectConfig, records: UnknownRecord[]) {
  const missingIds = [
    ...new Set(records.filter(siteNeedsHydrate).map((record) => simproSiteId(record)).filter(Boolean)),
  ] as string[];

  for (let index = 0; index < missingIds.length; index += 2) {
    const batch = missingIds.slice(index, index + 2);
    await Promise.all(batch.map((id) => fetchSimproSiteDetail(config, id)));
  }

  return records.map((record) => {
    const siteId = simproSiteId(record);
    if (!siteId || !siteNeedsHydrate(record)) return record;
    const detail = siteDetailCache.get(siteId);
    return detail ? mergeSiteOntoRecord(record, detail) : record;
  });
}

function matchingClientIdForRecord(record: UnknownRecord) {
  const externalId = simproCustomerId(record);
  if (externalId) {
    const link = existingLink("clients", externalId);
    if (link) return link.nexaId;
  }
  const name = usableCustomerName(record);
  if (!name) return undefined;
  const matches = findClientByNameOrEmail(name);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function resolveClientForRecord(record: UnknownRecord, mode: SimproSyncMode) {
  let clientId = matchingClientIdForRecord(record);
  let client = clientId ? getClients().find((item) => item.id === clientId) : undefined;

  // Quote/job list rows often only have Customer.ID (sometimes as a bare number).
  // Create/link the NeXa customer so the quote does not land as "Customer to confirm".
  if (!client && mode === "apply") {
    const customerId = simproCustomerId(record);
    const cached = customerId ? customerDetailCache.get(customerId) : null;
    const customerRecord =
      asRecord(record.Customer) ||
      cached ||
      (customerId ? { ID: customerId, CompanyName: usableCustomerName(record) || fallbackCustomerLabel(customerId) } : null);
    if (customerRecord && (identifier(customerRecord) || customerId)) {
      const result = processClient(
        {
          ...customerRecord,
          ID: identifier(customerRecord) || customerId,
        },
        mode,
      );
      if (result.nexaId) {
        clientId = result.nexaId;
        client = getClients().find((item) => item.id === result.nexaId);
      }
    }
  }

  if (!client && clientId) {
    client = getClients().find((item) => item.id === clientId);
  }
  return { clientId, client };
}

function descriptionFromSimproRecord(record: UnknownRecord, fallback: string) {
  const title = firstString(record, ["Name", "Title", "Subject", "JobName"]);
  const body = firstString(record, ["Description", "Notes", "LongDescription"]);
  const plain = simproPlainDescription({ title, body }, fallback, { maxLength: 72, preferTitle: true });
  // Email-style descriptions without a Name look like "Hi Lesley…" — use a short quote label instead.
  if (!title && /^(hi|hello|dear)\b/i.test(plain)) {
    const id = identifier(record);
    return id ? `Quote ${id}` : fallback;
  }
  return plain;
}

function dueLabelFromSimpro(record: UnknownRecord, keys: string[]) {
  const raw = firstString(record, keys);
  if (!raw) return "Imported";
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return raw;
  return new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function buildQuoteInput(record: UnknownRecord, client?: ClientRecord, site?: ClientSite): Omit<Quote, "id" | "ref"> {
  const simproStatus = firstString(record, ["Status.Name", "Status", "Stage", "Stage.Name"]);
  const status = quoteStatusFromSimpro(simproStatus);
  const customerName =
    (client?.name && !isBlankImportedCustomerName(client.name) ? client.name : "") ||
    usableCustomerName(record) ||
    fallbackCustomerLabel(simproCustomerId(record));
  return {
    clientId: client?.id,
    siteId: site?.id,
    customer: customerName,
    description: descriptionFromSimproRecord(record, "Imported simPRO quote"),
    owner: firstString(record, ["Salesperson.Name", "Owner.Name", "ProjectManager.Name"]) || "Imported from simPRO",
    status,
    value: firstNumber(record, [
      "Total.ExTax",
      "Total.IncTax",
      "TotalExTax",
      "TotalIncTax",
      "TotalPrice",
      "Price",
      "Value",
      "Amount",
      "Total",
    ]),
    next:
      status === "Accepted"
        ? "Convert to job"
        : status === "Sent"
          ? "Await customer response"
          : "Review imported quote",
    due: dueLabelFromSimpro(record, ["DueDate", "DateIssued", "DateCreated", "CreatedDate"]),
    simproQuoteId: identifier(record),
    simproStatus: "Sent",
    simproSentAt: new Date().toISOString(),
  };
}

export function buildJobInput(record: UnknownRecord, client?: ClientRecord, site?: ClientSite): Omit<Job, "id" | "ref" | "health"> & { simproJobId?: string } {
  const simproStatus = firstString(record, ["Status.Name", "Status", "Stage", "Stage.Name"]);
  const siteLabel =
    (site?.address && !isPlaceholderSimproValue(site.address) ? site.address : "") ||
    siteAddressFromRecord(record) ||
    (site?.name && !isPlaceholderSimproValue(site.name) ? site.name : "") ||
    simproSiteName(record) ||
    firstString(record, ["Site.Name", "SiteName"]) ||
    "Site to confirm";
  const customerName =
    (client?.name && !isBlankImportedCustomerName(client.name) ? client.name : "") ||
    usableCustomerName(record) ||
    fallbackCustomerLabel(simproCustomerId(record));
  return {
    clientId: client?.id,
    siteId: site?.id,
    customer: customerName,
    site: siteLabel,
    description: descriptionFromSimproRecord(record, "Imported simPRO job"),
    manager: firstString(record, ["ProjectManager.Name", "Owner.Name", "Salesperson.Name"]) || "Imported from simPRO",
    status: jobStatusFromSimpro(simproStatus),
    value: firstNumber(record, [
      "Total.ExTax",
      "Total.IncTax",
      "TotalExTax",
      "TotalIncTax",
      "TotalPrice",
      "Price",
      "Value",
      "Amount",
      "Total",
    ]),
    next: "Review imported job",
    due: dueLabelFromSimpro(record, ["DueDate", "DateCreated", "CreatedDate", "StartDate"]),
    simproJobId: identifier(record),
  };
}

export function processClient(record: UnknownRecord, mode: SimproSyncMode): SimproSyncOperation {
  const simproId = identifier(record);
  const mapped = clientFromSimpro(record);
  if (!simproId) return operation("clients", "conflict", "simPRO customer has no stable ID.", { simproName: mapped.name });

  const link = existingLink("clients", simproId);
  if (link) return operation("clients", "skip", `${mapped.name} is already linked to ${link.nexaName}.`, { simproId, simproName: mapped.name, nexaId: link.nexaId, nexaRef: link.nexaRef });

  const matches = findClientByNameOrEmail(mapped.name, mapped.email);
  if (matches.length > 1) {
    return operation("clients", "conflict", `${mapped.name} matches more than one NeXa customer.`, {
      simproId,
      simproName: mapped.name,
      candidates: matches.map((match) => ({
        nexaId: match.id,
        nexaName: match.name,
        nexaRef: match.accountReference,
      })),
      seed: { client: mapped },
    });
  }
  if (matches.length === 1 && matches[0]) {
    if (mode === "apply") {
      saveLink({
        nexaType: "clients",
        nexaId: matches[0].id,
        nexaRef: matches[0].accountReference,
        nexaName: matches[0].name,
        simproType: "clients",
        simproId,
        simproName: mapped.name,
        lastDirection: "simpro-to-nexa",
      });
    }
    return operation("clients", "link", `${mapped.name} can be linked to existing customer ${matches[0].name}.`, { simproId, simproName: mapped.name, nexaId: matches[0].id, nexaRef: matches[0].accountReference });
  }

  if (mode === "preview") {
    const gaps = [
      !isUsableEmailForMatch(mapped.email) ? "email" : "",
      isPlaceholderSimproValue(mapped.phone) ? "phone" : "",
      isPlaceholderSimproValue(mapped.billingAddress) ? "billing address" : "",
    ].filter(Boolean);
    const gapNote = gaps.length
      ? ` Missing on simPRO record: ${gaps.join(", ")} — can still import and fill later.`
      : "";
    return operation("clients", "create", `Create NeXa customer ${mapped.name}.${gapNote}`, {
      simproId,
      simproName: mapped.name,
      detail: gaps.length ? `Optional fields to confirm: ${gaps.join(", ")}` : undefined,
    });
  }

  const client = addClientRecord({
    ...mapped,
    id: `client-simpro-${simproId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    accountReference: `SIMPRO-${simproId}`,
    status: "Active",
  });
  saveLink({
    nexaType: "clients",
    nexaId: client.id,
    nexaRef: client.accountReference,
    nexaName: client.name,
    simproType: "clients",
    simproId,
    simproName: mapped.name,
    lastDirection: "simpro-to-nexa",
  });
  appendAuditEvent({
    actor: "simPRO sync",
    action: "created",
    recordType: "client",
    recordId: client.id,
    summary: `Customer ${client.name} imported from simPRO ${simproId}.`,
    source: "simPRO sync",
    importance: "normal",
  });
  return operation("clients", "create", `Created NeXa customer ${client.name}.`, { simproId, simproName: mapped.name, nexaId: client.id, nexaRef: client.accountReference });
}

export function processSite(record: UnknownRecord, mode: SimproSyncMode): SimproSyncOperation {
  const simproId = identifier(record);
  if (!simproId) return operation("sites", "conflict", "simPRO site has no stable ID.");

  const link = existingLink("sites", simproId);
  if (link) return operation("sites", "skip", `${link.simproName} is already linked to ${link.nexaName}.`, { simproId, simproName: link.simproName, nexaId: link.nexaId, nexaRef: link.nexaRef });

  let clientId = matchingClientIdForRecord(record);
  const customerExternalId = simproCustomerId(record);
  const customerName = usableCustomerName(record) || fallbackCustomerLabel(customerExternalId);
  const siteName =
    firstString(record, ["Name", "SiteName"]) || addressFromRecord(record).split(",")[0]?.trim() || "simPRO site";

  if (!clientId && customerExternalId) {
    if (mode === "preview") {
      return operation(
        "sites",
        "create",
        `Would create site ${siteName} after customer ${customerName} (simPRO ${customerExternalId}) is imported or linked.`,
        {
          simproId,
          simproName: siteName,
          seed: { site: siteFromSimpro(record, "pending-client") },
          detail: "Import Clients with Sites (or Apply Clients first) so the site can attach to its customer.",
        },
      );
    }

    const customerRecord = {
      ...(asRecord(record.Customer) ?? {}),
      ID: customerExternalId,
      CompanyName: customerName,
    };
    const customerResult = processClient(customerRecord, mode);
    clientId = customerResult.nexaId || matchingClientIdForRecord(record);
  }

  if (!clientId) {
    return operation("sites", "conflict", "Site cannot be imported until its customer is linked.", {
      simproId,
      simproName: siteName,
      seed: { site: siteFromSimpro(record, "pending-client") },
      detail: customerExternalId
        ? `Customer simPRO ${customerExternalId} was not found in NeXa.`
        : "simPRO site has no Customer ID — link the customer manually, then re-run.",
    });
  }
  const mapped = siteFromSimpro(record, clientId);
  const matches = findSiteMatch(clientId, mapped);
  if (matches.length > 1) {
    return operation("sites", "conflict", `${mapped.name} matches more than one NeXa site.`, {
      simproId,
      simproName: mapped.name,
      candidates: matches.map((match) => ({
        nexaId: match.id,
        nexaName: match.name,
        nexaRef: match.name,
      })),
      seed: { site: mapped },
    });
  }
  if (matches.length === 1 && matches[0]) {
    if (mode === "apply") {
      saveLink({
        nexaType: "sites",
        nexaId: matches[0].id,
        nexaName: matches[0].name,
        simproType: "sites",
        simproId,
        simproName: mapped.name,
        lastDirection: "simpro-to-nexa",
      });
    }
    return operation("sites", "link", `${mapped.name} can be linked to existing site ${matches[0].name}.`, { simproId, simproName: mapped.name, nexaId: matches[0].id });
  }

  if (mode === "preview") {
    return operation("sites", "create", `Create NeXa site ${mapped.name}.`, { simproId, simproName: mapped.name });
  }

  const site = addClientSiteRecord({
    ...mapped,
    id: `site-simpro-${simproId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
  });
  saveLink({
    nexaType: "sites",
    nexaId: site.id,
    nexaName: site.name,
    simproType: "sites",
    simproId,
    simproName: mapped.name,
    lastDirection: "simpro-to-nexa",
  });
  appendAuditEvent({
    actor: "simPRO sync",
    action: "created",
    recordType: "site",
    recordId: site.id,
    summary: `Site ${site.name} imported from simPRO ${simproId}.`,
    source: "simPRO sync",
    importance: "normal",
  });
  return operation("sites", "create", `Created NeXa site ${site.name}.`, { simproId, simproName: mapped.name, nexaId: site.id });
}

async function hydrateRecordSite(config: ResolvedSimproDirectConfig, record: UnknownRecord) {
  if (!siteNeedsHydrate(record)) return record;
  const siteId = simproSiteId(record);
  if (!siteId) return record;
  const detail = await fetchSimproSiteDetail(config, siteId);
  if (!detail) return record;
  return mergeSiteOntoRecord(record, detail);
}

async function patchQuoteHeaderFromDeepRecord(config: ResolvedSimproDirectConfig, nexaQuoteId: string, record: UnknownRecord) {
  const hydrated = await hydrateRecordSite(config, await hydrateRecordCustomer(config, record));
  const { client } = resolveClientForRecord(hydrated, "apply");
  const site = ensureSiteForRecord(hydrated, client?.id, "apply") || matchingSiteForRecord(hydrated, client?.id);
  const mapped = buildQuoteInput(hydrated, client, site);
  const existing = getQuotes().find((quote) => quote.id === nexaQuoteId);
  if (!existing) return mapped;
  updateQuote(nexaQuoteId, {
    clientId: mapped.clientId || existing.clientId,
    siteId: mapped.siteId || existing.siteId,
    customer: !isBlankImportedCustomerName(mapped.customer)
      ? mapped.customer
      : !isBlankImportedCustomerName(existing.customer)
        ? existing.customer
        : mapped.customer,
    description:
      mapped.description && mapped.description !== "Imported simPRO quote"
        ? mapped.description
        : existing.description || mapped.description,
    owner: mapped.owner && mapped.owner !== "Imported from simPRO" ? mapped.owner : existing.owner || mapped.owner,
    status: mapped.status || existing.status,
    value: mapped.value > 0 ? mapped.value : existing.value,
    due: mapped.due && mapped.due !== "To be reviewed" ? mapped.due : existing.due || mapped.due,
    simproQuoteId: mapped.simproQuoteId || existing.simproQuoteId,
  });
  return mapped;
}

async function patchJobHeaderFromDeepRecord(config: ResolvedSimproDirectConfig, nexaJobId: string, record: UnknownRecord) {
  const hydrated = await hydrateRecordSite(config, await hydrateRecordCustomer(config, record));
  const { client } = resolveClientForRecord(hydrated, "apply");
  const site = ensureSiteForRecord(hydrated, client?.id, "apply") || matchingSiteForRecord(hydrated, client?.id);
  const mapped = buildJobInput(hydrated, client, site);
  const existing = getJobs().find((job) => job.id === nexaJobId);
  if (!existing) return mapped;
  updateJob(nexaJobId, {
    clientId: mapped.clientId || existing.clientId,
    siteId: mapped.siteId || existing.siteId,
    customer: !isBlankImportedCustomerName(mapped.customer)
      ? mapped.customer
      : !isBlankImportedCustomerName(existing.customer)
        ? existing.customer
        : mapped.customer,
    site:
      mapped.site && mapped.site !== "Site to confirm" ? mapped.site : existing.site || mapped.site,
    description:
      mapped.description && mapped.description !== "Imported simPRO job"
        ? mapped.description
        : existing.description || mapped.description,
    manager:
      mapped.manager && mapped.manager !== "Imported from simPRO" ? mapped.manager : existing.manager || mapped.manager,
    status: mapped.status || existing.status,
    value: mapped.value > 0 ? mapped.value : existing.value,
    due: mapped.due && mapped.due !== "To be reviewed" ? mapped.due : existing.due || mapped.due,
    simproJobId: mapped.simproJobId || existing.simproJobId,
  });
  return mapped;
}

function quoteAlreadyHasCostCentres(nexaQuoteId: string) {
  const centres = getHubDetailState().quoteCostCentres?.[nexaQuoteId];
  return Array.isArray(centres) && centres.length > 0;
}

function jobAlreadyHasCostCentres(nexaJobId: string) {
  const centres = getHubDetailState().jobCostCentres?.[nexaJobId];
  return Array.isArray(centres) && centres.length > 0;
}

async function withQuoteHierarchy(
  op: SimproSyncOperation,
  nexaQuoteId: string,
  simproId: string,
  mode: SimproSyncMode,
): Promise<SimproSyncOperation> {
  if (mode !== "apply" || !nexaQuoteId) return op;

  // Even when CCs already exist, refresh customer/site/title from quote detail.
  if (quoteAlreadyHasCostCentres(nexaQuoteId)) {
    let headerNote = "";
    try {
      const config = await resolveSimproDirectConfig();
      const detail = await fetchSimproEntityDetail(config, "quotes", simproId);
      if (detail) {
        const mapped = await patchQuoteHeaderFromDeepRecord(config, nexaQuoteId, detail);
        headerNote = ` Header refreshed (${mapped.customer} · £${mapped.value.toFixed(2)}).`;
      } else {
        headerNote = " Header refresh skipped — quote detail fetch failed.";
      }
    } catch (error) {
      headerNote = ` Header refresh failed: ${error instanceof Error ? error.message : String(error)}.`;
    }
    return {
      ...op,
      summary: `${op.summary} Cost centres already present — skipped deep pull.${headerNote}`,
      detail: `Existing cost centres kept.${headerNote}`,
    };
  }

  if (!takeDeepHierarchySlot()) {
    return {
      ...op,
      summary: `${op.summary} Header imported; cost-centre hydrate deferred (run Apply again for next ${SIMPRO_DEEP_HIERARCHY_LIMIT}).`,
      detail: `Deep hierarchy capped at ${SIMPRO_DEEP_HIERARCHY_LIMIT} quotes/jobs per Apply to keep the site stable.`,
    };
  }
  const config = await resolveSimproDirectConfig();
  const prefetched = await fetchSimproEntityDetail(config, "quotes", simproId);
  const deep = await enrichNexaQuoteFromSimpro({
    nexaQuoteId,
    simproQuoteId: simproId,
    prefetchedRecord: prefetched,
  });
  let headerNote = "";
  if (deep.ok && deep.record) {
    try {
      const mapped = await patchQuoteHeaderFromDeepRecord(config, nexaQuoteId, deep.record);
      headerNote = ` Header refreshed (${mapped.customer} · £${mapped.value.toFixed(2)} · ${
        Array.isArray(getHubDetailState().quoteCostCentres?.[nexaQuoteId])
          ? getHubDetailState().quoteCostCentres?.[nexaQuoteId]?.length
          : 0
      } cost centres).`;
    } catch (error) {
      headerNote = ` Header refresh failed: ${error instanceof Error ? error.message : String(error)}.`;
    }
  }
  const hierarchyDetail = deep.ok ? deep.summary : deep.detail || deep.summary;
  if (!deep.ok) {
    return {
      ...op,
      action: "error",
      summary: `${op.summary} Hierarchy pull failed: ${deep.detail || deep.summary}.`,
      detail: `${hierarchyDetail}${headerNote}`.trim(),
    };
  }
  return {
    ...op,
    summary: `${op.summary} ${deep.summary}.${headerNote}`,
    detail: `${hierarchyDetail}${headerNote}`.trim(),
  };
}

async function withJobHierarchy(
  op: SimproSyncOperation,
  nexaJobId: string,
  simproId: string,
  mode: SimproSyncMode,
): Promise<SimproSyncOperation> {
  if (mode !== "apply" || !nexaJobId) return op;
  if (jobAlreadyHasCostCentres(nexaJobId)) {
    return {
      ...op,
      summary: `${op.summary} Cost centres already present — skipped deep pull.`,
      detail: "Existing cost centres kept.",
    };
  }
  if (!takeDeepHierarchySlot()) {
    return {
      ...op,
      summary: `${op.summary} Header imported; cost-centre hydrate deferred (run Apply again for next ${SIMPRO_DEEP_HIERARCHY_LIMIT}).`,
      detail: `Deep hierarchy capped at ${SIMPRO_DEEP_HIERARCHY_LIMIT} quotes/jobs per Apply to keep the site stable.`,
    };
  }
  const config = await resolveSimproDirectConfig();
  const prefetched = await fetchSimproEntityDetail(config, "jobs", simproId);
  const deep = await enrichNexaJobFromSimpro({
    nexaJobId,
    simproJobId: simproId,
    includeSchedules: true,
    prefetchedRecord: prefetched,
  });
  let headerNote = "";
  if (deep.ok && deep.record) {
    try {
      const mapped = await patchJobHeaderFromDeepRecord(config, nexaJobId, deep.record);
      headerNote = ` Header refreshed (${mapped.customer} · £${mapped.value.toFixed(2)}).`;
    } catch (error) {
      headerNote = ` Header refresh failed: ${error instanceof Error ? error.message : String(error)}.`;
    }
  }
  const hierarchyDetail = deep.ok ? deep.summary : deep.detail || deep.summary;
  if (!deep.ok) {
    return {
      ...op,
      action: "error",
      summary: `${op.summary} Hierarchy pull failed: ${deep.detail || deep.summary}.`,
      detail: `${hierarchyDetail}${headerNote}`.trim(),
    };
  }
  return {
    ...op,
    summary: `${op.summary} ${deep.summary}.${headerNote}`,
    detail: `${hierarchyDetail}${headerNote}`.trim(),
  };
}

function refreshQuoteHeaderFromListRecord(nexaQuoteId: string, record: UnknownRecord, mode: SimproSyncMode) {
  const { client } = resolveClientForRecord(record, mode);
  const site = ensureSiteForRecord(record, client?.id, mode) || matchingSiteForRecord(record, client?.id);
  const mapped = buildQuoteInput(record, client, site);
  const existing = getQuotes().find((quote) => quote.id === nexaQuoteId);
  if (!existing) return mapped;
  updateQuote(nexaQuoteId, {
    clientId: mapped.clientId || existing.clientId,
    siteId: mapped.siteId || existing.siteId,
    customer: !isBlankImportedCustomerName(mapped.customer)
      ? mapped.customer
      : !isBlankImportedCustomerName(existing.customer)
        ? existing.customer
        : mapped.customer,
    description:
      mapped.description && mapped.description !== "Imported simPRO quote"
        ? mapped.description
        : existing.description || mapped.description,
    owner: mapped.owner && mapped.owner !== "Imported from simPRO" ? mapped.owner : existing.owner || mapped.owner,
    status: mapped.status || existing.status,
    value: mapped.value > 0 ? mapped.value : existing.value,
    due: mapped.due && mapped.due !== "Imported" && mapped.due !== "To be reviewed" ? mapped.due : existing.due || mapped.due,
    next: mapped.next || existing.next,
    simproQuoteId: mapped.simproQuoteId || existing.simproQuoteId,
  });
  return mapped;
}

async function processQuote(record: UnknownRecord, mode: SimproSyncMode): Promise<SimproSyncOperation> {
  const simproId = identifier(record);
  if (!simproId) return operation("quotes", "conflict", "simPRO quote has no stable ID.");

  let working = record;
  if (mode === "apply") {
    const config = await resolveSimproDirectConfig();
    working = await hydrateQuoteOrJobRecordForImport(config, "quotes", record);
  }

  const link = pruneOrphanLink("quotes", simproId);
  if (link) {
    if (mode === "apply") {
      refreshQuoteHeaderFromListRecord(link.nexaId, working, mode);
    }
    const base = operation(
      "quotes",
      "link",
      mode === "apply"
        ? `Refreshing ${link.nexaRef ?? link.nexaName} from simPRO quote ${simproId}.`
        : `Would refresh ${link.nexaRef ?? link.nexaName} from simPRO quote ${simproId}.`,
      { simproId, simproName: link.simproName, nexaId: link.nexaId, nexaRef: link.nexaRef },
    );
    return withQuoteHierarchy(base, link.nexaId, simproId, mode);
  }

  const existing = getQuotes().find((quote) => quote.simproQuoteId === simproId);
  if (existing) {
    if (mode === "apply") {
      refreshQuoteHeaderFromListRecord(existing.id, working, mode);
      saveLink({
        nexaType: "quotes",
        nexaId: existing.id,
        nexaRef: existing.ref,
        nexaName: existing.description,
        simproType: "quotes",
        simproId,
        simproName: existing.description,
        lastDirection: "simpro-to-nexa",
      });
    }
    const base = operation("quotes", "link", `Link simPRO quote ${simproId} to ${existing.ref}.`, {
      simproId,
      simproName: existing.description,
      nexaId: existing.id,
      nexaRef: existing.ref,
    });
    return withQuoteHierarchy(base, existing.id, simproId, mode);
  }

  const { client } = resolveClientForRecord(working, mode);
  const site = ensureSiteForRecord(working, client?.id, mode) || matchingSiteForRecord(working, client?.id);
  const mapped = buildQuoteInput(working, client, site);
  if (mode === "preview") {
    return operation(
      "quotes",
      "create",
      `Create NeXa quote for ${mapped.customer}: ${mapped.description} · £${mapped.value.toFixed(2)} (cost centres + materials/labour on apply).`,
      { simproId, simproName: mapped.description, detail: mapped.description },
    );
  }

  const quote = createQuote(mapped);
  saveLink({
    nexaType: "quotes",
    nexaId: quote.id,
    nexaRef: quote.ref,
    nexaName: quote.description,
    simproType: "quotes",
    simproId,
    simproName: mapped.description,
    lastDirection: "simpro-to-nexa",
  });
  appendAuditEvent({
    actor: "simPRO sync",
    action: "created",
    recordType: "quote",
    recordId: quote.id,
    summary: `${quote.ref} imported from simPRO quote ${simproId}.`,
    source: "simPRO sync",
    importance: "normal",
  });
  const base = operation("quotes", "create", `Created ${quote.ref} from simPRO quote ${simproId}.`, {
    simproId,
    simproName: mapped.description,
    nexaId: quote.id,
    nexaRef: quote.ref,
  });
  const result = await withQuoteHierarchy(base, quote.id, simproId, mode);
  if (mode === "apply" && isBlankImportedCustomerName(mapped.customer) && !simproCustomerId(working)) {
    return {
      ...result,
      action: "error",
      summary: `${result.summary} Quote detail had no Customer — re-Apply after checking simPRO access / rate limits.`,
    };
  }
  return result;
}

async function processJob(record: UnknownRecord, mode: SimproSyncMode): Promise<SimproSyncOperation> {
  const simproId = identifier(record);
  if (!simproId) return operation("jobs", "conflict", "simPRO job has no stable ID.");

  let working = record;
  if (mode === "apply") {
    const config = await resolveSimproDirectConfig();
    working = await hydrateQuoteOrJobRecordForImport(config, "jobs", record);
  }

  const link = pruneOrphanLink("jobs", simproId);
  if (link) {
    const base = operation(
      "jobs",
      "link",
      mode === "apply"
        ? `Refreshing ${link.nexaRef ?? link.nexaName} from simPRO job ${simproId}.`
        : `Would refresh ${link.nexaRef ?? link.nexaName} from simPRO job ${simproId}.`,
      { simproId, simproName: link.simproName, nexaId: link.nexaId, nexaRef: link.nexaRef },
    );
    return withJobHierarchy(base, link.nexaId, simproId, mode);
  }

  const existing = getJobs().find((job) => job.simproJobId === simproId);
  if (existing) {
    if (mode === "apply") {
      saveLink({
        nexaType: "jobs",
        nexaId: existing.id,
        nexaRef: existing.ref,
        nexaName: existing.description,
        simproType: "jobs",
        simproId,
        simproName: existing.description,
        lastDirection: "simpro-to-nexa",
      });
    }
    const base = operation("jobs", "link", `Link simPRO job ${simproId} to ${existing.ref}.`, {
      simproId,
      simproName: existing.description,
      nexaId: existing.id,
      nexaRef: existing.ref,
    });
    return withJobHierarchy(base, existing.id, simproId, mode);
  }

  const { client } = resolveClientForRecord(working, mode);
  const site = ensureSiteForRecord(working, client?.id, mode) || matchingSiteForRecord(working, client?.id);
  const mapped = buildJobInput(working, client, site);
  if (mode === "preview") {
    return operation(
      "jobs",
      "create",
      `Create NeXa job for ${mapped.customer}: ${mapped.description} · £${mapped.value.toFixed(2)} (cost centres, materials/labour + schedules on apply).`,
      { simproId, simproName: mapped.description, detail: mapped.site },
    );
  }

  const job = createJob(mapped);
  saveLink({
    nexaType: "jobs",
    nexaId: job.id,
    nexaRef: job.ref,
    nexaName: job.description,
    simproType: "jobs",
    simproId,
    simproName: mapped.description,
    lastDirection: "simpro-to-nexa",
  });
  appendAuditEvent({
    actor: "simPRO sync",
    action: "created",
    recordType: "job",
    recordId: job.id,
    summary: `${job.ref} imported from simPRO job ${simproId}.`,
    source: "simPRO sync",
    importance: "normal",
  });
  const base = operation("jobs", "create", `Created ${job.ref} from simPRO job ${simproId}.`, {
    simproId,
    simproName: mapped.description,
    nexaId: job.id,
    nexaRef: job.ref,
  });
  return withJobHierarchy(base, job.id, simproId, mode);
}

async function processInvoice(record: UnknownRecord, mode: SimproSyncMode): Promise<SimproSyncOperation> {
  const simproId = identifier(record);
  const companyId = getSimproDirectConfigStatus().companyId || "0";
  try {
    const result = await importSimproInvoiceIntoHub({
      record,
      companyId,
      preview: mode === "preview",
    });
    const action =
      result.action === "preview"
        ? "preview"
        : result.action === "create"
          ? "create"
          : result.action === "link"
            ? "link"
            : result.action === "skip"
              ? "skip"
              : result.action === "conflict"
                ? "conflict"
                : "error";
    if (action === "create") {
      appendAuditEvent({
        actor: "simPRO sync",
        action: "created",
        recordType: "invoice",
        recordId: result.nexaId || simproId || "invoice",
        summary: result.summary,
        source: "simPRO sync",
        importance: "normal",
      });
    }
    return operation("invoices", action, result.summary, {
      simproId: result.simproId || simproId,
      simproName: firstString(record, ["InvoiceNo", "Number", "Name", "Description"]) || undefined,
      nexaId: result.nexaId,
      nexaRef: result.nexaRef,
    });
  } catch (error) {
    return operation(
      "invoices",
      "error",
      error instanceof Error ? error.message : `Unable to import simPRO invoice ${simproId || ""}.`,
      { simproId },
    );
  }
}

async function processRecord(entity: SimproSyncEntity, record: UnknownRecord, mode: SimproSyncMode) {
  if (entity === "clients") return processClient(record, mode);
  if (entity === "sites") return processSite(record, mode);
  if (entity === "quotes") return processQuote(record, mode);
  if (entity === "jobs") return processJob(record, mode);
  if (entity === "schedules") {
    return operation("schedules", "skip", "Schedules are pulled for linked jobs as a batch, not per list record.");
  }
  return processInvoice(record, mode);
}

async function processSchedulesEntity(mode: SimproSyncMode): Promise<SimproSyncOperation[]> {
  const result = await pullSchedulesForLinkedJobs({ preview: mode === "preview", limit: 500 });
  return result.operations.map((item) =>
    operation(
      "schedules",
      item.action === "create"
        ? "create"
        : item.action === "preview"
          ? "preview"
          : item.action === "error"
            ? "error"
            : "skip",
      item.summary,
      {
        nexaId: item.nexaId,
        nexaRef: item.nexaRef,
        simproId: item.simproId,
        simproName: item.nexaRef,
      },
    ),
  );
}

function recomputeTotals(run: SimproSyncRun) {
  run.totals = {
    fetched: run.operations.length,
    created: run.operations.filter((item) => item.action === "create" || item.action === "preview").length,
    linked: run.operations.filter((item) => item.action === "link").length,
    skipped: run.operations.filter((item) => item.action === "skip").length,
    conflicts: run.operations.filter((item) => item.action === "conflict").length,
    errors: run.operations.filter((item) => item.action === "error").length,
  };
}

export function resolveSimproSyncConflict(input: {
  operationId: string;
  action: SimproConflictResolveAction;
  nexaId?: string;
  actor?: string;
}): SimproSyncOperation {
  const run = simproSyncStore.runs[0];
  if (!run) throw new Error("No simPRO sync run to resolve against. Preview or apply first.");
  const index = run.operations.findIndex((item) => item.id === input.operationId);
  if (index < 0) throw new Error("Conflict operation not found in the last sync run.");
  const current = run.operations[index]!;
  if (current.action !== "conflict") throw new Error("That sync row is no longer a conflict.");

  const actor = input.actor?.trim() || "NeXa user";

  if (input.action === "skip") {
    const next: SimproSyncOperation = {
      ...current,
      action: "skip",
      summary: `Skipped ${current.simproName || current.entity} conflict.`,
      detail: current.summary,
    };
    run.operations[index] = next;
    recomputeTotals(run);
    persistStore();
    return clone(next);
  }

  if (current.entity !== "clients" && current.entity !== "sites") {
    throw new Error("Only customer and site conflicts can be resolved here.");
  }

  if (input.action === "link") {
    const nexaId = input.nexaId?.trim() || current.candidates?.[0]?.nexaId;
    if (!nexaId) throw new Error("Pick a NeXa record to link this simPRO conflict to.");
    if (!current.simproId) throw new Error("This conflict has no simPRO ID to link.");

    if (current.entity === "clients") {
      const client = getClients().find((row) => row.id === nexaId);
      if (!client) throw new Error("Selected NeXa customer was not found.");
      saveLink({
        nexaType: "clients",
        nexaId: client.id,
        nexaRef: client.accountReference,
        nexaName: client.name,
        simproType: "clients",
        simproId: current.simproId,
        simproName: current.simproName || client.name,
        lastDirection: "simpro-to-nexa",
      });
      const next: SimproSyncOperation = {
        ...current,
        action: "link",
        nexaId: client.id,
        nexaRef: client.accountReference,
        summary: `Linked ${current.simproName || client.name} to ${client.name}.`,
      };
      run.operations[index] = next;
      recomputeTotals(run);
      persistStore();
      appendAuditEvent({
        actor,
        action: "linked",
        recordType: "client",
        recordId: client.id,
        summary: `Customer ${client.name} linked to simPRO ${current.simproId}.`,
        source: "simPRO sync resolve",
        importance: "normal",
      });
      return clone(next);
    }

    const site = getClientSites().find((row) => row.id === nexaId);
    if (!site) throw new Error("Selected NeXa site was not found.");
    saveLink({
      nexaType: "sites",
      nexaId: site.id,
      nexaRef: site.name,
      nexaName: site.name,
      simproType: "sites",
      simproId: current.simproId,
      simproName: current.simproName || site.name,
      lastDirection: "simpro-to-nexa",
    });
    const next: SimproSyncOperation = {
      ...current,
      action: "link",
      nexaId: site.id,
      nexaRef: site.name,
      summary: `Linked ${current.simproName || site.name} to ${site.name}.`,
    };
    run.operations[index] = next;
    recomputeTotals(run);
    persistStore();
    appendAuditEvent({
      actor,
      action: "linked",
      recordType: "site",
      recordId: site.id,
      summary: `Site ${site.name} linked to simPRO ${current.simproId}.`,
      source: "simPRO sync resolve",
      importance: "normal",
    });
    return clone(next);
  }

  // create
  if (!current.simproId) throw new Error("Cannot create from a conflict without a simPRO ID.");
  if (current.entity === "clients") {
    const mapped = current.seed?.client || {
      name: (current.simproName && !isBlankImportedCustomerName(current.simproName)
        ? current.simproName
        : fallbackCustomerLabel(current.simproId)),
      primaryContact: current.simproName || "To confirm",
      email: "To confirm",
      phone: "To confirm",
      billingAddress: "Address to confirm",
      commercialOwner: "Imported from simPRO",
      notes: "Created from a resolved simPRO conflict.",
    };
    const client = addClientRecord({
      ...mapped,
      id: `client-simpro-${current.simproId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      accountReference: `SIMPRO-${current.simproId}`,
      status: "Active",
    });
    saveLink({
      nexaType: "clients",
      nexaId: client.id,
      nexaRef: client.accountReference,
      nexaName: client.name,
      simproType: "clients",
      simproId: current.simproId,
      simproName: current.simproName || client.name,
      lastDirection: "simpro-to-nexa",
    });
    const next: SimproSyncOperation = {
      ...current,
      action: "create",
      nexaId: client.id,
      nexaRef: client.accountReference,
      summary: `Created NeXa customer ${client.name} from conflict.`,
    };
    run.operations[index] = next;
    recomputeTotals(run);
    persistStore();
    appendAuditEvent({
      actor,
      action: "created",
      recordType: "client",
      recordId: client.id,
      summary: `Customer ${client.name} created from simPRO conflict ${current.simproId}.`,
      source: "simPRO sync resolve",
      importance: "normal",
    });
    return clone(next);
  }

  const clientId = matchingClientIdForRecord({
    "Customer.ID": current.seed?.site?.clientId,
    CustomerID: current.seed?.site?.clientId,
  } as UnknownRecord) || current.seed?.site?.clientId;
  if (!clientId || clientId === "pending-client") {
    throw new Error("Link the customer first, then resolve this site conflict.");
  }
  const mapped = current.seed?.site
    ? { ...current.seed.site, clientId }
    : {
        clientId,
        name: current.simproName || "simPRO site",
        address: "Address to confirm",
        accessNotes: "Created from a resolved simPRO conflict.",
        primaryContact: "To confirm",
        serviceLine: "Imported simPRO site",
        nextVisit: "To be scheduled",
      };
  const site = addClientSiteRecord({
    ...mapped,
    id: `site-simpro-${current.simproId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
  });
  saveLink({
    nexaType: "sites",
    nexaId: site.id,
    nexaRef: site.name,
    nexaName: site.name,
    simproType: "sites",
    simproId: current.simproId,
    simproName: current.simproName || site.name,
    lastDirection: "simpro-to-nexa",
  });
  const next: SimproSyncOperation = {
    ...current,
    action: "create",
    nexaId: site.id,
    nexaRef: site.name,
    summary: `Created NeXa site ${site.name} from conflict.`,
  };
  run.operations[index] = next;
  recomputeTotals(run);
  persistStore();
  appendAuditEvent({
    actor,
    action: "created",
    recordType: "site",
    recordId: site.id,
    summary: `Site ${site.name} created from simPRO conflict ${current.simproId}.`,
    source: "simPRO sync resolve",
    importance: "normal",
  });
  return clone(next);
}

export function getSimproSyncStatus(): SimproSyncStatus {
  const config = getSimproDirectConfigStatus();
  return {
    configured: config.configured,
    mode: config.configured ? "direct" : "missing",
    missing: config.configured ? [] : config.missing,
    endpoint: config.configured ? `${config.baseUrl}/companies/${config.companyId}` : config.baseUrl,
    detectedEnvKeys: detectedSimproEnvKeys(),
    checkedAt: new Date().toISOString(),
    linkCount: simproSyncStore.links.length,
    webhookInboxCount: simproSyncStore.webhooks.filter((item) => item.status === "Queued").length,
    lastRun: clone(simproSyncStore.runs[0]),
    recentRuns: clone(simproSyncStore.runs.slice(0, 5)),
  };
}

export async function runSimproImport(options: {
  mode: SimproSyncMode;
  entities?: SimproSyncEntity[];
  actor?: string;
}): Promise<SimproSyncRun> {
  clearCustomerDetailCache();
  resetDeepHierarchyBudget();
  const configStatus = getSimproDirectConfigStatus();
  const selectedEntities = (options.entities?.length ? options.entities : simproEntities)
    .filter((entity): entity is SimproSyncEntity => simproEntities.includes(entity))
    .sort((left, right) => simproEntities.indexOf(left) - simproEntities.indexOf(right));
  const run: SimproSyncRun = {
    id: `simpro-run-${crypto.randomUUID()}`,
    mode: options.mode,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    actor: options.actor?.trim() || "NeXa user",
    entities: selectedEntities,
    totals: {
      fetched: 0,
      created: 0,
      linked: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
    },
    operations: [],
  };

  if (!configStatus.configured) {
    run.operations.push(
      operation("clients", "error", `simPRO direct API is not configured: ${configStatus.missing.join(", ")}.`),
    );
  } else {
    const config = await resolveSimproDirectConfig();
    for (const entity of selectedEntities) {
      try {
        if (entity === "schedules") {
          const scheduleOps = await processSchedulesEntity(options.mode);
          run.operations.push(...scheduleOps);
          continue;
        }
        const records = await fetchSimproRecords(config, entity);
        for (const record of records) {
          try {
            // Pace quote/job detail+CC pulls — bursty Apply was 429'd into Customer/Address stubs.
            if (options.mode === "apply" && (entity === "quotes" || entity === "jobs")) {
              await sleep(300);
            }
            run.operations.push(await processRecord(entity, record, options.mode));
          } catch (error) {
            run.operations.push(
              operation(entity, "error", error instanceof Error ? error.message : `Unable to process ${entity} record.`, {
                simproId: identifier(record),
              }),
            );
          }
        }
      } catch (error) {
        run.operations.push(
          operation(entity, "error", error instanceof Error ? error.message : `Unable to fetch ${entity} from simPRO.`, {
            detail: entity === "schedules" ? "schedules" : entityEndpoint(config, entity),
          }),
        );
      }
    }
  }

  run.finishedAt = new Date().toISOString();
  recomputeTotals(run);
  // Persist a trimmed run so huge import histories don't blow memory / crash the app.
  const persisted: SimproSyncRun = {
    ...run,
    operations: (() => {
      const conflicts = run.operations.filter((item) => item.action === "conflict");
      const rest = run.operations.filter((item) => item.action !== "conflict");
      return [...conflicts, ...rest].slice(0, 250);
    })(),
  };
  simproSyncStore.runs = [persisted, ...simproSyncStore.runs].slice(0, 8);
  persistStore();
  // Return the trimmed run — cloning thousands of ops was blowing response memory.
  return clone(persisted);
}

export function queueSimproWebhookEvent(payload: unknown, headers: Headers): SimproWebhookEvent {
  const record = asRecord(payload) ?? {};
  const eventType = firstString(record, ["event", "eventType", "type", "action"]) || headers.get("x-simpro-event") || "simPRO webhook";
  const entity = firstString(record, ["entity", "resource", "resourceType"]);
  const simproId = firstString(record, ["id", "ID", "resourceId", "ResourceID", "data.ID"]);
  const event: SimproWebhookEvent = {
    id: `simpro-webhook-${crypto.randomUUID()}`,
    receivedAt: new Date().toISOString(),
    eventType,
    entity: entity || undefined,
    simproId: simproId || undefined,
    status: "Queued",
    summary: `${eventType}${entity ? ` for ${entity}` : ""}${simproId ? ` ${simproId}` : ""}`,
    payload,
  };

  simproSyncStore.webhooks = [event, ...simproSyncStore.webhooks].slice(0, 100);
  persistStore();
  appendAuditEvent({
    actor: "simPRO webhook",
    action: "queued",
    recordType: "integration",
    recordId: event.id,
    summary: event.summary,
    source: "simPRO webhook",
    importance: "normal",
  });
  return clone(event);
}

export function isValidWebhookSecret(headers: Headers) {
  const expected = process.env.SIMPRO_WEBHOOK_SECRET?.trim();
  if (!expected) return true;

  const headerSecret =
    headers.get("x-simpro-secret") ||
    headers.get("x-nexa-simpro-secret") ||
    headers.get("x-webhook-secret") ||
    headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerSecret === expected;
}

/**
 * Remove NeXa jobs/quotes that were created from simPRO imports so a clean re-import can run.
 * Does not delete customers/sites (those stay linked).
 * Also clears ALL job/quote sync + entity links (including orphans left by directory deletes).
 */
export function cleanupImportedSimproRecords(input?: {
  entities?: Array<"jobs" | "quotes">;
  actor?: string;
}) {
  const entities = input?.entities?.length ? input.entities : (["jobs", "quotes"] as const);
  const actor = input?.actor?.trim() || "simPRO sync";
  const hub = getHubDetailState();
  const jobCostCentres = { ...(hub.jobCostCentres || {}) } as Record<string, unknown>;
  const jobSections = { ...(hub.jobSections || {}) } as Record<string, unknown>;
  const jobSchedulePlans = { ...(hub.jobSchedulePlans || {}) } as Record<string, unknown>;
  const quoteCostCentres = { ...(hub.quoteCostCentres || {}) } as Record<string, unknown>;
  const quoteSections = { ...(hub.quoteSections || {}) } as Record<string, unknown>;
  const quoteSchedulePlans = { ...(hub.quoteSchedulePlans || {}) } as Record<string, unknown>;

  let deletedJobs = 0;
  let deletedQuotes = 0;
  let clearedSyncLinks = 0;
  let clearedEntityLinks = 0;

  if (entities.includes("jobs")) {
    for (const job of getJobs()) {
      if (!String(job.simproJobId || "").trim()) continue;
      if (!removeJob(job.id)) continue;
      deletedJobs += 1;
      delete jobCostCentres[job.id];
      delete jobSections[job.id];
      delete jobSchedulePlans[job.id];
    }
    const before = simproSyncStore.links.length;
    simproSyncStore.links = simproSyncStore.links.filter(
      (link) => link.nexaType !== "jobs" && link.simproType !== "jobs",
    );
    clearedSyncLinks += before - simproSyncStore.links.length;
    clearedEntityLinks += removeSimproEntityLinksByTypes({
      entityTypes: ["job"],
    });
  }

  if (entities.includes("quotes")) {
    for (const quote of getQuotes()) {
      if (!String(quote.simproQuoteId || "").trim()) continue;
      if (!removeQuote(quote.id)) continue;
      deletedQuotes += 1;
      delete quoteCostCentres[quote.id];
      delete quoteSections[quote.id];
      delete quoteSchedulePlans[quote.id];
    }
    const before = simproSyncStore.links.length;
    simproSyncStore.links = simproSyncStore.links.filter(
      (link) => link.nexaType !== "quotes" && link.simproType !== "quotes",
    );
    clearedSyncLinks += before - simproSyncStore.links.length;
    clearedEntityLinks += removeSimproEntityLinksByTypes({ entityTypes: ["quote"] });
  }

  saveHubDetailState({
    ...hub,
    jobCostCentres,
    jobSections,
    jobSchedulePlans,
    quoteCostCentres,
    quoteSections,
    quoteSchedulePlans,
  });
  persistStore();
  appendAuditEvent({
    actor,
    action: "deleted",
    recordType: "integration",
    recordId: "simpro-import-cleanup",
    summary: `Removed ${deletedJobs} imported simPRO job(s) and ${deletedQuotes} imported simPRO quote(s); cleared ${clearedSyncLinks} sync link(s) and ${clearedEntityLinks} entity link(s) for a clean re-import.`,
    source: "simPRO sync",
    importance: "high",
  });

  return { deletedJobs, deletedQuotes, clearedSyncLinks, clearedEntityLinks };
}

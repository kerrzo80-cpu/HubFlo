import {
  addClientRecord,
  addClientSiteRecord,
  appendAuditEvent,
  getClientSites,
  getClients,
  type ClientRecord,
  type ClientSite,
} from "@/lib/people-data";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  createJob,
  createQuote,
  getJobs,
  getQuotes,
  type Job,
  type Quote,
  type QuoteStatus,
} from "@/lib/workflow-data";
import { getSimproDirectConfigStatus, resolveSimproDirectConfig, type ResolvedSimproDirectConfig } from "@/lib/simpro-auth";

type UnknownRecord = Record<string, unknown>;

export type SimproSyncEntity = "clients" | "sites" | "quotes" | "jobs" | "invoices";
export type SimproSyncMode = "preview" | "apply";
export type SimproSyncOperationAction = "create" | "link" | "skip" | "conflict" | "error" | "preview";

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

const simproEntities: SimproSyncEntity[] = ["clients", "sites", "quotes", "jobs", "invoices"];

const endpointByEntity: Record<SimproSyncEntity, string> = {
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

function entityEndpoint(config: ResolvedSimproDirectConfig, entity: SimproSyncEntity) {
  return `${config.baseUrl}/companies/${config.companyId}/${endpointByEntity[entity]}/`;
}

function normaliseText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function addressFromRecord(record: UnknownRecord) {
  return (
    joinAddress(record.Address) ||
    joinAddress(record.SiteAddress) ||
    joinAddress(record.BillingAddress) ||
    joinAddress(record.PostalAddress) ||
    firstString(record, ["Address", "SiteAddress", "BillingAddress", "PostalAddress"])
  );
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

async function fetchSimproRecords(config: ResolvedSimproDirectConfig, entity: SimproSyncEntity) {
  const url = new URL(entityEndpoint(config, entity));
  url.searchParams.set("pageSize", "50");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = firstString(asRecord(body) ?? {}, ["error", "message"]) || `simPRO returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return extractRecords(body);
}

function existingLink(entity: SimproSyncEntity, simproId: string) {
  return simproSyncStore.links.find((link) => link.simproType === entity && link.simproId === simproId);
}

function saveLink(link: Omit<SimproSyncLink, "id" | "lastSyncedAt">) {
  const existing = existingLink(link.simproType, link.simproId);
  const next: SimproSyncLink = {
    ...link,
    id: existing?.id ?? `simpro-link-${crypto.randomUUID()}`,
    lastSyncedAt: new Date().toISOString(),
  };
  simproSyncStore.links = [next, ...simproSyncStore.links.filter((item) => item.id !== next.id)];
  return next;
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
  const name =
    firstString(record, ["CompanyName", "Name", "CustomerName", "DisplayName"]) ||
    [firstString(record, ["GivenName", "FirstName"]), firstString(record, ["FamilyName", "LastName"])].filter(Boolean).join(" ") ||
    "simPRO customer";
  return {
    name,
    primaryContact: firstString(record, ["PrimaryContact.Name", "Contact.Name", "Contact", "Attention"]) || name,
    email: firstString(record, ["Email", "EmailAddress", "PrimaryContact.Email", "Contact.Email"]) || "To confirm",
    phone: firstString(record, ["Phone", "PhoneNumber", "Mobile", "PrimaryContact.Phone", "Contact.Phone"]) || "To confirm",
    billingAddress: addressFromRecord(record) || "Address to confirm",
    commercialOwner: "Imported from simPRO",
    notes: "Imported from simPRO. Review customer details before using on live documents.",
  };
}

function siteFromSimpro(record: UnknownRecord, clientId: string): Omit<ClientSite, "id"> {
  const address = addressFromRecord(record) || "Address to confirm";
  return {
    clientId,
    name: firstString(record, ["Name", "SiteName"]) || address.split(",")[0]?.trim() || "simPRO site",
    address,
    accessNotes: firstString(record, ["Notes", "AccessNotes", "Instructions"]) || "Imported from simPRO. Access notes to confirm.",
    primaryContact: firstString(record, ["Contact.Name", "PrimaryContact.Name", "Contact"]) || "To confirm",
    serviceLine: firstString(record, ["ServiceLine", "Description"]) || "Imported simPRO site",
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
  const normalizedEmail = normaliseText(email);
  return getClients().filter((client) => {
    if (normalizedEmail && normaliseText(client.email) === normalizedEmail) return true;
    return normaliseText(client.name) === normalizedName;
  });
}

function findSiteMatch(clientId: string | undefined, site: Omit<ClientSite, "id">) {
  const normalizedAddress = normaliseText(site.address);
  const normalizedName = normaliseText(site.name);
  return getClientSites().filter((existing) => {
    if (clientId && existing.clientId !== clientId) return false;
    return normaliseText(existing.address) === normalizedAddress || normaliseText(existing.name) === normalizedName;
  });
}

function simproCustomerId(record: UnknownRecord) {
  return firstString(record, ["Customer.ID", "Customer.Id", "Customer.id", "CustomerID", "Customer"]);
}

function simproCustomerName(record: UnknownRecord) {
  return firstString(record, ["Customer.Name", "Customer.CompanyName", "CustomerName", "Customer"]);
}

function matchingClientIdForRecord(record: UnknownRecord) {
  const externalId = simproCustomerId(record);
  if (externalId) {
    const link = existingLink("clients", externalId);
    if (link) return link.nexaId;
  }
  const name = simproCustomerName(record);
  if (!name) return undefined;
  const matches = findClientByNameOrEmail(name);
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function buildQuoteInput(record: UnknownRecord, client?: ClientRecord, site?: ClientSite): Omit<Quote, "id" | "ref"> {
  const simproStatus = firstString(record, ["Status.Name", "Status", "Stage", "Stage.Name"]);
  return {
    clientId: client?.id,
    siteId: site?.id,
    customer: client?.name || simproCustomerName(record) || firstString(record, ["Customer", "CustomerName"]) || "simPRO customer",
    description: firstString(record, ["Name", "Description", "Title", "Subject"]) || "Imported simPRO quote",
    owner: firstString(record, ["Salesperson.Name", "Owner.Name", "ProjectManager.Name"]) || "Imported from simPRO",
    status: quoteStatusFromSimpro(simproStatus),
    value: firstNumber(record, ["Total", "TotalExTax", "TotalIncTax", "Price", "Value"]),
    next: "Review imported simPRO quote",
    due: firstString(record, ["DueDate", "DateIssued", "DateCreated", "CreatedDate"]) || "To be reviewed",
    simproQuoteId: identifier(record),
    simproStatus: "Sent",
    simproSentAt: new Date().toISOString(),
  };
}

function buildJobInput(record: UnknownRecord, client?: ClientRecord, site?: ClientSite): Omit<Job, "id" | "ref" | "health"> & { simproJobId?: string } {
  return {
    clientId: client?.id,
    siteId: site?.id,
    customer: client?.name || simproCustomerName(record) || firstString(record, ["Customer", "CustomerName"]) || "simPRO customer",
    site: site?.address || addressFromRecord(record) || "Site to confirm",
    description: firstString(record, ["Name", "Description", "Title", "Subject"]) || "Imported simPRO job",
    manager: firstString(record, ["ProjectManager.Name", "Owner.Name", "Salesperson.Name"]) || "Imported from simPRO",
    status: firstString(record, ["Status.Name", "Status", "Stage", "Stage.Name"]) || "Imported",
    value: firstNumber(record, ["Total", "TotalExTax", "TotalIncTax", "Price", "Value"]),
    next: "Review imported simPRO job",
    due: firstString(record, ["DueDate", "DateCreated", "CreatedDate", "StartDate"]) || "To be reviewed",
    simproJobId: identifier(record),
  };
}

function processClient(record: UnknownRecord, mode: SimproSyncMode): SimproSyncOperation {
  const simproId = identifier(record);
  const mapped = clientFromSimpro(record);
  if (!simproId) return operation("clients", "conflict", "simPRO customer has no stable ID.", { simproName: mapped.name });

  const link = existingLink("clients", simproId);
  if (link) return operation("clients", "skip", `${mapped.name} is already linked to ${link.nexaName}.`, { simproId, simproName: mapped.name, nexaId: link.nexaId, nexaRef: link.nexaRef });

  const matches = findClientByNameOrEmail(mapped.name, mapped.email);
  if (matches.length > 1) {
    return operation("clients", "conflict", `${mapped.name} matches more than one NeXa customer.`, { simproId, simproName: mapped.name });
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
    return operation("clients", "create", `Create NeXa customer ${mapped.name}.`, { simproId, simproName: mapped.name });
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

function processSite(record: UnknownRecord, mode: SimproSyncMode): SimproSyncOperation {
  const simproId = identifier(record);
  if (!simproId) return operation("sites", "conflict", "simPRO site has no stable ID.");

  const link = existingLink("sites", simproId);
  if (link) return operation("sites", "skip", `${link.simproName} is already linked to ${link.nexaName}.`, { simproId, simproName: link.simproName, nexaId: link.nexaId, nexaRef: link.nexaRef });

  const clientId = matchingClientIdForRecord(record);
  if (!clientId) {
    return operation("sites", "conflict", "Site cannot be imported until its customer is linked.", { simproId, simproName: firstString(record, ["Name", "SiteName"]) });
  }
  const mapped = siteFromSimpro(record, clientId);
  const matches = findSiteMatch(clientId, mapped);
  if (matches.length > 1) {
    return operation("sites", "conflict", `${mapped.name} matches more than one NeXa site.`, { simproId, simproName: mapped.name });
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

function processQuote(record: UnknownRecord, mode: SimproSyncMode): SimproSyncOperation {
  const simproId = identifier(record);
  if (!simproId) return operation("quotes", "conflict", "simPRO quote has no stable ID.");

  const link = existingLink("quotes", simproId);
  if (link) return operation("quotes", "skip", `${link.simproName} is already linked to ${link.nexaRef ?? link.nexaName}.`, { simproId, simproName: link.simproName, nexaId: link.nexaId, nexaRef: link.nexaRef });

  const existing = getQuotes().find((quote) => quote.simproQuoteId === simproId);
  if (existing) {
    if (mode === "apply") {
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
    return operation("quotes", "link", `Link simPRO quote ${simproId} to ${existing.ref}.`, { simproId, simproName: existing.description, nexaId: existing.id, nexaRef: existing.ref });
  }

  const client = getClients().find((item) => item.id === matchingClientIdForRecord(record));
  const site = getClientSites().find((item) => item.clientId === client?.id && normaliseText(item.address) === normaliseText(addressFromRecord(record)));
  const mapped = buildQuoteInput(record, client, site);
  if (mode === "preview") {
    return operation("quotes", "create", `Create NeXa quote for ${mapped.customer}: ${mapped.description}.`, { simproId, simproName: mapped.description });
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
  return operation("quotes", "create", `Created ${quote.ref} from simPRO quote ${simproId}.`, { simproId, simproName: mapped.description, nexaId: quote.id, nexaRef: quote.ref });
}

function processJob(record: UnknownRecord, mode: SimproSyncMode): SimproSyncOperation {
  const simproId = identifier(record);
  if (!simproId) return operation("jobs", "conflict", "simPRO job has no stable ID.");

  const link = existingLink("jobs", simproId);
  if (link) return operation("jobs", "skip", `${link.simproName} is already linked to ${link.nexaRef ?? link.nexaName}.`, { simproId, simproName: link.simproName, nexaId: link.nexaId, nexaRef: link.nexaRef });

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
    return operation("jobs", "link", `Link simPRO job ${simproId} to ${existing.ref}.`, { simproId, simproName: existing.description, nexaId: existing.id, nexaRef: existing.ref });
  }

  const client = getClients().find((item) => item.id === matchingClientIdForRecord(record));
  const site = getClientSites().find((item) => item.clientId === client?.id && normaliseText(item.address) === normaliseText(addressFromRecord(record)));
  const mapped = buildJobInput(record, client, site);
  if (mode === "preview") {
    return operation("jobs", "create", `Create NeXa job for ${mapped.customer}: ${mapped.description}.`, { simproId, simproName: mapped.description });
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
  return operation("jobs", "create", `Created ${job.ref} from simPRO job ${simproId}.`, { simproId, simproName: mapped.description, nexaId: job.id, nexaRef: job.ref });
}

function processInvoice(record: UnknownRecord): SimproSyncOperation {
  const simproId = identifier(record);
  const summary = firstString(record, ["InvoiceNo", "Number", "Name", "Description"]) || `simPRO invoice ${simproId || "unknown"}`;
  return operation("invoices", "preview", `${summary} found in simPRO. Invoice import is preview-only until Xero/simPRO invoice numbering rules are approved.`, {
    simproId,
    simproName: summary,
  });
}

function processRecord(entity: SimproSyncEntity, record: UnknownRecord, mode: SimproSyncMode) {
  if (entity === "clients") return processClient(record, mode);
  if (entity === "sites") return processSite(record, mode);
  if (entity === "quotes") return processQuote(record, mode);
  if (entity === "jobs") return processJob(record, mode);
  return processInvoice(record);
}

function recomputeTotals(run: SimproSyncRun) {
  run.totals = {
    fetched: run.operations.length,
    created: run.operations.filter((item) => item.action === "create").length,
    linked: run.operations.filter((item) => item.action === "link").length,
    skipped: run.operations.filter((item) => item.action === "skip" || item.action === "preview").length,
    conflicts: run.operations.filter((item) => item.action === "conflict").length,
    errors: run.operations.filter((item) => item.action === "error").length,
  };
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
  const configStatus = getSimproDirectConfigStatus();
  const selectedEntities = (options.entities?.length ? options.entities : simproEntities)
    .filter((entity): entity is SimproSyncEntity => simproEntities.includes(entity));
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
        const records = await fetchSimproRecords(config, entity);
        records.forEach((record) => {
          try {
            run.operations.push(processRecord(entity, record, options.mode));
          } catch (error) {
            run.operations.push(
              operation(entity, "error", error instanceof Error ? error.message : `Unable to process ${entity} record.`, {
                simproId: identifier(record),
              }),
            );
          }
        });
      } catch (error) {
        run.operations.push(
          operation(entity, "error", error instanceof Error ? error.message : `Unable to fetch ${entity} from simPRO.`, {
            detail: entityEndpoint(config, entity),
          }),
        );
      }
    }
  }

  run.finishedAt = new Date().toISOString();
  recomputeTotals(run);
  simproSyncStore.runs = [run, ...simproSyncStore.runs].slice(0, 20);
  persistStore();
  return clone(run);
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

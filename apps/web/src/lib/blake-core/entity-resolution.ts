import type { Employee } from "@/lib/access";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads, type LeadRecord } from "@/lib/lead-store";
import { getClientSites, getClients, type ClientRecord, type ClientSite } from "@/lib/people-data";
import { getJobs, getQuotes, type Job, type Quote } from "@/lib/workflow-data";

const genericQueryWords = new Set([
  "a", "an", "the", "job", "jobs", "quote", "quotes", "lead", "leads", "customer", "customers", "client", "clients",
  "site", "sites", "address", "record", "records", "invoice", "invoices", "employee", "employees", "engineer", "engineers",
  "staff", "person", "people", "please", "for", "to", "on", "at", "of", "with", "this", "that",
]);

export type HumanEntityResolution<T> =
  | { kind: "resolved"; record: T; score: number }
  | { kind: "ambiguous"; records: T[]; score: number }
  | { kind: "none" };

export type BlakeInvoiceRecord = Record<string, unknown> & {
  id?: string;
  ref?: string;
  customer?: string;
  title?: string;
  sourceRef?: string;
  status?: string;
};

export function normaliseEntityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']s\b/gi, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokens(value: unknown, dropGeneric = false) {
  const list = normaliseEntityText(value).split(" ").filter(Boolean);
  return dropGeneric ? list.filter((token) => !genericQueryWords.has(token)) : list;
}

function tokenMatches(left: string, right: string) {
  return left === right
    || (left.length >= 4 && right.startsWith(left))
    || (right.length >= 4 && left.startsWith(right));
}

function allTokensMatch(sourceTokens: string[], targetTokens: string[]) {
  return sourceTokens.every((sourceToken) => targetTokens.some((targetToken) => tokenMatches(sourceToken, targetToken)));
}

function matchedTokenCount(sourceTokens: string[], targetTokens: string[]) {
  return sourceTokens.filter((sourceToken) => targetTokens.some((targetToken) => tokenMatches(sourceToken, targetToken))).length;
}

/**
 * Human-name/entity matching independent of punctuation, word order and conversational wrapper text.
 * This is intentionally entity-level matching rather than phrase routing.
 * Examples:
 *   Helen Ball -> Ball, Helen
 *   Helen Ball's job -> Ball, Helen
 *   can you open J-1141 -> J-1141
 *   Morrison Co -> Morrison & Co.
 *   Keithleigh Gardens -> 79 Keithleigh Gardens Pitmedden...
 */
export function entityMatchScore(query: unknown, value: unknown) {
  const q = normaliseEntityText(query);
  const v = normaliseEntityText(value);
  if (!q || !v) return 0;
  if (q === v) return 100;
  if (v.includes(q) || q.includes(v)) return Math.min(q.length, v.length) >= 5 ? 90 : 70;

  const queryTokens = tokens(query, true);
  const valueTokens = tokens(value);
  if (!queryTokens.length || !valueTokens.length) return 0;

  const qSet = new Set(queryTokens);
  const vSet = new Set(valueTokens);
  if (queryTokens.length >= 2 && qSet.size === vSet.size && [...qSet].every((token) => vSet.has(token))) return 98;

  // The identifier can be a clean fragment ("Dee View Road") contained in a longer stored value.
  if (allTokensMatch(queryTokens, valueTokens)) return queryTokens.length >= 2 ? 86 : 58;

  // Or it can be a conversational wrapper around the complete meaningful entity value
  // ("can you open Helen Ball's job" or "show me J-1141").
  if (valueTokens.length >= 2 && allTokensMatch(valueTokens, queryTokens)) return 82;

  // Finally tolerate extra conversational words around a multi-token fragment without
  // making a single common token enough to resolve a real record.
  const matchedQueryTokens = matchedTokenCount(queryTokens, valueTokens);
  if (matchedQueryTokens >= 2 && matchedQueryTokens / queryTokens.length >= 0.5) return 72;
  return 0;
}

export function bestEntityFieldScore(query: unknown, values: unknown[]): number {
  return values.reduce<number>((best, value) => Math.max(best, entityMatchScore(query, value)), 0);
}

type ResolverOptions<T> = {
  records: T[];
  identifier: string;
  exactValues: (record: T) => unknown[];
  rankedValues: (record: T) => Array<{ value: unknown; bonus?: number }>;
  sortLabel: (record: T) => string;
};

function resolveRecord<T>(options: ResolverOptions<T>): HumanEntityResolution<T> {
  const target = normaliseEntityText(options.identifier);
  if (!target) return { kind: "none" };

  const exactMatches = options.records.filter((record) =>
    options.exactValues(record).some((value) => normaliseEntityText(value) === target),
  );
  if (exactMatches.length === 1) return { kind: "resolved", record: exactMatches[0]!, score: 120 };
  if (exactMatches.length > 1) {
    return {
      kind: "ambiguous",
      records: exactMatches.sort((a, b) => options.sortLabel(a).localeCompare(options.sortLabel(b))),
      score: 120,
    };
  }

  const ranked = options.records
    .map((record) => ({
      record,
      score: Math.max(...options.rankedValues(record).map(({ value, bonus = 0 }) => entityMatchScore(options.identifier, value) + bonus)),
    }))
    .filter((item) => item.score >= 58)
    .sort((a, b) => b.score - a.score || options.sortLabel(a.record).localeCompare(options.sortLabel(b.record)));

  if (!ranked.length) return { kind: "none" };
  const best = ranked[0]!;
  const tied = ranked.filter((item) => item.score === best.score).map((item) => item.record);
  if (tied.length === 1) return { kind: "resolved", record: best.record, score: best.score };
  return { kind: "ambiguous", records: tied, score: best.score };
}

export function resolveJobFromHumanReference(identifier: string): HumanEntityResolution<Job> {
  const clients = new Map(getClients().map((client) => [client.id, client.name]));
  const sites = new Map(getClientSites().map((site) => [site.id, site]));
  return resolveRecord({
    records: getJobs(),
    identifier,
    exactValues: (job) => [job.id, job.ref],
    rankedValues: (job) => [
      { value: job.customer, bonus: 8 },
      { value: job.clientId ? clients.get(job.clientId) : undefined, bonus: 10 },
      { value: job.site, bonus: 4 },
      { value: job.siteId ? sites.get(job.siteId)?.name : undefined, bonus: 6 },
      { value: job.siteId ? sites.get(job.siteId)?.address : undefined, bonus: 8 },
      { value: job.description },
      { value: `${job.customer} ${job.site}` },
      { value: `${job.customer} ${job.description}` },
      { value: `${job.site} ${job.description}` },
    ],
    sortLabel: (job) => job.ref,
  });
}

export function resolveQuoteFromHumanReference(identifier: string): HumanEntityResolution<Quote> {
  const clients = new Map(getClients().map((client) => [client.id, client.name]));
  return resolveRecord({
    records: getQuotes(),
    identifier,
    exactValues: (quote) => [quote.id, quote.ref],
    rankedValues: (quote) => [
      { value: quote.customer, bonus: 8 },
      { value: quote.clientId ? clients.get(quote.clientId) : undefined, bonus: 10 },
      { value: quote.description },
      { value: `${quote.customer} ${quote.description}` },
    ],
    sortLabel: (quote) => quote.ref,
  });
}

export function resolveLeadFromHumanReference(identifier: string): HumanEntityResolution<LeadRecord> {
  const clients = new Map(getClients().map((client) => [client.id, client.name]));
  const sites = new Map(getClientSites().map((site) => [site.id, site]));
  return resolveRecord({
    records: getLeads(),
    identifier,
    exactValues: (lead) => [lead.id, lead.ref],
    rankedValues: (lead) => [
      { value: lead.customerName, bonus: 8 },
      { value: lead.clientId ? clients.get(lead.clientId) : undefined, bonus: 10 },
      { value: lead.address, bonus: 4 },
      { value: lead.siteId ? sites.get(lead.siteId)?.name : undefined, bonus: 6 },
      { value: lead.siteId ? sites.get(lead.siteId)?.address : undefined, bonus: 8 },
      { value: lead.description },
      { value: lead.phone },
      { value: lead.email },
      { value: `${lead.customerName} ${lead.address}` },
      { value: `${lead.customerName} ${lead.description}` },
    ],
    sortLabel: (lead) => lead.ref,
  });
}

export function resolveClientFromHumanReference(identifier: string): HumanEntityResolution<ClientRecord> {
  return resolveRecord({
    records: getClients(),
    identifier,
    exactValues: (client) => [client.id, client.accountReference],
    rankedValues: (client) => [
      { value: client.name, bonus: 8 },
      { value: client.primaryContact, bonus: 6 },
      { value: client.billingAddress, bonus: 4 },
      { value: client.email },
      { value: client.phone },
      { value: client.notes },
      { value: `${client.name} ${client.primaryContact}` },
      { value: `${client.name} ${client.billingAddress}` },
    ],
    sortLabel: (client) => client.name,
  });
}

export function resolveSiteFromHumanReference(identifier: string): HumanEntityResolution<ClientSite> {
  const clients = new Map(getClients().map((client) => [client.id, client.name]));
  return resolveRecord({
    records: getClientSites(),
    identifier,
    exactValues: (site) => [site.id],
    rankedValues: (site) => [
      { value: site.name, bonus: 8 },
      { value: site.address, bonus: 8 },
      { value: site.primaryContact, bonus: 4 },
      { value: site.serviceLine },
      { value: clients.get(site.clientId), bonus: 4 },
      { value: `${clients.get(site.clientId) || ""} ${site.name}` },
      { value: `${clients.get(site.clientId) || ""} ${site.address}` },
    ],
    sortLabel: (site) => `${site.address} ${site.name}`,
  });
}

export function resolveInvoiceFromHumanReference(identifier: string): HumanEntityResolution<BlakeInvoiceRecord> {
  const invoices = (getHubDetailState().invoices ?? []) as BlakeInvoiceRecord[];
  return resolveRecord({
    records: invoices,
    identifier,
    exactValues: (invoice) => [invoice.id, invoice.ref],
    rankedValues: (invoice) => [
      { value: invoice.customer, bonus: 8 },
      { value: invoice.title, bonus: 4 },
      { value: invoice.sourceRef, bonus: 4 },
      { value: `${invoice.customer || ""} ${invoice.title || ""}` },
      { value: `${invoice.customer || ""} ${invoice.sourceRef || ""}` },
    ],
    sortLabel: (invoice) => String(invoice.ref || invoice.id || invoice.title || "invoice"),
  });
}

export function resolveEmployeeFromHumanReference(identifier: string): HumanEntityResolution<Employee> {
  const employees = ((getHubDetailState().employees ?? []) as Employee[]).filter((employee) => !employee.archived);
  return resolveRecord({
    records: employees,
    identifier,
    exactValues: (employee) => [employee.id],
    rankedValues: (employee) => [
      { value: employee.name, bonus: 10 },
      { value: employee.profile?.email, bonus: 4 },
      { value: employee.profile?.phone, bonus: 4 },
      { value: employee.profile?.roleLabel },
      { value: employee.role },
      { value: `${employee.name} ${employee.profile?.roleLabel || employee.role}` },
    ],
    sortLabel: (employee) => employee.name,
  });
}

function requireResolved<T>(
  result: HumanEntityResolution<T>,
  identifier: string,
  entityLabel: string,
  display: (record: T) => string,
) {
  if (result.kind === "resolved") return result.record;
  if (result.kind === "ambiguous") {
    const options = result.records.slice(0, 5).map(display).join("; ");
    throw new Error(`More than one NeXa ${entityLabel} matches “${identifier}”: ${options}. Ask which real record they mean; do not ask them to look up an internal reference.`);
  }
  throw new Error(`No NeXa ${entityLabel} matches “${identifier}”. Search NeXa using the user's natural name, address, description or other details before asking them for anything else.`);
}

export function requireJobFromHumanReference(identifier: string) {
  return requireResolved(resolveJobFromHumanReference(identifier), identifier, "job", (job) => `${job.ref} · ${job.customer} · ${job.site}`);
}

export function requireQuoteFromHumanReference(identifier: string) {
  return requireResolved(resolveQuoteFromHumanReference(identifier), identifier, "quote", (quote) => `${quote.ref} · ${quote.customer} · ${quote.description}`);
}

export function requireLeadFromHumanReference(identifier: string) {
  return requireResolved(resolveLeadFromHumanReference(identifier), identifier, "lead", (lead) => `${lead.ref} · ${lead.customerName} · ${lead.address}`);
}

export function requireClientFromHumanReference(identifier: string) {
  return requireResolved(resolveClientFromHumanReference(identifier), identifier, "customer", (client) => `${client.name} · ${client.billingAddress || client.email}`);
}

export function requireSiteFromHumanReference(identifier: string) {
  return requireResolved(resolveSiteFromHumanReference(identifier), identifier, "site", (site) => `${site.name} · ${site.address}`);
}

export function requireInvoiceFromHumanReference(identifier: string) {
  return requireResolved(resolveInvoiceFromHumanReference(identifier), identifier, "invoice", (invoice) => `${String(invoice.ref || invoice.id || "Invoice")} · ${String(invoice.customer || invoice.title || "")}`);
}

export function requireEmployeeFromHumanReference(identifier: string) {
  return requireResolved(resolveEmployeeFromHumanReference(identifier), identifier, "employee", (employee) => `${employee.name} · ${employee.profile?.roleLabel || employee.role}`);
}

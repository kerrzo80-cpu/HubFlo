import { getLeads, type LeadRecord } from "@/lib/lead-store";
import { getJobs, getQuotes, type Job, type Quote } from "@/lib/workflow-data";

const genericQueryWords = new Set([
  "a", "an", "the", "job", "jobs", "quote", "quotes", "lead", "leads", "customer", "client", "site", "address",
  "record", "records", "invoice", "invoices", "please", "for", "to", "on", "at", "of", "with", "this", "that",
]);

export function normaliseEntityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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

function allTokensMatch(queryTokens: string[], valueTokens: string[]) {
  return queryTokens.every((queryToken) => valueTokens.some((valueToken) =>
    valueToken === queryToken
    || (queryToken.length >= 4 && valueToken.startsWith(queryToken))
    || (valueToken.length >= 4 && queryToken.startsWith(valueToken)),
  ));
}

/**
 * Human-name/entity match independent of punctuation and word order.
 * Examples:
 *   Helen Ball -> Ball, Helen
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
  if (allTokensMatch(queryTokens, valueTokens)) return queryTokens.length >= 2 ? 86 : 58;
  return 0;
}

export function bestEntityFieldScore(query: unknown, values: unknown[]) {
  return values.reduce((best, value) => Math.max(best, entityMatchScore(query, value)), 0);
}

type Resolution<T> =
  | { kind: "resolved"; record: T; score: number }
  | { kind: "ambiguous"; records: T[]; score: number }
  | { kind: "none" };

type ResolverOptions<T> = {
  records: T[];
  identifier: string;
  exactValues: (record: T) => unknown[];
  rankedValues: (record: T) => Array<{ value: unknown; bonus?: number }>;
  sortLabel: (record: T) => string;
};

function resolveRecord<T>(options: ResolverOptions<T>): Resolution<T> {
  const target = normaliseEntityText(options.identifier);
  const exact = options.records.find((record) =>
    options.exactValues(record).some((value) => normaliseEntityText(value) === target),
  );
  if (exact) return { kind: "resolved", record: exact, score: 120 };

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

export function resolveJobFromHumanReference(identifier: string): Resolution<Job> {
  return resolveRecord({
    records: getJobs(),
    identifier,
    exactValues: (job) => [job.id, job.ref],
    rankedValues: (job) => [
      { value: job.customer, bonus: 8 },
      { value: job.site, bonus: 4 },
      { value: job.description },
      { value: `${job.customer} ${job.site}` },
      { value: `${job.customer} ${job.description}` },
    ],
    sortLabel: (job) => job.ref,
  });
}

export function resolveQuoteFromHumanReference(identifier: string): Resolution<Quote> {
  return resolveRecord({
    records: getQuotes(),
    identifier,
    exactValues: (quote) => [quote.id, quote.ref],
    rankedValues: (quote) => [
      { value: quote.customer, bonus: 8 },
      { value: quote.description },
      { value: `${quote.customer} ${quote.description}` },
    ],
    sortLabel: (quote) => quote.ref,
  });
}

export function resolveLeadFromHumanReference(identifier: string): Resolution<LeadRecord> {
  return resolveRecord({
    records: getLeads(),
    identifier,
    exactValues: (lead) => [lead.id, lead.ref],
    rankedValues: (lead) => [
      { value: lead.customerName, bonus: 8 },
      { value: lead.address, bonus: 4 },
      { value: lead.description },
      { value: lead.phone },
      { value: lead.email },
      { value: `${lead.customerName} ${lead.address}` },
    ],
    sortLabel: (lead) => lead.ref,
  });
}

function requireResolved<T>(
  result: Resolution<T>,
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

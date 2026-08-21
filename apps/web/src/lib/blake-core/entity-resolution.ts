import { getJobs, type Job } from "@/lib/workflow-data";

const genericQueryWords = new Set([
  "a", "an", "the", "job", "jobs", "customer", "client", "site", "address", "record", "records",
  "please", "for", "to", "on", "at", "of", "with", "this", "that",
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
 * Scores natural human references without requiring word order to match storage.
 * This intentionally makes "Helen Ball" match "Ball, Helen" while keeping
 * fuzzy one-token matches weaker so callers can still detect ambiguity safely.
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

export type JobResolution =
  | { kind: "resolved"; job: Job; score: number }
  | { kind: "ambiguous"; jobs: Job[]; score: number }
  | { kind: "none" };

export function resolveJobFromHumanReference(identifier: string): JobResolution {
  const jobs = getJobs();
  const target = normaliseEntityText(identifier);

  const exact = jobs.find((job) =>
    normaliseEntityText(job.id) === target || normaliseEntityText(job.ref) === target,
  );
  if (exact) return { kind: "resolved", job: exact, score: 120 };

  const ranked = jobs
    .map((job) => ({
      job,
      score: Math.max(
        entityMatchScore(identifier, job.customer) + 8,
        entityMatchScore(identifier, job.site) + 4,
        entityMatchScore(identifier, job.description),
        entityMatchScore(identifier, `${job.customer} ${job.site}`),
      ),
    }))
    .filter((item) => item.score >= 58)
    .sort((a, b) => b.score - a.score || a.job.ref.localeCompare(b.job.ref));

  if (!ranked.length) return { kind: "none" };
  const best = ranked[0]!;
  const tied = ranked.filter((item) => item.score === best.score).map((item) => item.job);
  if (tied.length === 1) return { kind: "resolved", job: best.job, score: best.score };
  return { kind: "ambiguous", jobs: tied, score: best.score };
}

export function requireJobFromHumanReference(identifier: string) {
  const result = resolveJobFromHumanReference(identifier);
  if (result.kind === "resolved") return result.job;
  if (result.kind === "ambiguous") {
    const options = result.jobs.slice(0, 5).map((job) => `${job.ref} · ${job.customer} · ${job.site}`).join("; ");
    throw new Error(`More than one NeXa job matches “${identifier}”: ${options}. Ask which one they mean; do not ask them to look up an internal reference.`);
  }
  throw new Error(`No NeXa job matches “${identifier}”. Search NeXa by the customer's natural name, site address or job description before asking the user for anything else.`);
}

import type { SimproSyncEntity } from "@/lib/simpro-sync";

/** Working-set entities refreshed on the nightly simPRO pull. */
export const SIMPRO_EOD_ENTITIES: SimproSyncEntity[] = [
  "leads",
  "quotes",
  "jobs",
  "schedules",
  "invoices",
  "clients",
  "sites",
];

export const SIMPRO_EOD_ACTOR = "Nightly cron";

export function parseSimproEodEntities(raw: unknown): SimproSyncEntity[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const allowed = new Set<string>(SIMPRO_EOD_ENTITIES);
  const next = raw.filter((item): item is SimproSyncEntity => typeof item === "string" && allowed.has(item));
  return next.length ? next : undefined;
}

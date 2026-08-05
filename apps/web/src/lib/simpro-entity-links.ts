/**
 * Phase B — durable Simpro ↔ NeXa entity links.
 * Unique on (tenantKey, companyId, entityType, externalId).
 * Additive to the shallow sync link store in simpro-sync.ts.
 */

import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type SimproLinkEntityType =
  | "client"
  | "site"
  | "quote"
  | "job"
  | "invoice"
  | "section"
  | "costCentre"
  | "attachment"
  | "note";

export type SimproEntityLink = {
  id: string;
  tenantKey: string;
  companyId: string;
  entityType: SimproLinkEntityType;
  externalId: string;
  externalNumber?: string;
  nexaId: string;
  nexaRef?: string;
  nexaName?: string;
  sourceModifiedAt?: string;
  payloadHash?: string;
  importedReadOnly: boolean;
  lastSyncedAt: string;
  createdAt: string;
};

type EntityLinkStore = {
  links: SimproEntityLink[];
};

const DEFAULT_TENANT = "default";

const store = loadServerStore<EntityLinkStore>("simpro-entity-links", { links: [] });

function persist() {
  writeServerStore("simpro-entity-links", store);
}

function linkKey(input: Pick<SimproEntityLink, "tenantKey" | "companyId" | "entityType" | "externalId">) {
  return [input.tenantKey, input.companyId, input.entityType, input.externalId].join("::");
}

export function listSimproEntityLinks(filter?: {
  tenantKey?: string;
  companyId?: string;
  entityType?: SimproLinkEntityType;
}) {
  return store.links.filter((link) => {
    if (filter?.tenantKey && link.tenantKey !== filter.tenantKey) return false;
    if (filter?.companyId && link.companyId !== filter.companyId) return false;
    if (filter?.entityType && link.entityType !== filter.entityType) return false;
    return true;
  });
}

export function findSimproEntityLink(input: {
  tenantKey?: string;
  companyId: string;
  entityType: SimproLinkEntityType;
  externalId: string;
}) {
  const tenantKey = input.tenantKey?.trim() || DEFAULT_TENANT;
  const key = linkKey({ ...input, tenantKey, externalId: String(input.externalId) });
  return store.links.find((link) => linkKey(link) === key) ?? null;
}

export function findSimproEntityLinkByNexa(input: {
  tenantKey?: string;
  entityType: SimproLinkEntityType;
  nexaId: string;
}) {
  const tenantKey = input.tenantKey?.trim() || DEFAULT_TENANT;
  const nexaId = input.nexaId.trim();
  if (!nexaId) return null;
  return (
    store.links.find(
      (link) => link.tenantKey === tenantKey && link.entityType === input.entityType && link.nexaId === nexaId,
    ) ?? null
  );
}

export function upsertSimproEntityLink(
  input: Omit<SimproEntityLink, "id" | "createdAt" | "lastSyncedAt" | "tenantKey" | "importedReadOnly"> & {
    tenantKey?: string;
    importedReadOnly?: boolean;
    id?: string;
  },
) {
  const tenantKey = input.tenantKey?.trim() || DEFAULT_TENANT;
  const externalId = String(input.externalId).trim();
  if (!externalId || !input.companyId.trim() || !input.nexaId.trim()) {
    throw new Error("companyId, externalId, and nexaId are required for entity links");
  }

  const existing = findSimproEntityLink({
    tenantKey,
    companyId: input.companyId,
    entityType: input.entityType,
    externalId,
  });
  const now = new Date().toISOString();
  const next: SimproEntityLink = {
    id: existing?.id ?? input.id ?? `sel-${crypto.randomUUID()}`,
    tenantKey,
    companyId: input.companyId.trim(),
    entityType: input.entityType,
    externalId,
    externalNumber: input.externalNumber?.trim() || existing?.externalNumber,
    nexaId: input.nexaId.trim(),
    nexaRef: input.nexaRef?.trim() || existing?.nexaRef,
    nexaName: input.nexaName?.trim() || existing?.nexaName,
    sourceModifiedAt: input.sourceModifiedAt || existing?.sourceModifiedAt,
    payloadHash: input.payloadHash || existing?.payloadHash,
    importedReadOnly: input.importedReadOnly ?? existing?.importedReadOnly ?? true,
    lastSyncedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  store.links = [next, ...store.links.filter((link) => link.id !== next.id && linkKey(link) !== linkKey(next))];
  persist();
  return next;
}

export function removeSimproEntityLinksByNexa(input: {
  tenantKey?: string;
  entityTypes?: SimproLinkEntityType[];
  nexaId: string;
}) {
  const tenantKey = input.tenantKey?.trim() || DEFAULT_TENANT;
  const nexaId = input.nexaId.trim();
  if (!nexaId) return 0;
  const before = store.links.length;
  store.links = store.links.filter((link) => {
    if (link.tenantKey !== tenantKey || link.nexaId !== nexaId) return true;
    if (input.entityTypes?.length && !input.entityTypes.includes(link.entityType)) return true;
    return false;
  });
  const removed = before - store.links.length;
  if (removed > 0) persist();
  return removed;
}

export function removeSimproEntityLinksByTypes(input: {
  tenantKey?: string;
  entityTypes: SimproLinkEntityType[];
}) {
  const tenantKey = input.tenantKey?.trim() || DEFAULT_TENANT;
  if (!input.entityTypes.length) return 0;
  const typeSet = new Set(input.entityTypes);
  const before = store.links.length;
  store.links = store.links.filter(
    (link) => !(link.tenantKey === tenantKey && typeSet.has(link.entityType)),
  );
  const removed = before - store.links.length;
  if (removed > 0) persist();
  return removed;
}

export function simproEntityLinkStats(tenantKey = DEFAULT_TENANT) {
  const links = listSimproEntityLinks({ tenantKey });
  const byType: Partial<Record<SimproLinkEntityType, number>> = {};
  for (const link of links) {
    byType[link.entityType] = (byType[link.entityType] ?? 0) + 1;
  }
  return {
    total: links.length,
    byType,
  };
}

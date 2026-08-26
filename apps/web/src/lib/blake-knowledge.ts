import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

export type BlakeKnowledgeScope =
  | "company"
  | "user"
  | "customer"
  | "site"
  | "lead"
  | "quote"
  | "job"
  | "supplier"
  | "employee";

export type BlakeKnowledgeCategory =
  | "business_rule"
  | "terminology"
  | "pricing_rule"
  | "process"
  | "reporting_preference"
  | "tender_rule"
  | "customer_site"
  | "site_instruction"
  | "preference"
  | "company_context"
  | "other";

export type BlakeKnowledgeStatus = "active" | "superseded" | "archived";

export type BlakeKnowledgeRevision = {
  version: number;
  content: string;
  title: string;
  category: BlakeKnowledgeCategory;
  changedBy: string;
  changedAt: string;
  sourceConversationId?: string;
};

export type BlakeKnowledgeItem = {
  id: string;
  tenantId: string;
  scope: BlakeKnowledgeScope;
  scopeId?: string;
  actorId?: string;
  category: BlakeKnowledgeCategory;
  key: string;
  title: string;
  content: string;
  sourceConversationId?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  status: BlakeKnowledgeStatus;
  version: number;
  revisions: BlakeKnowledgeRevision[];
};

type LegacyKnowledgeItem = Partial<BlakeKnowledgeItem> & {
  id: string;
  tenantId: string;
  scope: "company" | "user";
  title: string;
  content: string;
  category: BlakeKnowledgeCategory;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type Store = { items: Array<BlakeKnowledgeItem | LegacyKnowledgeItem> };
const STORE_KEY = "blake-knowledge-v1";
const store = loadServerStore<Store>(STORE_KEY, { items: [] });

function canonicalKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function migrate(item: BlakeKnowledgeItem | LegacyKnowledgeItem): BlakeKnowledgeItem {
  const version = typeof item.version === "number" && item.version > 0 ? item.version : 1;
  const status: BlakeKnowledgeStatus = item.status === "archived" || item.status === "superseded" ? item.status : "active";
  return {
    ...item,
    key: item.key?.trim() || canonicalKey(item.title),
    scopeId: item.scopeId?.trim() || undefined,
    actorId: item.scope === "user" ? item.actorId : undefined,
    sourceEntityType: item.sourceEntityType?.trim() || undefined,
    sourceEntityId: item.sourceEntityId?.trim() || undefined,
    status,
    version,
    revisions: Array.isArray(item.revisions) ? item.revisions : [],
  };
}

function refresh() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as Store | null;
  if (Array.isArray(snapshot?.items)) store.items = snapshot.items.map(migrate);
  else store.items = store.items.map(migrate);
}

function persist() {
  store.items = (store.items as BlakeKnowledgeItem[])
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10000);
  writeServerStore(STORE_KEY, store);
}

function visibleTo(item: BlakeKnowledgeItem, tenantId: string, actorId: string, includeEntityScopes = false) {
  if (item.tenantId !== tenantId || item.status !== "active") return false;
  if (item.scope === "company") return true;
  if (item.scope === "user") return item.actorId === actorId;
  return includeEntityScopes;
}

function words(value: string) {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}£%]+/gu) ?? []);
}

function score(item: BlakeKnowledgeItem, query: string) {
  if (!query.trim()) return 0;
  const queryWords = words(query);
  const haystack = words(`${item.key} ${item.title} ${item.content} ${item.category} ${item.scope}`);
  let matches = 0;
  for (const word of queryWords) if (word.length > 2 && haystack.has(word)) matches += 1;
  return matches;
}

export function listBlakeKnowledge(input: {
  tenantId: string;
  actorId: string;
  query?: string;
  limit?: number;
  scopes?: BlakeKnowledgeScope[];
  scopeId?: string;
  includeEntityScopes?: boolean;
  includeInactive?: boolean;
}) {
  refresh();
  const query = input.query?.trim() ?? "";
  let visible = (store.items as BlakeKnowledgeItem[]).filter((item) => {
    if (input.includeInactive) {
      if (item.tenantId !== input.tenantId) return false;
      if (item.scope === "user" && item.actorId !== input.actorId) return false;
      if (item.scope !== "company" && item.scope !== "user" && !input.includeEntityScopes) return false;
    } else if (!visibleTo(item, input.tenantId, input.actorId, input.includeEntityScopes)) return false;
    if (input.scopes?.length && !input.scopes.includes(item.scope)) return false;
    if (input.scopeId && item.scopeId !== input.scopeId) return false;
    return true;
  });

  if (!query) {
    return visible
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(50, input.limit ?? 20)))
      .map((item) => structuredClone(item));
  }

  const ranked = visible
    .map((item) => ({ item, relevance: score(item, query) }))
    .filter((row) => row.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.item.updatedAt.localeCompare(a.item.updatedAt));

  // Deliberately return no arbitrary recent memories when the request has no relevant match.
  return ranked
    .slice(0, Math.max(1, Math.min(50, input.limit ?? 20)))
    .map((row) => structuredClone(row.item));
}

export function saveBlakeKnowledge(input: {
  tenantId: string;
  actorId: string;
  actorName: string;
  scope: BlakeKnowledgeScope;
  scopeId?: string;
  category: BlakeKnowledgeCategory;
  key?: string;
  title: string;
  content: string;
  sourceConversationId?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
}) {
  refresh();
  const title = input.title.trim();
  const content = input.content.trim();
  const key = canonicalKey(input.key?.trim() || title);
  const scopeId = input.scopeId?.trim() || undefined;
  if (!title || !content || !key) throw new TypeError("Knowledge key, title and content are required.");
  if (input.scope !== "company" && input.scope !== "user" && !scopeId) throw new TypeError("Record-linked knowledge requires a resolved scope id.");

  const existing = (store.items as BlakeKnowledgeItem[]).find(
    (item) => item.tenantId === input.tenantId
      && item.status === "active"
      && item.scope === input.scope
      && item.scopeId === scopeId
      && (item.scope !== "user" || item.actorId === input.actorId)
      && item.key === key,
  );
  const now = new Date().toISOString();

  const item: BlakeKnowledgeItem = existing
    ? {
      ...existing,
      category: input.category,
      title,
      content,
      sourceConversationId: input.sourceConversationId ?? existing.sourceConversationId,
      sourceEntityType: input.sourceEntityType ?? existing.sourceEntityType,
      sourceEntityId: input.sourceEntityId ?? existing.sourceEntityId,
      version: existing.version + 1,
      updatedAt: now,
      revisions: [
        ...existing.revisions,
        {
          version: existing.version,
          content: existing.content,
          title: existing.title,
          category: existing.category,
          changedBy: input.actorName,
          changedAt: now,
          sourceConversationId: input.sourceConversationId,
        },
      ].slice(-25),
    }
    : {
      id: `blake-knowledge-${crypto.randomUUID()}`,
      tenantId: input.tenantId,
      scope: input.scope,
      scopeId,
      actorId: input.scope === "user" ? input.actorId : undefined,
      category: input.category,
      key,
      title,
      content,
      sourceConversationId: input.sourceConversationId,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      createdBy: input.actorName,
      createdAt: now,
      updatedAt: now,
      status: "active",
      version: 1,
      revisions: [],
    };

  store.items = [item, ...(store.items as BlakeKnowledgeItem[]).filter((row) => row.id !== item.id)];
  persist();
  return structuredClone(item);
}

export function updateBlakeKnowledge(input: {
  id: string;
  tenantId: string;
  actorId: string;
  actorName: string;
  title?: string;
  content?: string;
  category?: BlakeKnowledgeCategory;
  sourceConversationId?: string;
}) {
  refresh();
  const existing = (store.items as BlakeKnowledgeItem[]).find((row) => row.id === input.id && row.tenantId === input.tenantId && row.status === "active");
  if (!existing || (existing.scope === "user" && existing.actorId !== input.actorId)) return null;
  return saveBlakeKnowledge({
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorName: input.actorName,
    scope: existing.scope,
    scopeId: existing.scopeId,
    category: input.category ?? existing.category,
    key: existing.key,
    title: input.title?.trim() || existing.title,
    content: input.content?.trim() || existing.content,
    sourceConversationId: input.sourceConversationId,
    sourceEntityType: existing.sourceEntityType,
    sourceEntityId: existing.sourceEntityId,
  });
}

export function archiveBlakeKnowledge(input: {
  id: string;
  tenantId: string;
  actorId: string;
}) {
  refresh();
  const item = (store.items as BlakeKnowledgeItem[]).find((row) => row.id === input.id && row.tenantId === input.tenantId && row.status === "active");
  if (!item || (item.scope === "user" && item.actorId !== input.actorId)) return null;
  const now = new Date().toISOString();
  const archived: BlakeKnowledgeItem = { ...item, status: "archived", archivedAt: now, updatedAt: now };
  store.items = [archived, ...(store.items as BlakeKnowledgeItem[]).filter((row) => row.id !== item.id)];
  persist();
  return structuredClone(archived);
}

// Backward-compatible alias for older callers. Forget now archives so provenance is retained.
export function deleteBlakeKnowledge(input: { id: string; tenantId: string; actorId: string }) {
  return archiveBlakeKnowledge(input);
}

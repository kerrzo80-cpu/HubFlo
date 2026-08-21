import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

export type BlakeKnowledgeScope = "company" | "user";
export type BlakeKnowledgeCategory =
  | "business_rule"
  | "terminology"
  | "pricing_rule"
  | "process"
  | "reporting_preference"
  | "customer_site"
  | "preference"
  | "other";

export type BlakeKnowledgeItem = {
  id: string;
  tenantId: string;
  scope: BlakeKnowledgeScope;
  actorId?: string;
  category: BlakeKnowledgeCategory;
  title: string;
  content: string;
  sourceConversationId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type Store = { items: BlakeKnowledgeItem[] };
const STORE_KEY = "blake-knowledge-v1";
const store = loadServerStore<Store>(STORE_KEY, { items: [] });

function refresh() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as Store | null;
  if (Array.isArray(snapshot?.items)) store.items = snapshot.items;
}

function persist() {
  store.items = store.items
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10000);
  writeServerStore(STORE_KEY, store);
}

function visibleTo(item: BlakeKnowledgeItem, tenantId: string, actorId: string) {
  if (item.tenantId !== tenantId) return false;
  return item.scope === "company" || item.actorId === actorId;
}

function words(value: string) {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}£%]+/gu) ?? []);
}

function score(item: BlakeKnowledgeItem, query: string) {
  if (!query.trim()) return 0;
  const queryWords = words(query);
  const haystack = words(`${item.title} ${item.content} ${item.category}`);
  let matches = 0;
  for (const word of queryWords) if (word.length > 2 && haystack.has(word)) matches += 1;
  return matches;
}

export function listBlakeKnowledge(input: {
  tenantId: string;
  actorId: string;
  query?: string;
  limit?: number;
}) {
  refresh();
  const visible = store.items.filter((item) => visibleTo(item, input.tenantId, input.actorId));
  const query = input.query?.trim() ?? "";
  const ranked = visible
    .map((item) => ({ item, relevance: score(item, query) }))
    .filter((row) => !query || row.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.item.updatedAt.localeCompare(a.item.updatedAt));
  const fallback = query && !ranked.length
    ? visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => ({ item, relevance: 0 }))
    : ranked;
  return fallback.slice(0, Math.max(1, Math.min(50, input.limit ?? 20))).map((row) => structuredClone(row.item));
}

export function saveBlakeKnowledge(input: {
  tenantId: string;
  actorId: string;
  actorName: string;
  scope: BlakeKnowledgeScope;
  category: BlakeKnowledgeCategory;
  title: string;
  content: string;
  sourceConversationId?: string;
}) {
  refresh();
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) throw new TypeError("Knowledge title and content are required.");
  const existing = store.items.find(
    (item) => item.tenantId === input.tenantId
      && item.scope === input.scope
      && (item.scope === "company" || item.actorId === input.actorId)
      && item.title.toLowerCase() === title.toLowerCase(),
  );
  const now = new Date().toISOString();
  const item: BlakeKnowledgeItem = existing
    ? { ...existing, category: input.category, content, updatedAt: now, sourceConversationId: input.sourceConversationId ?? existing.sourceConversationId }
    : {
      id: `blake-knowledge-${crypto.randomUUID()}`,
      tenantId: input.tenantId,
      scope: input.scope,
      actorId: input.scope === "user" ? input.actorId : undefined,
      category: input.category,
      title,
      content,
      sourceConversationId: input.sourceConversationId,
      createdBy: input.actorName,
      createdAt: now,
      updatedAt: now,
    };
  store.items = [item, ...store.items.filter((row) => row.id !== item.id)];
  persist();
  return structuredClone(item);
}

export function deleteBlakeKnowledge(input: {
  id: string;
  tenantId: string;
  actorId: string;
}) {
  refresh();
  const item = store.items.find((row) => row.id === input.id && visibleTo(row, input.tenantId, input.actorId));
  if (!item) return null;
  store.items = store.items.filter((row) => row.id !== item.id);
  persist();
  return structuredClone(item);
}

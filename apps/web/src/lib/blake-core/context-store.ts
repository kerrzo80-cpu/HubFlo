import type { BlakeChannel, BlakeConversationContext } from "@hubflo/domain";

import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

type ContextStore = { contexts: BlakeConversationContext[] };
const STORE_KEY = "blake-conversation-context-v1";
const store = loadServerStore<ContextStore>(STORE_KEY, { contexts: [] });

function refresh() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as ContextStore | null;
  if (Array.isArray(snapshot?.contexts)) store.contexts = snapshot.contexts;
}

export function getOrCreateBlakeContext(input: {
  id?: string;
  tenantId: string;
  actorId: string;
  channel: BlakeChannel;
}) {
  refresh();
  const existing = input.id
    ? store.contexts.find((item) => item.id === input.id && item.tenantId === input.tenantId && item.actorId === input.actorId)
    : undefined;
  if (existing) return structuredClone(existing);
  const created: BlakeConversationContext = {
    id: input.id || `blake-conversation-${crypto.randomUUID()}`,
    tenantId: input.tenantId,
    actorId: input.actorId,
    channel: input.channel,
    entities: [],
    updatedAt: new Date().toISOString(),
  };
  store.contexts = [created, ...store.contexts].slice(0, 1000);
  writeServerStore(STORE_KEY, store);
  return structuredClone(created);
}

export function patchBlakeContext(
  contextId: string,
  tenantId: string,
  actorId: string,
  patch: Partial<Omit<BlakeConversationContext, "id" | "tenantId" | "actorId">>,
) {
  refresh();
  const index = store.contexts.findIndex((item) => item.id === contextId && item.tenantId === tenantId && item.actorId === actorId);
  if (index < 0) return null;
  const current = store.contexts[index]!;
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  store.contexts[index] = updated;
  writeServerStore(STORE_KEY, store);
  return structuredClone(updated);
}

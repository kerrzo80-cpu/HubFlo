import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

export type BlakeToolMemory = {
  capability: string;
  input: Record<string, unknown>;
  output: unknown;
  executionId?: string;
  createdAt: string;
};

export type BlakeOrchestratorConversation = {
  id: string;
  tenantId: string;
  actorId: string;
  recentTools: BlakeToolMemory[];
  lastUserMessage?: string;
  lastAssistantReply?: string;
  updatedAt: string;
};

export type BlakePendingCapabilityAction = {
  id: string;
  tenantId: string;
  actorId: string;
  actorName: string;
  conversationId?: string;
  channel: "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
  capability: string;
  input: Record<string, unknown>;
  title: string;
  detail: string;
  createdAt: string;
  expiresAt: string;
};

type BlakeOrchestratorStore = {
  conversations: BlakeOrchestratorConversation[];
  pendingActions: BlakePendingCapabilityAction[];
};

const STORE_KEY = "blake-orchestrator-v1";
const store = loadServerStore<BlakeOrchestratorStore>(STORE_KEY, {
  conversations: [],
  pendingActions: [],
});

function refresh() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as BlakeOrchestratorStore | null;
  if (Array.isArray(snapshot?.conversations)) store.conversations = snapshot.conversations;
  if (Array.isArray(snapshot?.pendingActions)) store.pendingActions = snapshot.pendingActions;
  const now = Date.now();
  store.pendingActions = store.pendingActions.filter((item) => Date.parse(item.expiresAt) > now);
}

function persist() {
  store.conversations = store.conversations
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 1500);
  store.pendingActions = store.pendingActions.slice(-1000);
  writeServerStore(STORE_KEY, store);
}

export function getBlakeOrchestratorConversation(input: {
  id?: string;
  tenantId: string;
  actorId: string;
}) {
  refresh();
  if (!input.id) return null;
  const found = store.conversations.find(
    (item) => item.id === input.id && item.tenantId === input.tenantId && item.actorId === input.actorId,
  );
  return found ? structuredClone(found) : null;
}

export function patchBlakeOrchestratorConversation(input: {
  id: string;
  tenantId: string;
  actorId: string;
  patch: Partial<Omit<BlakeOrchestratorConversation, "id" | "tenantId" | "actorId">>;
}) {
  refresh();
  const existing = store.conversations.find(
    (item) => item.id === input.id && item.tenantId === input.tenantId && item.actorId === input.actorId,
  );
  const next: BlakeOrchestratorConversation = {
    id: input.id,
    tenantId: input.tenantId,
    actorId: input.actorId,
    recentTools: [],
    ...existing,
    ...input.patch,
    updatedAt: new Date().toISOString(),
  };
  store.conversations = [
    next,
    ...store.conversations.filter(
      (item) => !(item.id === input.id && item.tenantId === input.tenantId && item.actorId === input.actorId),
    ),
  ];
  persist();
  return structuredClone(next);
}

export function rememberBlakeTool(input: {
  conversationId?: string;
  tenantId: string;
  actorId: string;
  memory: BlakeToolMemory;
}) {
  if (!input.conversationId) return;
  const current = getBlakeOrchestratorConversation({
    id: input.conversationId,
    tenantId: input.tenantId,
    actorId: input.actorId,
  });
  patchBlakeOrchestratorConversation({
    id: input.conversationId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    patch: {
      recentTools: [input.memory, ...(current?.recentTools ?? [])].slice(0, 8),
    },
  });
}

export function saveBlakePendingAction(action: BlakePendingCapabilityAction) {
  refresh();
  store.pendingActions = [
    ...store.pendingActions.filter(
      (item) => !(item.tenantId === action.tenantId
        && item.actorId === action.actorId
        && item.conversationId === action.conversationId),
    ),
    action,
  ];
  persist();
  return structuredClone(action);
}

export function getBlakePendingAction(input: {
  id?: string;
  tenantId: string;
  actorId: string;
  conversationId?: string;
}) {
  refresh();
  const matches = store.pendingActions.filter(
    (item) => item.tenantId === input.tenantId && item.actorId === input.actorId,
  );
  const found = input.id
    ? matches.find((item) => item.id === input.id)
    : [...matches].reverse().find(
      (item) => input.conversationId ? item.conversationId === input.conversationId : !item.conversationId,
    );
  return found ? structuredClone(found) : null;
}

export function removeBlakePendingAction(id: string) {
  refresh();
  store.pendingActions = store.pendingActions.filter((item) => item.id !== id);
  persist();
}

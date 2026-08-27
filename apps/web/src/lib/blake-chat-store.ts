import crypto from "node:crypto";

import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type BlakeChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  aiUsed?: boolean;
  action?: Record<string, unknown>;
};

export type BlakeChat = {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: BlakeChatMessage[];
};

type BlakeChatStore = { chats: BlakeChat[] };

// v1 is intentionally left untouched. A large legacy chat blob was synchronously
// blocking the live Node process long enough for Render's health check to restart
// the whole service whenever /blake loaded.
const STORE_NAME = "blake-user-chats-v2";
const MAX_CHATS_PER_USER = 50;
const MAX_MESSAGES_PER_CHAT = 100;
const MAX_MESSAGE_LENGTH = 12_000;

function readStore() {
  return loadServerStore<BlakeChatStore>(STORE_NAME, { chats: [] });
}

function boundMessages(messages: BlakeChatMessage[]) {
  return messages.slice(-MAX_MESSAGES_PER_CHAT).map((message) => ({
    ...message,
    text: message.text.slice(0, MAX_MESSAGE_LENGTH),
  }));
}

function compactStore(store: BlakeChatStore): BlakeChatStore {
  const perOwner = new Map<string, number>();
  const chats = [...store.chats]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((chat) => {
      const owner = `${chat.tenantId}\u0000${chat.userId}`;
      const count = perOwner.get(owner) || 0;
      if (count >= MAX_CHATS_PER_USER) return false;
      perOwner.set(owner, count + 1);
      return true;
    })
    .map((chat) => ({ ...chat, messages: boundMessages(chat.messages) }));
  return { chats };
}

function saveStore(store: BlakeChatStore) {
  if (!writeServerStore(STORE_NAME, compactStore(store))) {
    throw new Error("Blake could not save the conversation.");
  }
}

function owns(chat: BlakeChat, tenantId: string, userId: string) {
  return chat.tenantId === tenantId && chat.userId === userId;
}

export function listBlakeChats(tenantId: string, userId: string) {
  return readStore().chats
    .filter((chat) => owns(chat, tenantId, userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CHATS_PER_USER)
    .map((chat) => ({ ...chat, messages: boundMessages(chat.messages) }));
}

export function createBlakeChat(tenantId: string, userId: string, title = "New chat") {
  const store = readStore();
  const now = new Date().toISOString();
  const chat: BlakeChat = {
    id: `blake-chat-${crypto.randomUUID()}`,
    tenantId,
    userId,
    title: title.trim().slice(0, 80) || "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  store.chats.push(chat);
  saveStore(store);
  return chat;
}

export function updateBlakeChat(
  tenantId: string,
  userId: string,
  chatId: string,
  patch: { title?: string; messages?: BlakeChatMessage[] },
) {
  const store = readStore();
  const index = store.chats.findIndex((chat) => chat.id === chatId && owns(chat, tenantId, userId));
  if (index < 0) return null;
  const current = store.chats[index];
  const messages = Array.isArray(patch.messages) ? boundMessages(patch.messages) : current.messages;
  const automaticTitle = current.title === "New chat" && messages[0]?.role === "user"
    ? messages[0].text.trim().replace(/\s+/g, " ").slice(0, 54)
    : current.title;
  const next: BlakeChat = {
    ...current,
    title: patch.title?.trim().slice(0, 80) || automaticTitle,
    messages,
    updatedAt: new Date().toISOString(),
  };
  store.chats[index] = next;
  saveStore(store);
  return next;
}

export function deleteBlakeChat(tenantId: string, userId: string, chatId: string) {
  const store = readStore();
  const before = store.chats.length;
  store.chats = store.chats.filter((chat) => !(chat.id === chatId && owns(chat, tenantId, userId)));
  if (store.chats.length === before) return false;
  saveStore(store);
  return true;
}

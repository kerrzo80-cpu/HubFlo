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

const STORE_NAME = "blake-user-chats-v1";

function readStore() {
  return loadServerStore<BlakeChatStore>(STORE_NAME, { chats: [] });
}

function saveStore(store: BlakeChatStore) {
  if (!writeServerStore(STORE_NAME, store)) throw new Error("Blake could not save the conversation.");
}

function owns(chat: BlakeChat, tenantId: string, userId: string) {
  return chat.tenantId === tenantId && chat.userId === userId;
}

export function listBlakeChats(tenantId: string, userId: string) {
  return readStore().chats
    .filter((chat) => owns(chat, tenantId, userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const messages = Array.isArray(patch.messages) ? patch.messages.slice(-200) : current.messages;
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

import type { BlakeChannel } from "@hubflo/domain";

export type MobileUser = { id: string; name: string; role: string; mustChangePassword?: boolean };
export type BlakeResultCard = {
  kind: "management_report" | "invoice_summary";
  title: string;
  subtitle?: string;
  metrics: Array<{ label: string; value: string; tone?: "default" | "positive" | "warning" | "danger" }>;
  rows?: Array<{ id: string; primary: string; secondary: string; value?: string; status?: string }>;
};
export type BlakeMessage = { id?: string; role: "user" | "assistant"; text: string; createdAt?: string; aiUsed?: boolean; card?: BlakeResultCard; action?: BlakeAction };
export type BlakeAction = { id: string; title: string; detail: string; confirmLabel: string; kind?: string };
export type BlakeChat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: BlakeMessage[];
};

const DEFAULT_API_URL = "https://nexa-live.onrender.com";

function apiUrl() {
  return process.env.EXPO_PUBLIC_NEXA_API_URL?.replace(/\/$/, "") || DEFAULT_API_URL;
}

async function json<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl()}${path}`, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `NeXa returned ${response.status}.`);
  return body;
}

export async function signIn(username: string, password: string) {
  return json<{ user: MobileUser; sessionToken: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nexa-client": "blake-mobile" },
    body: JSON.stringify({ username, password }),
  });
}

export async function askBlake(input: {
  token: string;
  message: string;
  history: BlakeMessage[];
  channel?: Extract<BlakeChannel, "mobile_text" | "mobile_voice">;
}) {
  return json<{ reply: string; data?: { resultCard?: BlakeResultCard }; action?: { id: string; title: string; detail: string; confirmLabel: string } }>("/api/nexa-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.token}`, "x-nexa-client": "blake-mobile" },
    body: JSON.stringify({ message: input.message, history: input.history, channel: input.channel || "mobile_text" }),
  });
}

export async function confirmBlakeAction(token: string, actionId: string) {
  return json<{ reply: string }>("/api/nexa-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-nexa-client": "blake-mobile" },
    body: JSON.stringify({ confirmActionId: actionId, channel: "mobile_text" }),
  });
}

function mobileHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-nexa-client": "blake-mobile" };
}

export async function listBlakeChats(token: string) {
  return json<{ chats: BlakeChat[] }>("/api/blake/chats", { headers: mobileHeaders(token) });
}

export async function createBlakeChat(token: string) {
  return json<{ chat: BlakeChat }>("/api/blake/chats", {
    method: "POST",
    headers: mobileHeaders(token),
    body: "{}",
  });
}

export async function saveBlakeChat(token: string, chat: BlakeChat) {
  return json<{ chat: BlakeChat }>("/api/blake/chats", {
    method: "PATCH",
    headers: mobileHeaders(token),
    body: JSON.stringify({ id: chat.id, title: chat.title, messages: chat.messages }),
  });
}

export async function renameBlakeChat(token: string, chatId: string, title: string) {
  return json<{ chat: BlakeChat }>("/api/blake/chats", {
    method: "PATCH",
    headers: mobileHeaders(token),
    body: JSON.stringify({ id: chatId, title }),
  });
}

export async function deleteBlakeChat(token: string, chatId: string) {
  return json<{ ok: true }>(`/api/blake/chats?id=${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: mobileHeaders(token),
  });
}

export async function transcribeBlakeRecording(token: string, uri: string) {
  const form = new FormData();
  form.append("audio", { uri, name: "blake-voice.m4a", type: "audio/m4a" } as unknown as Blob);
  return json<{ text: string }>("/api/field/ask-blake/transcribe", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-nexa-client": "blake-mobile" },
    body: form,
  });
}

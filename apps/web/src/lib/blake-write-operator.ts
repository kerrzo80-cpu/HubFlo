import type { AccessProfile } from "@/lib/access";
import { blakeCore } from "@/lib/blake-core";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";

type Channel = "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
type HistoryMessage = { role: "user" | "assistant"; text: string };

type SupportedWriteCapability = "create_quote" | "update_quote" | "create_job" | "update_job";
type WriteStatus = "collecting" | "awaiting_confirmation";

type WriteInput = {
  ref?: string;
  customer?: string;
  site?: string;
  description?: string;
  owner?: string;
  status?: string;
  value?: number;
  next?: string;
  due?: string;
  manager?: string;
};

type PendingWriteAction = {
  id: string;
  kind: "blake_capability";
  actorId: string;
  actorName: string;
  tenantId: string;
  conversationId?: string;
  channel: Channel;
  capability: SupportedWriteCapability;
  input: WriteInput;
  status: WriteStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type WriteStore = { actions: PendingWriteAction[] };

export type BlakeWriteResponse = {
  reply: string;
  aiUsed: boolean;
  intent: { action: "chat" };
  status?: number;
  action?: {
    id: string;
    kind: "confirm_blake_capability";
    title: string;
    detail: string;
    confirmLabel: string;
  };
};

export type BlakeWriteActor = {
  id: string;
  name: string;
  tenantId: string;
  channel: Channel;
};

const STORE_KEY = "blake-write-actions-v1";
const store = loadServerStore<WriteStore>(STORE_KEY, { actions: [] });
const lifetimeMs = 45 * 60 * 1000;
const supported: SupportedWriteCapability[] = ["create_quote", "update_quote", "create_job", "update_job"];

function refreshStore() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as WriteStore | null;
  if (Array.isArray(snapshot?.actions)) store.actions = snapshot.actions;
  const now = Date.now();
  store.actions = store.actions.filter((item) => Date.parse(item.expiresAt) > now);
}

function persistStore() {
  store.actions = store.actions.slice(-500);
  writeServerStore(STORE_KEY, store);
}

function normaliseRef(value?: string) {
  return value?.trim().toUpperCase().replace(/\s+/g, "-") || undefined;
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[£,\s]/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function sameConversation(action: PendingWriteAction, actor: BlakeWriteActor, conversationId?: string) {
  if (action.actorId !== actor.id || action.tenantId !== actor.tenantId) return false;
  if (conversationId) return action.conversationId === conversationId;
  return !action.conversationId;
}

function activeFor(actor: BlakeWriteActor, conversationId?: string) {
  refreshStore();
  return [...store.actions]
    .reverse()
    .find((item) => sameConversation(item, actor, conversationId));
}

function removeAction(id: string) {
  store.actions = store.actions.filter((item) => item.id !== id);
  persistStore();
}

function saveAction(action: PendingWriteAction) {
  refreshStore();
  store.actions = [
    ...store.actions.filter((item) => !(item.actorId === action.actorId && item.tenantId === action.tenantId && item.conversationId === action.conversationId)),
    action,
  ];
  persistStore();
}

function isConfirmation(message: string) {
  return /^(?:yes|yep|yeah|confirm|confirmed|do it|go ahead|proceed|please do|create it|save it|update it|make it)[.!\s]*$/i.test(message.trim());
}

function isCancellation(message: string) {
  return /^(?:no|cancel|cancel it|stop|don't|dont|do not|leave it|forget it)[.!\s]*$/i.test(message.trim());
}

export function looksLikeBlakeWriteRequest(message: string) {
  if (/^\s*(?:how|where|why|what do i need|show me how)\b/i.test(message)) return false;
  const entity = /\b(?:quote|quotation|job)\b|\b[QJ][-\s]?\d{3,6}\b/i.test(message);
  const verb = /\b(?:create|make|add|start|open|set up|new|change|update|edit|amend|rename|set|mark|move)\b/i.test(message);
  return entity && verb;
}

function allowedCapabilities(access: AccessProfile) {
  const definitions = blakeCore.definitions();
  return definitions
    .filter((item) => supported.includes(item.name as SupportedWriteCapability))
    .filter((item) => item.requiredPermissions.every((permission) => access[permission as keyof AccessProfile] === true))
    .map((item) => item.name as SupportedWriteCapability);
}

function actionFromMessage(message: string, allowed: SupportedWriteCapability[], existing?: SupportedWriteCapability) {
  if (existing && allowed.includes(existing)) return existing;
  const lower = message.toLowerCase();
  const isUpdate = /\b(change|update|edit|amend|rename|set|mark|move)\b/.test(lower)
    || /\b[QJ][-\s]?\d{3,6}\b/i.test(message);
  if (/\bquote|quotation\b/.test(lower) || /\bQ[-\s]?\d{3,6}\b/i.test(message)) {
    const action: SupportedWriteCapability = isUpdate ? "update_quote" : "create_quote";
    return allowed.includes(action) ? action : undefined;
  }
  if (/\bjob\b/.test(lower) || /\bJ[-\s]?\d{3,6}\b/i.test(message)) {
    const action: SupportedWriteCapability = isUpdate ? "update_job" : "create_job";
    return allowed.includes(action) ? action : undefined;
  }
  return undefined;
}

function localExtract(message: string, current: WriteInput = {}) {
  const next = { ...current };
  const ref = message.match(/\b([QJ])[-\s]?(\d{3,6})\b/i);
  if (ref) next.ref = `${ref[1]!.toUpperCase()}-${ref[2]}`;
  const money = message.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  if (money) next.value = Number(money[1]!.replace(/,/g, ""));

  const labelled = (label: string) => message.match(new RegExp(`(?:^|[\\n,;])\\s*(?:${label})\\s*[:=-]\\s*([^\\n,;]+)`, "i"))?.[1]?.trim();
  next.customer = labelled("customer|client") || next.customer;
  next.site = labelled("site|address|site address") || next.site;
  next.description = labelled("description|title|scope|work|job description|quote description") || next.description;

  const named = message.match(/\b(?:called|named|titled)\s+["“]?(.+?)["”]?(?=\s+(?:for\s+£|at\s+£|worth\b|value\b)|[,.]|$)/i)?.[1]?.trim();
  if (named) next.description = named;
  const quoteCustomer = message.match(/\b(?:quote|quotation)\s+(?:for|to)\s+(.+?)(?=\s+(?:called|named|titled|for\s+£|at\s+£|worth\b|value\b)|[,.]|$)/i)?.[1]?.trim();
  if (quoteCustomer) next.customer = quoteCustomer;

  const status = message.match(/\bstatus\s+(?:to|as|is)\s+([^,.;]+)/i)?.[1]?.trim();
  if (status) next.status = status;
  const manager = message.match(/\bmanager\s+(?:to|as|is)\s+([^,.;]+)/i)?.[1]?.trim();
  if (manager) next.manager = manager;
  const owner = message.match(/\bowner\s+(?:to|as|is)\s+([^,.;]+)/i)?.[1]?.trim();
  if (owner) next.owner = owner;
  const due = message.match(/\bdue\s+(?:on|by|is)?\s*([^,.;]+)/i)?.[1]?.trim();
  if (due) next.due = due;
  const nextAction = message.match(/\bnext\s+(?:action\s+)?(?:to|as|is)?\s*([^,.;]+)/i)?.[1]?.trim();
  if (nextAction) next.next = nextAction;
  return next;
}

function mergeInput(current: WriteInput, incoming: Record<string, unknown> | undefined) {
  const merged: WriteInput = { ...current };
  if (!incoming) return merged;
  const stringKeys: Array<keyof WriteInput> = ["ref", "customer", "site", "description", "owner", "status", "next", "due", "manager"];
  for (const key of stringKeys) {
    const value = cleanString(incoming[key]);
    if (value !== undefined) (merged as Record<string, unknown>)[key] = key === "ref" ? normaliseRef(value) : value;
  }
  const value = cleanNumber(incoming.value);
  if (value !== undefined) merged.value = value;
  return merged;
}

async function planWithOpenAi(
  message: string,
  history: HistoryMessage[],
  allowed: SupportedWriteCapability[],
  existing?: PendingWriteAction,
) {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;
  const model = process.env.BLAKE_MODEL?.trim()
    || process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || "gpt-4.1-mini";
  const recentHistory = history.slice(-10).map((item) => `${item.role}: ${item.text}`).join("\n");
  const current = existing ? JSON.stringify({ capability: existing.capability, input: existing.input }) : "none";
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "You are Blake's NeXa write-action planner.",
                `Only these actions are authorised for the current user: ${allowed.join(", ")}.`,
                "Choose an action only when the user is asking Blake to actually change NeXa, not when they are asking how something works.",
                "Extract only facts explicitly supplied by the user or clearly established in the recent conversation. Never invent a customer, site, description, reference, money value, date, status or person.",
                "For create_quote: customer means the customer/client; description is the quote title/scope (for example text after called/named).",
                "For create_job: customer, site and description must be known before confirmation.",
                "For update_quote/update_job: preserve the Q-/J- reference and only include fields the user actually wants changed.",
                "Job health is derived by NeXa from operational state and is not directly editable through this workflow.",
                `Existing write draft: ${current}`,
                recentHistory ? `Recent conversation:\n${recentHistory}` : "",
              ].filter(Boolean).join("\n"),
            }],
          },
          { role: "user", content: [{ type: "input_text", text: message }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "blake_write_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: { type: "string", enum: ["none", ...allowed] },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    ref: { type: ["string", "null"] },
                    customer: { type: ["string", "null"] },
                    site: { type: ["string", "null"] },
                    description: { type: ["string", "null"] },
                    owner: { type: ["string", "null"] },
                    status: { type: ["string", "null"] },
                    value: { type: ["number", "null"] },
                    next: { type: ["string", "null"] },
                    due: { type: ["string", "null"] },
                    manager: { type: ["string", "null"] },
                  },
                  required: ["ref", "customer", "site", "description", "owner", "status", "value", "next", "due", "manager"],
                },
              },
              required: ["action", "fields"],
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const output = body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!output) return null;
    const parsed = JSON.parse(output) as { action?: string; fields?: Record<string, unknown> };
    if (!parsed.action || parsed.action === "none" || !allowed.includes(parsed.action as SupportedWriteCapability)) {
      return { action: undefined, fields: parsed.fields ?? {} };
    }
    return { action: parsed.action as SupportedWriteCapability, fields: parsed.fields ?? {} };
  } catch {
    return null;
  }
}

function changeCount(input: WriteInput) {
  return [input.site, input.description, input.owner, input.status, input.value, input.next, input.due, input.manager]
    .filter((value) => value !== undefined).length;
}

function missingFor(capability: SupportedWriteCapability, input: WriteInput) {
  const missing: string[] = [];
  if (capability === "create_quote") {
    if (!input.customer) missing.push("customer name");
    if (!input.description) missing.push("quote description / title");
  } else if (capability === "create_job") {
    if (!input.customer) missing.push("customer name");
    if (!input.site) missing.push("site address");
    if (!input.description) missing.push("job description");
  } else {
    if (!input.ref) missing.push(capability === "update_quote" ? "quote reference" : "job reference");
    if (changeCount(input) === 0) missing.push("what you want changed");
  }
  return missing;
}

function money(value?: number) {
  return value === undefined ? "" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function summaryFor(capability: SupportedWriteCapability, input: WriteInput) {
  if (capability === "create_quote") {
    return `Create a Draft quote for ${input.customer} — ${input.description}${input.value !== undefined ? ` — ${money(input.value)}` : ""}.`;
  }
  if (capability === "create_job") {
    return `Create a job for ${input.customer} at ${input.site} — ${input.description}${input.value !== undefined ? ` — ${money(input.value)}` : ""}.`;
  }
  const changes = [
    input.description ? `description: ${input.description}` : null,
    input.site ? `site: ${input.site}` : null,
    input.owner ? `owner: ${input.owner}` : null,
    input.manager ? `manager: ${input.manager}` : null,
    input.status ? `status: ${input.status}` : null,
    input.value !== undefined ? `value: ${money(input.value)}` : null,
    input.next ? `next: ${input.next}` : null,
    input.due ? `due: ${input.due}` : null,
  ].filter(Boolean).join("; ");
  return `Update ${input.ref}: ${changes}.`;
}

function capabilityLabel(capability: SupportedWriteCapability) {
  return capability.replaceAll("_", " ");
}

function confirmationResponse(action: PendingWriteAction): BlakeWriteResponse {
  const summary = summaryFor(action.capability, action.input);
  return {
    reply: `${summary}\n\nReady to make this change in NeXa. Confirm?`,
    aiUsed: true,
    intent: { action: "chat" },
    action: {
      id: action.id,
      kind: "confirm_blake_capability",
      title: "Review Blake action",
      detail: summary,
      confirmLabel: "Confirm",
    },
  };
}

function successReply(capability: SupportedWriteCapability, data: Record<string, unknown>) {
  const ref = cleanString(data.ref);
  const customer = cleanString(data.customer);
  const site = cleanString(data.site);
  if (capability === "create_quote") return `Done — ${ref ?? "the quote"} was created${customer ? ` for ${customer}` : ""}.`;
  if (capability === "create_job") return `Done — ${ref ?? "the job"} was created${customer ? ` for ${customer}` : ""}${site ? ` at ${site}` : ""}.`;
  return `Done — ${ref ?? (capability === "update_quote" ? "the quote" : "the job")} was updated.`;
}

export async function confirmBlakeWriteAction(
  actionId: string,
  actor: BlakeWriteActor,
  access: AccessProfile,
) {
  refreshStore();
  const action = store.actions.find((item) => item.id === actionId && item.actorId === actor.id && item.tenantId === actor.tenantId);
  if (!action) return { ok: false as const, status: 404, reply: "That Blake action has expired. Ask me to make the change again." };
  if (action.status !== "awaiting_confirmation") {
    return { ok: false as const, status: 409, reply: "That action still needs more information before it can be confirmed." };
  }
  const result = await blakeCore.execute<Record<string, unknown>>(action.capability, action.input, {
    actor: { id: actor.id, name: actor.name, tenantId: actor.tenantId, channel: actor.channel },
    access,
    conversationId: action.conversationId,
    confirmed: true,
  });
  if (!result.ok || !result.data) {
    const status = result.error?.code === "INVALID_INPUT" ? 400
      : result.error?.code === "NOT_FOUND" ? 404
        : result.error?.code === "FORBIDDEN" ? 403
          : 409;
    return { ok: false as const, status, reply: result.error?.message || "Blake could not complete that change. Nothing was saved." };
  }
  removeAction(action.id);
  return { ok: true as const, status: 200, reply: successReply(action.capability, result.data) };
}

export async function handleBlakeWriteMessage(
  message: string,
  actor: BlakeWriteActor,
  access: AccessProfile,
  history: HistoryMessage[] = [],
  conversationId?: string,
): Promise<BlakeWriteResponse | null> {
  const active = activeFor(actor, conversationId);
  if (active?.status === "awaiting_confirmation" && isConfirmation(message)) {
    const confirmed = await confirmBlakeWriteAction(active.id, actor, access);
    return { reply: confirmed.reply, aiUsed: false, intent: { action: "chat" }, status: confirmed.status };
  }
  if (active && isCancellation(message)) {
    removeAction(active.id);
    return { reply: "Cancelled — I have not changed anything in NeXa.", aiUsed: false, intent: { action: "chat" } };
  }
  if (!active && !looksLikeBlakeWriteRequest(message)) return null;

  const allowed = allowedCapabilities(access);
  if (!allowed.length) {
    return {
      reply: "Your current NeXa role does not allow Blake to create or edit quotes/jobs.",
      aiUsed: false,
      intent: { action: "chat" },
      status: 403,
    };
  }

  const local = localExtract(message, active?.input ?? {});
  const planned = await planWithOpenAi(message, history, allowed, active);
  const capability = planned?.action
    ?? actionFromMessage(message, allowed, active?.capability);
  if (!capability) {
    if (active) {
      return {
        reply: `I still have the ${capabilityLabel(active.capability)} draft open. Tell me the missing/change details, or say cancel.`,
        aiUsed: Boolean(planned),
        intent: { action: "chat" },
      };
    }
    return null;
  }

  const input = mergeInput(local, planned?.fields);
  const missing = missingFor(capability, input);
  const now = new Date();
  const nextAction: PendingWriteAction = {
    id: active?.id ?? `blake-write-${crypto.randomUUID()}`,
    kind: "blake_capability",
    actorId: actor.id,
    actorName: actor.name,
    tenantId: actor.tenantId,
    conversationId,
    channel: actor.channel,
    capability,
    input,
    status: missing.length ? "collecting" : "awaiting_confirmation",
    createdAt: active?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
  };
  saveAction(nextAction);

  if (missing.length) {
    return {
      reply: `I can ${capabilityLabel(capability)}. I still need: ${missing.join(", ")}.`,
      aiUsed: Boolean(planned),
      intent: { action: "chat" },
    };
  }
  return confirmationResponse(nextAction);
}

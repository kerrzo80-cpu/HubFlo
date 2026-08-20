import type { AccessProfile } from "@/lib/access";
import {
  createLead,
  getLeads,
  updateLead,
  type LeadDraftFromClient,
  type LeadPatchPayload,
  type LeadSource,
} from "@/lib/lead-store";
import type { BlakeHistoryMessage, NexaAssistantResponse } from "@/lib/nexa-assistant";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { appendAuditEvent } from "@/lib/people-data";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import {
  createJob,
  createQuote,
  getJobs,
  getQuotes,
  updateJob,
  updateQuote,
  type Job,
  type Quote,
} from "@/lib/workflow-data";

export type BlakeOperatorCapability =
  | "create_lead"
  | "update_lead"
  | "create_quote"
  | "update_quote"
  | "create_job"
  | "update_job";

type OperatorFields = {
  customerName?: string;
  customer?: string;
  address?: string;
  phone?: string;
  email?: string;
  description?: string;
  source?: string;
  status?: string;
  surveyor?: string;
  surveyDate?: string;
  surveyTime?: string;
  owner?: string;
  value?: number;
  next?: string;
  due?: string;
  site?: string;
  manager?: string;
  health?: string;
};

type OperatorPlan = {
  action: BlakeOperatorCapability | "none";
  targetRef?: string;
  fields: OperatorFields;
};

type PendingOperatorAction = {
  id: string;
  actorId: string;
  actorName: string;
  capability: BlakeOperatorCapability;
  targetRef?: string;
  fields: OperatorFields;
  summary: string;
  createdAt: string;
  expiresAt: string;
};

type PendingOperatorStore = { actions: PendingOperatorAction[] };

const pendingStore = loadServerStore<PendingOperatorStore>("blake-operator-actions", { actions: [] });
const pendingLifetimeMs = 30 * 60 * 1000;
const leadSources: LeadSource[] = ["Phone call", "Checkatrade", "Email", "Website", "Referral"];
const quoteStatuses: Quote["status"][] = ["Draft", "Sent", "Accepted", "Declined", "Converted", "Lost"];
const jobHealth: Job["health"][] = ["red", "amber", "green", "blue"];

function refreshPendingStore() {
  const snapshot = readServerStoreSnapshot("blake-operator-actions") as PendingOperatorStore | null;
  if (snapshot?.actions) pendingStore.actions = snapshot.actions;
  pendingStore.actions = pendingStore.actions.filter((item) => Date.parse(item.expiresAt) > Date.now());
}

function persistPendingStore() {
  writeServerStore("blake-operator-actions", pendingStore);
}

function normalise(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function text(value?: string) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function number(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function permissionAllows(access: AccessProfile, capability: BlakeOperatorCapability) {
  switch (capability) {
    case "create_lead":
    case "update_lead":
      return access.canCreateLead;
    case "create_quote":
    case "update_quote":
      return access.canCreateQuote;
    case "create_job":
      return access.canCreateJob;
    case "update_job":
      return access.canEditJobs;
  }
}

export function listPermittedBlakeCapabilities(access: AccessProfile) {
  const all: BlakeOperatorCapability[] = [
    "create_lead",
    "update_lead",
    "create_quote",
    "update_quote",
    "create_job",
    "update_job",
  ];
  return all.filter((capability) => permissionAllows(access, capability));
}

function isConfirmation(message: string) {
  return /^(?:yes|yep|yeah|correct|confirm|confirmed|do it|go ahead|proceed|please do|create it|save it|update it)[.!\s]*$/i.test(message.trim());
}

function isCancellation(message: string) {
  return /^(?:no|cancel|cancel it|stop|don't|dont|do not|leave it)[.!\s]*$/i.test(message.trim());
}

function looksLikeOperatorConversation(message: string, history: BlakeHistoryMessage[]) {
  if (/\b(create|make|new|change|update|edit|amend|rename|mark|set)\b/i.test(message)) return true;
  return history.slice(-5).some((item) =>
    item.role === "assistant"
      && /\b(to create|to update|ready to (?:create|update)|before i (?:create|update)|still need).*\b(lead|quote|job)\b/i.test(item.text),
  );
}

function latestPendingForActor(actorId: string) {
  refreshPendingStore();
  return pendingStore.actions
    .filter((item) => item.actorId === actorId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function removePending(id: string) {
  pendingStore.actions = pendingStore.actions.filter((item) => item.id !== id);
  persistPendingStore();
}

function sameRef(left?: string, right?: string) {
  return normalise(left).replace(/\s+/g, "-") === normalise(right).replace(/\s+/g, "-");
}

function findLeadByRef(ref?: string) {
  return getLeads().find((lead) => sameRef(lead.ref, ref));
}

function findQuoteByRef(ref?: string) {
  return getQuotes().find((quote) => sameRef(quote.ref, ref));
}

function findJobByRef(ref?: string) {
  return getJobs().find((job) => sameRef(job.ref, ref));
}

function requiredMissing(plan: OperatorPlan) {
  const f = plan.fields;
  switch (plan.action) {
    case "create_lead": {
      const missing: string[] = [];
      if (!text(f.customerName ?? f.customer)) missing.push("customer name");
      if (!text(f.address ?? f.site)) missing.push("site address");
      if (!text(f.description)) missing.push("enquiry / work description");
      if (!leadSources.some((source) => normalise(source) === normalise(f.source))) {
        missing.push("lead source (Phone call, Checkatrade, Email, Website or Referral)");
      }
      return missing;
    }
    case "create_quote": {
      const missing: string[] = [];
      if (!text(f.customer ?? f.customerName)) missing.push("customer name");
      if (!text(f.description)) missing.push("quote description");
      return missing;
    }
    case "create_job": {
      const missing: string[] = [];
      if (!text(f.customer ?? f.customerName)) missing.push("customer name");
      if (!text(f.description)) missing.push("job description");
      return missing;
    }
    case "update_lead":
      return text(plan.targetRef) ? [] : ["lead reference"];
    case "update_quote":
      return text(plan.targetRef) ? [] : ["quote reference"];
    case "update_job":
      return text(plan.targetRef) ? [] : ["job reference"];
    default:
      return [];
  }
}

function hasAnyChange(fields: OperatorFields) {
  return Object.values(fields).some((value) =>
    typeof value === "number" ? Number.isFinite(value) : Boolean(text(typeof value === "string" ? value : undefined)),
  );
}

function describeFields(fields: OperatorFields) {
  return Object.entries(fields)
    .filter(([, value]) => typeof value === "number" ? Number.isFinite(value) : Boolean(text(typeof value === "string" ? value : undefined)))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function summaryFor(plan: OperatorPlan) {
  const f = plan.fields;
  switch (plan.action) {
    case "create_lead":
      return `Create a lead for ${text(f.customerName ?? f.customer)} at ${text(f.address ?? f.site)} · ${text(f.description)}.`;
    case "create_quote":
      return `Create a Draft quote for ${text(f.customer ?? f.customerName)} · ${text(f.description)}${number(f.value) !== undefined ? ` · £${number(f.value)!.toLocaleString("en-GB")}` : ""}.`;
    case "create_job":
      return `Create a job for ${text(f.customer ?? f.customerName)}${text(f.site ?? f.address) ? ` at ${text(f.site ?? f.address)}` : ""} · ${text(f.description)}.`;
    case "update_lead":
    case "update_quote":
    case "update_job":
      return `Update ${plan.targetRef} with: ${describeFields(f)}.`;
    default:
      return "";
  }
}

function humanCapability(capability: BlakeOperatorCapability) {
  return capability.replaceAll("_", " ");
}

async function planOperatorAction(
  message: string,
  history: BlakeHistoryMessage[],
  access: AccessProfile,
): Promise<OperatorPlan | null> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;
  const allowed = listPermittedBlakeCapabilities(access);
  if (!allowed.length) return null;
  const model = process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || "gpt-4.1-mini";
  const recentHistory = history.slice(-10).map((item) => `${item.role}: ${item.text}`).join("\n");

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
                `The logged-in user is authorised for only these write capabilities: ${allowed.join(", ")}.`,
                "Select one authorised capability only when the user wants NeXa changed. Otherwise return none.",
                "Extract only facts explicitly supplied by the user or clearly established in the recent conversation. Never invent record references, names, addresses, descriptions, dates or money values.",
                "Do not treat staff diary booking/scheduling as these capabilities; return none because the existing scheduler handler owns that workflow.",
                "create_quote defaults to Draft. create_job safely defaults status, health, value, next and due when omitted.",
                "Updates require the relevant L-/Q-/J- reference. Use a reference already established in the recent conversation when unambiguous.",
                recentHistory ? `Recent conversation:\n${recentHistory}` : "",
              ].filter(Boolean).join("\n"),
            }],
          },
          { role: "user", content: [{ type: "input_text", text: message }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "blake_operator_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                action: { type: "string", enum: ["none", ...allowed] },
                targetRef: { type: ["string", "null"] },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    customerName: { type: ["string", "null"] },
                    customer: { type: ["string", "null"] },
                    address: { type: ["string", "null"] },
                    phone: { type: ["string", "null"] },
                    email: { type: ["string", "null"] },
                    description: { type: ["string", "null"] },
                    source: { type: ["string", "null"] },
                    status: { type: ["string", "null"] },
                    surveyor: { type: ["string", "null"] },
                    surveyDate: { type: ["string", "null"] },
                    surveyTime: { type: ["string", "null"] },
                    owner: { type: ["string", "null"] },
                    value: { type: ["number", "null"] },
                    next: { type: ["string", "null"] },
                    due: { type: ["string", "null"] },
                    site: { type: ["string", "null"] },
                    manager: { type: ["string", "null"] },
                    health: { type: ["string", "null"] },
                  },
                  required: [
                    "customerName", "customer", "address", "phone", "email", "description", "source",
                    "status", "surveyor", "surveyDate", "surveyTime", "owner", "value", "next", "due",
                    "site", "manager", "health",
                  ],
                },
              },
              required: ["action", "targetRef", "fields"],
            },
          },
        },
      }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const output = body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!output) return null;
    const parsed = JSON.parse(output) as {
      action?: string;
      targetRef?: string | null;
      fields?: Record<string, string | number | null>;
    };
    if (!parsed.action || parsed.action === "none") return { action: "none", fields: {} };
    if (!allowed.includes(parsed.action as BlakeOperatorCapability)) return { action: "none", fields: {} };
    const fields: OperatorFields = {};
    Object.entries(parsed.fields ?? {}).forEach(([key, value]) => {
      if (value !== null) (fields as Record<string, string | number>)[key] = value;
    });
    return {
      action: parsed.action as BlakeOperatorCapability,
      targetRef: text(parsed.targetRef ?? undefined),
      fields,
    };
  } catch {
    return null;
  }
}

function createPending(plan: OperatorPlan, actor: { id: string; name: string }) {
  refreshPendingStore();
  const now = new Date();
  const pending: PendingOperatorAction = {
    id: `blake-operator-${crypto.randomUUID()}`,
    actorId: actor.id,
    actorName: actor.name,
    capability: plan.action as BlakeOperatorCapability,
    targetRef: plan.targetRef,
    fields: plan.fields,
    summary: summaryFor(plan),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + pendingLifetimeMs).toISOString(),
  };
  pendingStore.actions = [pending, ...pendingStore.actions.filter((item) => item.actorId !== actor.id)];
  persistPendingStore();
  return pending;
}

function confirmationResponse(pending: PendingOperatorAction): NexaAssistantResponse {
  return {
    reply: `${pending.summary}\n\nReady to make this change in NeXa. Confirm?`,
    intent: { action: "chat" },
    action: {
      id: pending.id,
      // Reuse the existing confirmation-card transport. The backend now resolves the ID
      // against generic Blake actions before trying the legacy diary-booking action.
      kind: "confirm_booking",
      title: "Review Blake action",
      detail: pending.summary,
      confirmLabel: "Confirm",
    },
    aiUsed: true,
  };
}

function audit(actor: string, action: string, recordType: string, recordId: string, summary: string) {
  appendAuditEvent({
    actor,
    action,
    recordType,
    recordId,
    summary,
    source: "Blake",
    importance: "high",
  });
}

function executePending(pending: PendingOperatorAction, access: AccessProfile) {
  if (!permissionAllows(access, pending.capability)) {
    return {
      ok: false as const,
      status: 403,
      reply: `Your current NeXa role is not allowed to ${humanCapability(pending.capability)}. Nothing was changed.`,
    };
  }
  const f = pending.fields;

  switch (pending.capability) {
    case "create_lead": {
      const source = leadSources.find((item) => normalise(item) === normalise(f.source));
      if (!source) return { ok: false as const, status: 400, reply: "The lead source is missing or invalid. Nothing was created." };
      const payload: LeadDraftFromClient = {
        source,
        customerName: text(f.customerName ?? f.customer)!,
        phone: text(f.phone) ?? "",
        email: text(f.email) ?? "",
        address: text(f.address ?? f.site)!,
        description: text(f.description)!,
        status: "Needs scheduling",
        surveyor: text(f.surveyor) ?? "",
        surveyDate: text(f.surveyDate) ?? "",
        surveyTime: text(f.surveyTime) ?? "",
        createdBy: pending.actorName,
        next: text(f.next) ?? "Check diary and book survey appointment.",
      };
      const result = createLead(payload, pending.actorName);
      return {
        ok: true as const,
        status: 200,
        reply: `Done — ${result.lead.ref} was created for ${result.lead.customerName} at ${result.lead.address}.`,
      };
    }
    case "update_lead": {
      const lead = findLeadByRef(pending.targetRef);
      if (!lead) return { ok: false as const, status: 404, reply: `I cannot find ${pending.targetRef}. Nothing was changed.` };
      const patch: LeadPatchPayload = {};
      if (text(f.status)) patch.status = text(f.status) as LeadPatchPayload["status"];
      if (text(f.surveyor)) patch.surveyor = text(f.surveyor);
      if (text(f.surveyDate)) patch.surveyDate = text(f.surveyDate);
      if (text(f.surveyTime)) patch.surveyTime = text(f.surveyTime);
      if (text(f.next)) patch.next = text(f.next);
      const updated = updateLead(lead.id, patch, pending.actorName);
      if (!updated) return { ok: false as const, status: 409, reply: `${lead.ref} could not be updated. Nothing was changed.` };
      audit(pending.actorName, "updated by Blake", "lead", updated.id, `${updated.ref} updated through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${updated.ref} was updated.` };
    }
    case "create_quote": {
      const status = quoteStatuses.find((item) => normalise(item) === normalise(f.status)) ?? "Draft";
      const quote = createQuote({
        customer: text(f.customer ?? f.customerName)!,
        description: text(f.description)!,
        owner: text(f.owner) ?? pending.actorName,
        status,
        value: number(f.value) ?? 0,
        next: text(f.next) ?? "Build scope and pricing.",
        due: text(f.due) ?? "Unscheduled",
      });
      audit(pending.actorName, "created by Blake", "quote", quote.id, `${quote.ref} created for ${quote.customer} through Blake.`);
      return {
        ok: true as const,
        status: 200,
        reply: `Done — ${quote.ref} was created for ${quote.customer}${quote.value ? ` at £${quote.value.toLocaleString("en-GB")}` : ""}.`,
      };
    }
    case "update_quote": {
      const quote = findQuoteByRef(pending.targetRef);
      if (!quote) return { ok: false as const, status: 404, reply: `I cannot find ${pending.targetRef}. Nothing was changed.` };
      const updates: Partial<Quote> = {};
      if (text(f.customer ?? f.customerName)) updates.customer = text(f.customer ?? f.customerName)!;
      if (text(f.description)) updates.description = text(f.description)!;
      if (text(f.owner)) updates.owner = text(f.owner)!;
      if (text(f.status)) {
        const status = quoteStatuses.find((item) => normalise(item) === normalise(f.status));
        if (status) updates.status = status;
      }
      if (number(f.value) !== undefined) updates.value = number(f.value)!;
      if (text(f.next)) updates.next = text(f.next)!;
      if (text(f.due)) updates.due = text(f.due)!;
      const updated = updateQuote(quote.id, updates);
      if (!updated) return { ok: false as const, status: 409, reply: `${quote.ref} could not be updated. Nothing was changed.` };
      audit(pending.actorName, "updated by Blake", "quote", updated.id, `${updated.ref} updated through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${updated.ref} was updated.` };
    }
    case "create_job": {
      const health = jobHealth.find((item) => normalise(item) === normalise(f.health)) ?? "blue";
      const job = createJob({
        customer: text(f.customer ?? f.customerName)!,
        site: text(f.site ?? f.address) ?? "",
        description: text(f.description)!,
        manager: text(f.manager) ?? "",
        status: text(f.status) ?? "Pending",
        health,
        value: number(f.value) ?? 0,
        next: text(f.next) ?? "Review and schedule work.",
        due: text(f.due) ?? "Unscheduled",
      });
      audit(pending.actorName, "created by Blake", "job", job.id, `${job.ref} created for ${job.customer} through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${job.ref} was created for ${job.customer}${job.site ? ` at ${job.site}` : ""}.` };
    }
    case "update_job": {
      const job = findJobByRef(pending.targetRef);
      if (!job) return { ok: false as const, status: 404, reply: `I cannot find ${pending.targetRef}. Nothing was changed.` };
      const updates: Partial<Job> = {};
      if (text(f.customer ?? f.customerName)) updates.customer = text(f.customer ?? f.customerName)!;
      if (text(f.site ?? f.address)) updates.site = text(f.site ?? f.address)!;
      if (text(f.description)) updates.description = text(f.description)!;
      if (text(f.manager)) updates.manager = text(f.manager)!;
      if (text(f.status)) updates.status = text(f.status)!;
      if (text(f.health)) {
        const health = jobHealth.find((item) => normalise(item) === normalise(f.health));
        if (health) updates.health = health;
      }
      if (number(f.value) !== undefined) updates.value = number(f.value)!;
      if (text(f.next)) updates.next = text(f.next)!;
      if (text(f.due)) updates.due = text(f.due)!;
      const updated = updateJob(job.id, updates);
      if (!updated) return { ok: false as const, status: 409, reply: `${job.ref} could not be updated. Nothing was changed.` };
      audit(pending.actorName, "updated by Blake", "job", updated.id, `${updated.ref} updated through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${updated.ref} was updated.` };
    }
  }
}

export async function confirmBlakeOperatorAction(
  actionId: string,
  actor: { id: string; name: string },
  access: AccessProfile,
) {
  refreshPendingStore();
  const pending = pendingStore.actions.find((item) => item.id === actionId && item.actorId === actor.id);
  if (!pending) return { matched: false as const };
  const result = executePending(pending, access);
  if (result.ok) removePending(pending.id);
  return { matched: true as const, ...result };
}

export async function handleBlakeOperatorMessage(
  message: string,
  actor: { id: string; name: string },
  access: AccessProfile,
  history: BlakeHistoryMessage[] = [],
): Promise<NexaAssistantResponse | null> {
  const pending = latestPendingForActor(actor.id);
  if (pending && isConfirmation(message)) {
    const result = executePending(pending, access);
    if (result.ok) removePending(pending.id);
    return { reply: result.reply, intent: { action: "chat" }, aiUsed: false };
  }
  if (pending && isCancellation(message)) {
    removePending(pending.id);
    return { reply: "Cancelled — I have not changed anything in NeXa.", intent: { action: "chat" }, aiUsed: false };
  }

  if (!looksLikeOperatorConversation(message, history)) return null;
  const plan = await planOperatorAction(message, history, access);
  if (!plan || plan.action === "none") return null;
  if (!permissionAllows(access, plan.action)) {
    return { reply: `Your current NeXa role does not allow me to ${humanCapability(plan.action)}.`, intent: { action: "chat" }, aiUsed: true };
  }

  const missing = requiredMissing(plan);
  if (missing.length) {
    return {
      reply: `To ${humanCapability(plan.action)}, I still need: ${missing.join(", ")}.`,
      intent: { action: "chat" },
      aiUsed: true,
    };
  }
  if (plan.action.startsWith("update_") && !hasAnyChange(plan.fields)) {
    return { reply: `What would you like me to change on ${plan.targetRef}?`, intent: { action: "chat" }, aiUsed: true };
  }
  if (plan.action === "update_lead" && !findLeadByRef(plan.targetRef)) {
    return { reply: `I cannot find ${plan.targetRef} in the current NeXa leads. Check the reference and I’ll try again.`, intent: { action: "chat" }, aiUsed: true };
  }
  if (plan.action === "update_quote" && !findQuoteByRef(plan.targetRef)) {
    return { reply: `I cannot find ${plan.targetRef} in the current NeXa quotes. Check the reference and I’ll try again.`, intent: { action: "chat" }, aiUsed: true };
  }
  if (plan.action === "update_job" && !findJobByRef(plan.targetRef)) {
    return { reply: `I cannot find ${plan.targetRef} in the current NeXa jobs. Check the reference and I’ll try again.`, intent: { action: "chat" }, aiUsed: true };
  }

  return confirmationResponse(createPending(plan, actor));
}

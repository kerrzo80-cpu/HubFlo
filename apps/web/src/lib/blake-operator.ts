import type { AccessProfile } from "@/lib/access";
import { createLead, getLead, getLeads, updateLead, type LeadDraftFromClient, type LeadPatchPayload, type LeadSource } from "@/lib/lead-store";
import { appendAuditEvent } from "@/lib/people-data";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { createJob, createQuote, getJobs, getQuotes, updateJob, updateQuote, type Job, type Quote } from "@/lib/workflow-data";
import type { BlakeHistoryMessage, NexaAssistantResponse } from "@/lib/nexa-assistant";

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

function cleanString(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function permitted(access: AccessProfile, capability: BlakeOperatorCapability) {
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
  const capabilities: BlakeOperatorCapability[] = [
    "create_lead",
    "update_lead",
    "create_quote",
    "update_quote",
    "create_job",
    "update_job",
  ];
  return capabilities.filter((capability) => permitted(access, capability));
}

function looksLikeOperatorRequest(message: string, history: BlakeHistoryMessage[]) {
  if (/\b(create|make|new|change|update|edit|amend|rename|mark|set)\b/i.test(message)) return true;
  return history.slice(-4).some((item) =>
    item.role === "assistant" && /\b(to create|to update|ready to (create|update)|which .* (lead|quote|job)|what .* (lead|quote|job))\b/i.test(item.text),
  );
}

function isConfirmation(message: string) {
  return /^(?:yes|yep|yeah|correct|confirm|confirmed|do it|go ahead|proceed|please do|create it|save it|update it)[.!\s]*$/i.test(message.trim());
}

function isCancellation(message: string) {
  return /^(?:no|cancel|cancel it|stop|don't|dont|do not|leave it)[.!\s]*$/i.test(message.trim());
}

function latestPendingForActor(actorId: string) {
  refreshPendingStore();
  return pendingStore.actions
    .filter((item) => item.actorId === actorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function findLeadByRef(ref?: string) {
  const target = normalise(ref).replace(/\s+/g, "-");
  return getLeads().find((lead) => normalise(lead.ref).replace(/\s+/g, "-") === target);
}

function findQuoteByRef(ref?: string) {
  const target = normalise(ref).replace(/\s+/g, "-");
  return getQuotes().find((quote) => normalise(quote.ref).replace(/\s+/g, "-") === target);
}

function findJobByRef(ref?: string) {
  const target = normalise(ref).replace(/\s+/g, "-");
  return getJobs().find((job) => normalise(job.ref).replace(/\s+/g, "-") === target);
}

function missingFields(plan: OperatorPlan) {
  const fields = plan.fields;
  switch (plan.action) {
    case "create_lead": {
      const missing: string[] = [];
      if (!cleanString(fields.customerName ?? fields.customer)) missing.push("customer name");
      if (!cleanString(fields.address ?? fields.site)) missing.push("site address");
      if (!cleanString(fields.description)) missing.push("enquiry / work description");
      if (!leadSources.some((item) => normalise(item) === normalise(fields.source))) missing.push("lead source (Phone call, Checkatrade, Email, Website or Referral)");
      return missing;
    }
    case "update_lead":
      return cleanString(plan.targetRef) ? [] : ["lead reference"];
    case "create_quote": {
      const missing: string[] = [];
      if (!cleanString(fields.customer ?? fields.customerName)) missing.push("customer name");
      if (!cleanString(fields.description)) missing.push("quote description");
      return missing;
    }
    case "update_quote":
      return cleanString(plan.targetRef) ? [] : ["quote reference"];
    case "create_job": {
      const missing: string[] = [];
      if (!cleanString(fields.customer ?? fields.customerName)) missing.push("customer name");
      if (!cleanString(fields.description)) missing.push("job description");
      return missing;
    }
    case "update_job":
      return cleanString(plan.targetRef) ? [] : ["job reference"];
    default:
      return [];
  }
}

function hasEditableFields(plan: OperatorPlan) {
  const populated = Object.entries(plan.fields).some(([, value]) =>
    typeof value === "number" ? Number.isFinite(value) : Boolean(cleanString(typeof value === "string" ? value : undefined)),
  );
  return !plan.action.startsWith("update_") || populated;
}

function summaryForPlan(plan: OperatorPlan) {
  const f = plan.fields;
  switch (plan.action) {
    case "create_lead":
      return `Create a lead for ${cleanString(f.customerName ?? f.customer)} at ${cleanString(f.address ?? f.site)} · ${cleanString(f.description)}.`;
    case "update_lead":
      return `Update ${plan.targetRef} with: ${describeFields(f)}.`;
    case "create_quote":
      return `Create a Draft quote for ${cleanString(f.customer ?? f.customerName)} · ${cleanString(f.description)}${cleanNumber(f.value) !== undefined ? ` · £${cleanNumber(f.value)!.toLocaleString("en-GB")}` : ""}.`;
    case "update_quote":
      return `Update ${plan.targetRef} with: ${describeFields(f)}.`;
    case "create_job":
      return `Create a job for ${cleanString(f.customer ?? f.customerName)}${cleanString(f.site) ? ` at ${cleanString(f.site)}` : ""} · ${cleanString(f.description)}.`;
    case "update_job":
      return `Update ${plan.targetRef} with: ${describeFields(f)}.`;
    default:
      return "";
  }
}

function describeFields(fields: OperatorFields) {
  return Object.entries(fields)
    .filter(([, value]) => typeof value === "number" ? Number.isFinite(value) : Boolean(cleanString(typeof value === "string" ? value : undefined)))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ") || "no changes supplied";
}

async function planOperatorAction(message: string, history: BlakeHistoryMessage[], access: AccessProfile): Promise<OperatorPlan | null> {
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
                "You are the intent planner for Blake inside NeXa.",
                `Only select one of these authorised write capabilities: ${allowed.join(", ")}. Otherwise select none.`,
                "Extract only values explicitly supplied by the user or clearly established in the supplied conversation. Never invent customer names, addresses, references, dates, prices or descriptions.",
                "For create_quote, status may be omitted because NeXa will create a Draft by default.",
                "For create_job, due/status/health/value may be omitted because NeXa has safe defaults.",
                "For updates, targetRef must identify the lead/quote/job being changed. Prefer an explicit reference from the conversation.",
                "Do not treat diary booking/scheduling requests as these capabilities; return none for those.",
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
                  required: ["customerName", "customer", "address", "phone", "email", "description", "source", "status", "surveyor", "surveyDate", "surveyTime", "owner", "value", "next", "due", "site", "manager", "health"],
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
    const text = body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { action?: string; targetRef?: string | null; fields?: Record<string, string | number | null> };
    if (!parsed.action || parsed.action === "none" || !allowed.includes(parsed.action as BlakeOperatorCapability)) return { action: "none", fields: {} };
    const fields: OperatorFields = {};
    Object.entries(parsed.fields ?? {}).forEach(([key, value]) => {
      if (value === null) return;
      (fields as Record<string, string | number>)[key] = value;
    });
    return {
      action: parsed.action as BlakeOperatorCapability,
      targetRef: cleanString(parsed.targetRef ?? undefined),
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
    summary: summaryForPlan(plan),
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
      kind: "confirm_action",
      title: "Review Blake action",
      detail: pending.summary,
      confirmLabel: "Confirm",
    },
    aiUsed: true,
  };
}

function audit(actorName: string, action: string, recordType: string, recordId: string, summary: string) {
  appendAuditEvent({
    actor: actorName,
    action,
    recordType,
    recordId,
    summary,
    source: "Blake",
    importance: "high",
  });
}

function executePending(pending: PendingOperatorAction, access: AccessProfile) {
  if (!permitted(access, pending.capability)) {
    return { ok: false as const, status: 403, reply: `Your current NeXa role is not allowed to ${pending.capability.replaceAll("_", " ")}. Nothing was changed.` };
  }
  const f = pending.fields;

  switch (pending.capability) {
    case "create_lead": {
      const source = leadSources.find((item) => normalise(item) === normalise(f.source));
      if (!source) return { ok: false as const, status: 400, reply: "The lead source is missing or invalid. Nothing was created." };
      const payload: LeadDraftFromClient = {
        source,
        customerName: cleanString(f.customerName ?? f.customer)!,
        phone: cleanString(f.phone) ?? "",
        email: cleanString(f.email) ?? "",
        address: cleanString(f.address ?? f.site)!,
        description: cleanString(f.description)!,
        status: "Needs scheduling",
        surveyor: cleanString(f.surveyor) ?? "",
        surveyDate: cleanString(f.surveyDate) ?? "",
        surveyTime: cleanString(f.surveyTime) ?? "",
        createdBy: pending.actorName,
        next: cleanString(f.next) ?? "Check diary and book survey appointment.",
      };
      const result = createLead(payload, pending.actorName);
      return { ok: true as const, status: 200, reply: `Done — ${result.lead.ref} was created for ${result.lead.customerName} at ${result.lead.address}.`, entityType: "lead", entityId: result.lead.id, entityRef: result.lead.ref };
    }
    case "update_lead": {
      const lead = findLeadByRef(pending.targetRef);
      if (!lead) return { ok: false as const, status: 404, reply: `I cannot find ${pending.targetRef} in the current NeXa leads. Nothing was changed.` };
      const patch: LeadPatchPayload = {};
      if (cleanString(f.status)) patch.status = cleanString(f.status) as LeadPatchPayload["status"];
      if (cleanString(f.surveyor)) patch.surveyor = cleanString(f.surveyor);
      if (cleanString(f.surveyDate)) patch.surveyDate = cleanString(f.surveyDate);
      if (cleanString(f.surveyTime)) patch.surveyTime = cleanString(f.surveyTime);
      if (cleanString(f.next)) patch.next = cleanString(f.next);
      const updated = updateLead(lead.id, patch, pending.actorName);
      if (!updated) return { ok: false as const, status: 409, reply: `${lead.ref} could not be updated. Nothing was changed.` };
      audit(pending.actorName, "updated by Blake", "lead", updated.id, `${updated.ref} updated through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${updated.ref} was updated.`, entityType: "lead", entityId: updated.id, entityRef: updated.ref };
    }
    case "create_quote": {
      const status = quoteStatuses.find((item) => normalise(item) === normalise(f.status)) ?? "Draft";
      const quote = createQuote({
        customer: cleanString(f.customer ?? f.customerName)!,
        description: cleanString(f.description)!,
        owner: cleanString(f.owner) ?? pending.actorName,
        status,
        value: cleanNumber(f.value) ?? 0,
        next: cleanString(f.next) ?? "Build scope and pricing.",
        due: cleanString(f.due) ?? "Unscheduled",
      });
      audit(pending.actorName, "created by Blake", "quote", quote.id, `${quote.ref} created for ${quote.customer} through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${quote.ref} was created for ${quote.customer}${quote.value ? ` at £${quote.value.toLocaleString("en-GB")}` : ""}.`, entityType: "quote", entityId: quote.id, entityRef: quote.ref };
    }
    case "update_quote": {
      const quote = findQuoteByRef(pending.targetRef);
      if (!quote) return { ok: false as const, status: 404, reply: `I cannot find ${pending.targetRef} in the current NeXa quotes. Nothing was changed.` };
      const updates: Partial<Quote> = {};
      if (cleanString(f.customer ?? f.customerName)) updates.customer = cleanString(f.customer ?? f.customerName)!;
      if (cleanString(f.description)) updates.description = cleanString(f.description)!;
      if (cleanString(f.owner)) updates.owner = cleanString(f.owner)!;
      if (cleanString(f.status)) {
        const status = quoteStatuses.find((item) => normalise(item) === normalise(f.status));
        if (status) updates.status = status;
      }
      if (cleanNumber(f.value) !== undefined) updates.value = cleanNumber(f.value)!;
      if (cleanString(f.next)) updates.next = cleanString(f.next)!;
      if (cleanString(f.due)) updates.due = cleanString(f.due)!;
      const updated = updateQuote(quote.id, updates);
      if (!updated) return { ok: false as const, status: 409, reply: `${quote.ref} could not be updated. Nothing was changed.` };
      audit(pending.actorName, "updated by Blake", "quote", updated.id, `${updated.ref} updated through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${updated.ref} was updated.`, entityType: "quote", entityId: updated.id, entityRef: updated.ref };
    }
    case "create_job": {
      const health = jobHealth.find((item) => normalise(item) === normalise(f.health)) ?? "blue";
      const job = createJob({
        customer: cleanString(f.customer ?? f.customerName)!,
        site: cleanString(f.site ?? f.address) ?? "",
        description: cleanString(f.description)!,
        manager: cleanString(f.manager) ?? "",
        status: cleanString(f.status) ?? "Pending",
        health,
        value: cleanNumber(f.value) ?? 0,
        next: cleanString(f.next) ?? "Review and schedule work.",
        due: cleanString(f.due) ?? "Unscheduled",
      });
      audit(pending.actorName, "created by Blake", "job", job.id, `${job.ref} created for ${job.customer} through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${job.ref} was created for ${job.customer}${job.site ? ` at ${job.site}` : ""}.`, entityType: "job", entityId: job.id, entityRef: job.ref };
    }
    case "update_job": {
      const job = findJobByRef(pending.targetRef);
      if (!job) return { ok: false as const, status: 404, reply: `I cannot find ${pending.targetRef} in the current NeXa jobs. Nothing was changed.` };
      const updates: Partial<Job> = {};
      if (cleanString(f.customer ?? f.customerName)) updates.customer = cleanString(f.customer ?? f.customerName)!;
      if (cleanString(f.site ?? f.address)) updates.site = cleanString(f.site ?? f.address)!;
      if (cleanString(f.description)) updates.description = cleanString(f.description)!;
      if (cleanString(f.manager)) updates.manager = cleanString(f.manager)!;
      if (cleanString(f.status)) updates.status = cleanString(f.status)!;
      if (cleanString(f.health)) {
        const health = jobHealth.find((item) => normalise(item) === normalise(f.health));
        if (health) updates.health = health;
      }
      if (cleanNumber(f.value) !== undefined) updates.value = cleanNumber(f.value)!;
      if (cleanString(f.next)) updates.next = cleanString(f.next)!;
      if (cleanString(f.due)) updates.due = cleanString(f.due)!;
      const updated = updateJob(job.id, updates);
      if (!updated) return { ok: false as const, status: 409, reply: `${job.ref} could not be updated. Nothing was changed.` };
      audit(pending.actorName, "updated by Blake", "job", updated.id, `${updated.ref} updated through Blake.`);
      return { ok: true as const, status: 200, reply: `Done — ${updated.ref} was updated.`, entityType: "job", entityId: updated.id, entityRef: updated.ref };
    }
  }
}

function removePending(id: string) {
  pendingStore.actions = pendingStore.actions.filter((item) => item.id !== id);
  persistPendingStore();
}

export async function confirmBlakeOperatorAction(actionId: string, actor: { id: string; name: string }, access: AccessProfile) {
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

  if (!looksLikeOperatorRequest(message, history)) return null;
  const plan = await planOperatorAction(message, history, access);
  if (!plan || plan.action === "none") return null;
  if (!permitted(access, plan.action)) {
    return { reply: `Your current NeXa role does not allow me to ${plan.action.replaceAll("_", " ")}.`, intent: { action: "chat" }, aiUsed: true };
  }
  const missing = missingFields(plan);
  if (missing.length) {
    return {
      reply: `I can do that. Before I make the change, I still need: ${missing.join(", ")}.`,
      intent: { action: "chat" },
      aiUsed: true,
    };
  }
  if (!hasEditableFields(plan)) {
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

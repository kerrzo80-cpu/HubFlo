import { appendAuditEvent, getClients } from "@/lib/people-data";
import { getClientSites, type LeadAddressParts, type LeadSource } from "@/lib/lead-store";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { blakeActionRegistry, type BlakeActionContext } from "@/lib/blake-actions";
import { openAiFetch } from "@/lib/openai-fetch";

export const CREATE_LEAD_WORKFLOW_ID = "CREATE_LEAD_V1" as const;
type WorkflowStatus = "collecting_information" | "awaiting_customer_choice" | "awaiting_confirmation" | "completed" | "failed";

export type CreateLeadCollectedData = {
  customerName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  town?: string;
  county?: string;
  postcode?: string;
  description?: string;
  source?: LeadSource;
  clientId?: string;
  siteId?: string;
};

export type CreateLeadWorkflowRun = {
  id: string;
  tenantId: string;
  actorId: string;
  conversationId?: string;
  workflow: typeof CREATE_LEAD_WORKFLOW_ID;
  version: 1;
  status: WorkflowStatus;
  collectedData: CreateLeadCollectedData;
  missingFields: string[];
  customerCandidates: Array<{ id: string; name: string; address: string; phone: string; email: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  createdLeadId?: string;
};

type WorkflowStore = { runs: CreateLeadWorkflowRun[] };
const STORE_KEY = "blake-workflow-runs-v1";
const store = loadServerStore<WorkflowStore>(STORE_KEY, { runs: [] });

function refreshStore() {
  const snapshot = readServerStoreSnapshot(STORE_KEY) as WorkflowStore | null;
  if (Array.isArray(snapshot?.runs)) store.runs = snapshot.runs;
}

function persist() {
  store.runs = store.runs.slice(-500);
  writeServerStore(STORE_KEY, store);
}

function missing(data: CreateLeadCollectedData) {
  const required: Array<[keyof CreateLeadCollectedData, string]> = [
    ["customerName", "customer name"],
    ["addressLine1", "site address"],
    ["town", "town or city"],
    ["postcode", "postcode"],
    ["description", "enquiry description"],
    ["source", "lead source"],
  ];
  return required.filter(([key]) => !String(data[key] ?? "").trim()).map(([, label]) => label);
}

function activeRun(context: BlakeActionContext) {
  refreshStore();
  return [...store.runs].reverse().find((run) =>
    run.tenantId === context.tenantId &&
    run.actorId === context.actorId &&
    run.conversationId === context.conversationId &&
    !["completed", "failed"].includes(run.status));
}

function normalizeSource(value: unknown): LeadSource | undefined {
  const match = ["Phone call", "Checkatrade", "Email", "Website", "Referral"].find(
    (item) => item.toLowerCase() === String(value ?? "").trim().toLowerCase(),
  );
  return match as LeadSource | undefined;
}

export function locallyExtractLeadData(message: string, current: CreateLeadCollectedData) {
  const next = { ...current };
  const labelled = (label: string) => message.match(new RegExp(`(?:^|[\\n,;])\\s*(?:${label})\\s*[:=-]\\s*([^\\n,;]+)`, "i"))?.[1]?.trim();
  const set = (key: keyof CreateLeadCollectedData, value: string | undefined) => {
    if (value) (next as Record<string, unknown>)[key] = value;
  };
  set("customerName", labelled("(?:customer|client)(?: name)?"));
  set("contactName", labelled("contact(?: name)?"));
  set("addressLine1", labelled("(?:site )?address(?: line 1)?"));
  set("town", labelled("town|city"));
  set("county", labelled("county"));
  set("description", labelled("enquiry|description|work|job"));
  set("email", message.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]);
  set("phone", message.match(/(?:\+44\s?\d{4}|0\d{3,4})[\s-]?\d{3,4}[\s-]?\d{3,4}/)?.[0]);
  set("postcode", message.match(/\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i)?.[0].toUpperCase());
  next.source = normalizeSource(labelled("source"))
    || normalizeSource(message.match(/\b(phone call|checkatrade|email|website|referral)\b/i)?.[1])
    || next.source;
  return next;
}

async function extractLeadData(message: string, current: CreateLeadCollectedData) {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) throw new Error("OpenAI is not connected on pilot. Your lead workflow is saved; connect Blake AI and continue.");
  const model = process.env.BLAKE_MODEL?.trim() || process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  const response = await openAiFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: "Extract only lead facts explicitly supplied by the user. Preserve existing values unless the user clearly changes them. Never invent names, contact details, addresses, postcodes, descriptions, or sources. UK lead sources are Phone call, Checkatrade, Email, Website, Referral.",
          }],
        },
        { role: "user", content: [{ type: "input_text", text: `Existing structured state:\n${JSON.stringify(current)}\n\nNew message:\n${message}` }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "create_lead_fields",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              customerName: { type: ["string", "null"] }, contactName: { type: ["string", "null"] },
              phone: { type: ["string", "null"] }, email: { type: ["string", "null"] },
              addressLine1: { type: ["string", "null"] }, addressLine2: { type: ["string", "null"] },
              town: { type: ["string", "null"] }, county: { type: ["string", "null"] },
              postcode: { type: ["string", "null"] }, description: { type: ["string", "null"] },
              source: { type: ["string", "null"], enum: ["Phone call", "Checkatrade", "Email", "Website", "Referral", null] },
            },
            required: ["customerName", "contactName", "phone", "email", "addressLine1", "addressLine2", "town", "county", "postcode", "description", "source"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI could not interpret the lead details (${response.status}). The workflow is still saved.`);
  const body = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const text = body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no lead details. The workflow is still saved.");
  const extracted = JSON.parse(text) as CreateLeadCollectedData;
  const next = { ...current };
  for (const [key, value] of Object.entries(extracted)) {
    if (typeof value === "string" && value.trim()) (next as Record<string, unknown>)[key] = value.trim();
  }
  next.source = normalizeSource(extracted.source) ?? current.source;
  return next;
}

function candidatesFor(data: CreateLeadCollectedData) {
  if (!data.customerName || data.clientId) return [];
  const target = data.customerName.trim().toLowerCase();
  const digits = (data.phone ?? "").replace(/\D/g, "");
  return getClients().filter((client) => {
    const name = client.name.trim().toLowerCase();
    return name === target || name.includes(target) || target.includes(name)
      || Boolean(digits && client.phone.replace(/\D/g, "") === digits)
      || Boolean(data.email && client.email.toLowerCase() === data.email.toLowerCase());
  }).slice(0, 5).map((client) => ({ id: client.id, name: client.name, address: client.billingAddress, phone: client.phone, email: client.email }));
}

function summary(run: CreateLeadWorkflowRun) {
  const data = run.collectedData;
  return [
    "Ready to create the lead:", "",
    `Customer: ${data.customerName}`,
    data.contactName ? `Contact: ${data.contactName}` : null,
    data.phone ? `Telephone: ${data.phone}` : null,
    data.email ? `Email: ${data.email}` : null,
    `Site: ${[data.addressLine1, data.addressLine2, data.town, data.county, data.postcode].filter(Boolean).join(", ")}`,
    `Enquiry: ${data.description}`,
    `Source: ${data.source}`,
    "", "Create the lead?",
  ].filter((line): line is string => line !== null).join("\n");
}

export async function handleCreateLeadWorkflow(message: string, context: BlakeActionContext, start = false) {
  let run = activeRun(context);
  if (!run && !start) return null;
  if (!run) {
    const now = new Date().toISOString();
    run = { id: `blake-lead-${crypto.randomUUID()}`, tenantId: context.tenantId, actorId: context.actorId, conversationId: context.conversationId, workflow: CREATE_LEAD_WORKFLOW_ID, version: 1, status: "collecting_information", collectedData: {}, missingFields: [], customerCandidates: [], createdAt: now, updatedAt: now };
    store.runs.push(run);
    persist();
  }

  if (/^(cancel|cancel that|stop|forget it|leave it|exit)$/i.test(message.trim())) {
    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    persist();
    return { reply: "Lead creation cancelled. Nothing was created. What else can I help with?", aiUsed: false };
  }

  if (run.status === "awaiting_confirmation" && /^(yes|y|confirm|create|create lead|go ahead|do it)$/i.test(message.trim())) {
    return confirmCreateLeadWorkflow(run.id, context);
  }
  if (run.status === "awaiting_confirmation" && /^(no|cancel|stop)$/i.test(message.trim())) {
    run.status = "failed"; run.updatedAt = new Date().toISOString(); persist();
    return { reply: "Cancelled. Nothing was created.", aiUsed: false };
  }

  const locallyExtracted = locallyExtractLeadData(message, run.collectedData);
  let extractionWarning = "";
  try {
    run.collectedData = await extractLeadData(message, locallyExtracted);
  } catch (error) {
    run.collectedData = locallyExtracted;
    extractionWarning = error instanceof Error ? error.message : "Blake could not interpret all of those details.";
    console.error("Blake create-lead extraction failed", { workflowRunId: run.id, error: extractionWarning });
  }
  run.missingFields = missing(run.collectedData);
  run.updatedAt = new Date().toISOString();
  if (run.missingFields.length) {
    run.status = "collecting_information"; persist();
    return {
      reply: `${extractionWarning ? "I couldn't interpret every detail automatically, but the lead draft is safe. " : "I’ve saved what you gave me. "}I still need: ${run.missingFields.join(", ")}.\n\nYou can reply using labels, for example: Customer: …, Address: …, Town: …, Postcode: …, Enquiry: …, Source: Phone call.`,
      aiUsed: !extractionWarning,
      workflowRunId: run.id,
    };
  }
  run.customerCandidates = candidatesFor(run.collectedData);
  if (run.customerCandidates.length && !run.collectedData.clientId) {
    run.status = "awaiting_customer_choice"; persist();
    const choices = run.customerCandidates.map((item, index) => `${index + 1}. ${item.name} · ${item.address || "No address"} · ${item.phone || item.email || "No contact details"}`);
    return { reply: `I found possible existing customers:\n${choices.join("\n")}\n\nReply with the number, or say “new customer”.`, aiUsed: true, workflowRunId: run.id };
  }
  run.status = "awaiting_confirmation"; persist();
  return { reply: summary(run), aiUsed: true, workflowRunId: run.id, action: { id: run.id, kind: "confirm_create_lead" as const, title: "Create lead", detail: `${run.collectedData.customerName} · ${run.collectedData.postcode}`, confirmLabel: "Create Lead" } };
}

export async function continueCreateLeadCustomerChoice(message: string, context: BlakeActionContext) {
  const run = activeRun(context);
  if (!run || run.status !== "awaiting_customer_choice") return null;
  if (/new customer/i.test(message)) {
    run.customerCandidates = [];
  } else {
    const index = Number(message.trim()) - 1;
    const selected = run.customerCandidates[index];
    if (!selected) return { reply: "Choose one of the customer numbers shown, or say “new customer”.", aiUsed: false };
    run.collectedData.clientId = selected.id;
    run.collectedData.customerName = selected.name;
    const site = getClientSites().find((item) => item.clientId === selected.id && item.address.toLowerCase().includes((run.collectedData.postcode ?? "").toLowerCase()));
    if (site) run.collectedData.siteId = site.id;
  }
  run.status = "awaiting_confirmation"; run.updatedAt = new Date().toISOString(); persist();
  return { reply: summary(run), aiUsed: false, workflowRunId: run.id, action: { id: run.id, kind: "confirm_create_lead" as const, title: "Create lead", detail: `${run.collectedData.customerName} · ${run.collectedData.postcode}`, confirmLabel: "Create Lead" } };
}

export async function confirmCreateLeadWorkflow(runId: string, context: BlakeActionContext) {
  refreshStore();
  const run = store.runs.find((item) => item.id === runId && item.actorId === context.actorId && item.tenantId === context.tenantId);
  if (!run || run.status !== "awaiting_confirmation") return { ok: false, status: 409, reply: "That lead workflow is not ready to confirm." };
  const data = run.collectedData;
  if (missing(data).length) return { ok: false, status: 409, reply: "Required lead information is missing. Nothing was created." };
  const addressParts: LeadAddressParts = { line1: data.addressLine1!, line2: data.addressLine2 ?? "", town: data.town!, county: data.county ?? "", postcode: data.postcode!.toUpperCase() };
  try {
    const created = await blakeActionRegistry.create_lead.execute({
      customerName: data.customerName!, phone: data.phone ?? "", email: data.email ?? "",
      address: [addressParts.line1, addressParts.line2, addressParts.town, addressParts.county, addressParts.postcode].filter(Boolean).join(", "),
      addressParts, description: data.description!, source: data.source!, clientId: data.clientId, siteId: data.siteId,
      mainContact: data.contactName ? { id: `contact-${crypto.randomUUID()}`, name: data.contactName, role: "Main contact", phone: data.phone ?? "", email: data.email ?? "", notes: "" } : undefined,
      additionalContacts: [], status: "Needs scheduling", surveyor: "", surveyDate: "", surveyTime: "", createdBy: context.actorName,
    }, context);
    run.status = "completed"; run.completedAt = new Date().toISOString(); run.updatedAt = run.completedAt; run.createdLeadId = created.lead.id; persist();
    appendAuditEvent({ actor: context.actorName, action: "created by Blake", recordType: "lead", recordId: created.lead.id, summary: `${context.actorName} confirmed ${CREATE_LEAD_WORKFLOW_ID}; Blake created ${created.lead.ref}. Workflow ${run.id}.`, source: "Blake", importance: "high" });
    return { ok: true, status: 200, reply: `Lead created successfully.\n\nLead: ${created.lead.ref}\nCustomer: ${created.lead.customerName}\nSite: ${created.lead.address}\nEnquiry: ${created.lead.description}`, leadId: created.lead.id, leadRef: created.lead.ref };
  } catch (error) {
    run.status = "failed"; run.updatedAt = new Date().toISOString(); persist();
    return { ok: false, status: 409, reply: error instanceof Error ? error.message : "NeXa could not create the lead. Nothing was created." };
  }
}

export function hasActiveCreateLeadWorkflow(context: BlakeActionContext) {
  return Boolean(activeRun(context));
}

export function isLeadWorkflowReply(message: string, status: WorkflowStatus) {
  const text = message.trim();
  if (/^(cancel|cancel that|stop|forget it|leave it|exit)$/i.test(text)) return true;
  if (status === "awaiting_customer_choice") return /^(?:\d+|new customer|cancel)$/i.test(text);
  if (status === "awaiting_confirmation") return /^(?:yes|y|confirm|create|create lead|go ahead|do it|no|cancel|stop)$/i.test(text);
  const unrelatedBusinessQuestion = /\b(job|jobs|quote|quotes|invoice|invoices|report|reporting|sales|turnover|profit|margin|margins|schedule|diary|available|availability|customer|customers|supplier|suppliers|po|purchase order|timesheet|valuation|cash|owed|overdue)\b/i.test(text)
    && /\b(what|which|who|when|where|how|show|list|find|tell|give|are|is|do|does|have|has)\b/i.test(text);
  if (unrelatedBusinessQuestion) return false;
  const explicitLeadFact = /(?:^|[\n,;])\s*(?:customer|client|contact|site address|address|town|city|county|postcode|enquiry|description|source)\s*[:=-]/i.test(text)
    || /\b(?:phone call|checkatrade|website|referral)\b/i.test(text)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
    || /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i.test(text);
  const conversationalCorrection = /\b(?:that(?:'s| is) wrong|you(?:'re| are) wrong|incorrect|i mean|should be|cost centre|cost center|section|workflow|explain)\b/i.test(text);
  if (conversationalCorrection && !explicitLeadFact) return false;
  if (text.length > 240 && !explicitLeadFact) return false;
  return true;
}

/** Keep a saved lead draft from swallowing unrelated ChatGPT-style questions. */
export function shouldContinueCreateLeadWorkflow(message: string, context: BlakeActionContext) {
  const run = activeRun(context);
  if (!run) return false;
  return isLeadWorkflowReply(message, run.status);
}

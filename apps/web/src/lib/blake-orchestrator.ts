import type { AccessProfile } from "@/lib/access";
import { blakeCore } from "@/lib/blake-core";
import { listBlakeKnowledge } from "@/lib/blake-knowledge";
import { resolveOpenAiApiKey } from "@/lib/openai-env";

import {
  getBlakeOrchestratorConversation,
  getBlakePendingAction,
  patchBlakeOrchestratorConversation,
  rememberBlakeTool,
  removeBlakePendingAction,
  saveBlakePendingAction,
  type BlakePendingCapabilityAction,
} from "./blake-orchestrator-state";

type Channel = "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
type HistoryMessage = { role: "user" | "assistant"; text: string };

export type BlakeOrchestratorActor = {
  id: string;
  name: string;
  tenantId: string;
  channel: Channel;
};

export type BlakeOrchestratorResponse = {
  reply: string;
  aiUsed: boolean;
  intent: { action: "chat" };
  status?: number;
  action?: {
    id: string;
    kind: "confirm_blake_orchestrator_action";
    title: string;
    detail: string;
    confirmLabel: string;
  };
};

type CapabilityDefinition = ReturnType<typeof blakeCore.definitions>[number];
type OpenAiFunctionCall = {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
};
type OpenAiOutputText = {
  type?: string;
  text?: string;
};
type OpenAiResponse = {
  id?: string;
  output?: Array<OpenAiFunctionCall | { type?: string; content?: OpenAiOutputText[] }>;
};

const maximumToolRounds = 7;
const maximumRememberedToolChars = 18000;
const pendingLifetimeMs = 45 * 60 * 1000;

function hasPermission(access: AccessProfile, permission: string) {
  return access[permission as keyof AccessProfile] === true;
}

function visibleDefinitions(access: AccessProfile) {
  return blakeCore.definitions().filter(
    (definition) => definition.requiredPermissions.every((permission) => hasPermission(access, permission)),
  );
}

function createLeadToolSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      customerName: { type: "string" },
      phone: { type: "string" },
      email: { type: "string" },
      address: { type: "string" },
      description: { type: "string" },
      source: { enum: ["Phone call", "Checkatrade", "Email", "Website", "Referral"] },
      status: { enum: ["New enquiry", "Needs scheduling", "Survey booked", "Quoted", "Lost"] },
      surveyor: { type: "string" },
      surveyDate: { type: "string" },
      surveyTime: { type: "string" },
      createdBy: { type: "string" },
      next: { type: "string" },
      clientId: { type: "string" },
      siteId: { type: "string" },
      siteName: { type: "string" },
    },
    required: ["customerName", "address", "description", "source"],
  };
}

function openAiTools(definitions: CapabilityDefinition[]) {
  return definitions.map((definition) => ({
    type: "function",
    name: definition.name,
    description: [
      definition.description,
      definition.mode === "write" && definition.requiresConfirmation
        ? "This changes NeXa. Call it only when you have enough information to prepare the change; NeXa will require user confirmation before execution."
        : "",
    ].filter(Boolean).join(" "),
    parameters: definition.name === "create_lead" ? createLeadToolSchema() : definition.inputSchema,
    strict: false,
  }));
}

function exactConfirmation(message: string) {
  return /^(?:yes|yep|yeah|confirm|confirmed|do it|go ahead|proceed|please do|save it|create it|update it|make the change)[.!\s]*$/i.test(message.trim());
}

function exactCancellation(message: string) {
  return /^(?:no|cancel|cancel it|stop|don't|dont|do not|leave it|forget it)[.!\s]*$/i.test(message.trim());
}

function safeJson(value: unknown, max = maximumRememberedToolChars) {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = JSON.stringify({ error: "Result could not be serialised." });
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseArguments(value: string) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function outputText(response: OpenAiResponse) {
  for (const item of response.output ?? []) {
    if (!("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return "";
}

function functionCalls(response: OpenAiResponse) {
  return (response.output ?? []).filter((item): item is OpenAiFunctionCall => item.type === "function_call");
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return safeJson(value, 800);
}

function confirmationDetail(capability: string, input: Record<string, unknown>) {
  const preferred = [
    "ref", "customerName", "customer", "site", "address", "description", "source",
    "status", "value", "manager", "owner", "due", "next", "id",
  ];
  const keys = [
    ...preferred.filter((key) => input[key] !== undefined && input[key] !== null && input[key] !== ""),
    ...Object.keys(input).filter((key) => !preferred.includes(key) && input[key] !== undefined && input[key] !== null && input[key] !== ""),
  ].slice(0, 12);
  const details = keys.map((key) => `${humanise(key)}: ${displayValue(input[key])}`);
  return details.length ? details.join("\n") : "Review the requested NeXa change.";
}

function requiredInputMissing(definition: CapabilityDefinition, input: Record<string, unknown>) {
  const schema = definition.name === "create_lead" ? createLeadToolSchema() : definition.inputSchema;
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
  return required.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
}

function pendingResponse(action: BlakePendingCapabilityAction): BlakeOrchestratorResponse {
  return {
    reply: `I’m ready to ${humanise(action.capability).toLowerCase()} in NeXa. Review the details below and confirm if you want me to do it.`,
    aiUsed: true,
    intent: { action: "chat" },
    action: {
      id: action.id,
      kind: "confirm_blake_orchestrator_action",
      title: humanise(action.capability),
      detail: action.detail,
      confirmLabel: "Confirm",
    },
  };
}

function successReply(capability: string, data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const ref = typeof record.ref === "string" ? record.ref : "";
  const customer = typeof record.customer === "string"
    ? record.customer
    : typeof record.customerName === "string" ? record.customerName : "";
  if (ref && customer) return `Done — ${ref} is now saved in NeXa for ${customer}.`;
  if (ref) return `Done — ${ref} is now saved in NeXa.`;
  return `Done — ${humanise(capability).toLowerCase()} completed in NeXa.`;
}

export async function confirmBlakeOrchestratorAction(
  actionId: string,
  actor: BlakeOrchestratorActor,
  access: AccessProfile,
) {
  const action = getBlakePendingAction({ id: actionId, tenantId: actor.tenantId, actorId: actor.id });
  if (!action) {
    return { status: 404, reply: "That Blake action has expired. Ask me to make the change again." };
  }
  const result = await blakeCore.execute<Record<string, unknown>>(action.capability, action.input, {
    actor,
    access,
    conversationId: action.conversationId,
    confirmed: true,
  });
  if (!result.ok) {
    const status = result.error?.code === "FORBIDDEN" ? 403
      : result.error?.code === "INVALID_INPUT" ? 400
        : result.error?.code === "NOT_FOUND" ? 404
          : 409;
    return { status, reply: result.error?.message || "Blake could not complete that NeXa change. Nothing was saved." };
  }
  removeBlakePendingAction(action.id);
  if (action.conversationId) {
    rememberBlakeTool({
      conversationId: action.conversationId,
      tenantId: actor.tenantId,
      actorId: actor.id,
      memory: {
        capability: action.capability,
        input: action.input,
        output: result.data,
        executionId: result.executionId,
        createdAt: new Date().toISOString(),
      },
    });
  }
  return { status: 200, reply: successReply(action.capability, result.data) };
}

function localDateContext(timeZone?: string) {
  const zone = timeZone?.trim() || "UTC";
  try {
    const now = new Date();
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long" }).format(now);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    return { zone, date, weekday, time };
  } catch {
    return { zone: "UTC", date: new Date().toISOString().slice(0, 10), weekday: "", time: "" };
  }
}

function buildSystemPrompt(input: {
  actor: BlakeOrchestratorActor;
  definitions: CapabilityDefinition[];
  history: HistoryMessage[];
  conversationId?: string;
  timeZone?: string;
}) {
  const date = localDateContext(input.timeZone);
  const state = input.conversationId
    ? getBlakeOrchestratorConversation({ id: input.conversationId, tenantId: input.actor.tenantId, actorId: input.actor.id })
    : null;
  const knowledge = listBlakeKnowledge({
    tenantId: input.actor.tenantId,
    actorId: input.actor.id,
    query: input.history.at(-1)?.text || "",
    limit: 12,
  });
  const recentTools = (state?.recentTools ?? []).map((item) => ({
    capability: item.capability,
    input: item.input,
    output: item.output,
    createdAt: item.createdAt,
  }));
  const pending = getBlakePendingAction({
    tenantId: input.actor.tenantId,
    actorId: input.actor.id,
    conversationId: input.conversationId,
  });

  return [
    "You are Blake, the ChatGPT-style AI operating interface inside NeXa.",
    "The user must be able to talk to you naturally, exactly as they would talk to a capable office manager in a continuous conversation. Do not behave like a command parser.",
    "",
    "CORE BEHAVIOUR",
    "- Maintain conversational continuity. Resolve 'it', 'him', 'her', 'they', 'those', 'the first one', 'that job' and similar references from conversation history and recent tool results before deciding to search.",
    "- Never turn a conversational follow-up into a literal global search of the user's sentence. Infer what they are referring to.",
    "- Use NeXa tools whenever a factual answer depends on NeXa data. You may call several tools in sequence to answer one request.",
    "- Search is for locating entities. Once an entity is identified, inspect or use the relevant record/tool instead of repeatedly searching text.",
    "- Prefer customer names, site addresses and human descriptions in replies. Internal refs are useful secondary identifiers, not the main explanation.",
    "- If NeXa data contradicts saved Blake knowledge, NeXa's authoritative record/configuration wins. Explain the conflict rather than silently overriding the system.",
    "- Do not invent records, figures, dates, availability, job states, costs, customers or successful actions.",
    "- If no available capability can do something, say that capability has not yet been exposed to Blake. Do not pretend you performed it.",
    "- Ask only for information genuinely required to continue. Do not ask the user to repeat information already present in the conversation or tool results.",
    "",
    "WRITES AND CONFIRMATION",
    "- When the user asks to change NeXa, call the appropriate write capability with the complete known input. The platform will convert consequential writes into a confirmation request; do not claim the write happened at tool-call time.",
    "- Low-risk explicit memory saves may execute immediately if the capability says confirmation is not required.",
    "- Never bypass NeXa permissions or business services. Never produce SQL or attempt direct database access.",
    "",
    "MEMORY",
    "- If the user explicitly says remember/save/learn a durable company rule or corrects a permanent company rule, use remember_company_knowledge when authorised.",
    "- Use remember_user_preference for personal display/reporting preferences.",
    "- Memory is company/user-scoped. Never infer or reveal knowledge from another tenant.",
    "",
    `Current user: ${input.actor.name}.`,
    `Current local date/time supplied by the client: ${date.weekday} ${date.date} ${date.time} (${date.zone}).`,
    `Available NeXa capabilities: ${input.definitions.map((item) => item.name).join(", ")}.`,
    knowledge.length ? `Relevant persistent Blake knowledge:\n${safeJson(knowledge, 10000)}` : "No relevant persistent Blake knowledge was found.",
    recentTools.length ? `Recent NeXa tool results from this conversation (use these for follow-ups):\n${safeJson(recentTools, maximumRememberedToolChars)}` : "No recent NeXa tool results are stored for this conversation yet.",
    pending ? `There is a pending unconfirmed NeXa action: ${safeJson({ capability: pending.capability, input: pending.input, detail: pending.detail }, 4000)}.` : "There is no pending NeXa action.",
  ].join("\n");
}

async function callOpenAi(input: {
  apiKey: string;
  model: string;
  instructions: string;
  tools: unknown[];
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  previousResponseId?: string;
  toolOutputs?: Array<{ type: "function_call_output"; call_id: string; output: string }>;
}) {
  const body: Record<string, unknown> = {
    model: input.model,
    instructions: input.instructions,
    tools: input.tools,
    tool_choice: "auto",
    parallel_tool_calls: true,
    max_output_tokens: 2200,
  };
  if (input.previousResponseId) body.previous_response_id = input.previousResponseId;
  if (input.toolOutputs) body.input = input.toolOutputs;
  else body.input = input.messages ?? [];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI response failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return await response.json() as OpenAiResponse;
}

export async function handleBlakeOrchestratedMessage(input: {
  message: string;
  actor: BlakeOrchestratorActor;
  access: AccessProfile;
  history?: HistoryMessage[];
  conversationId?: string;
  timeZone?: string;
}): Promise<BlakeOrchestratorResponse | null> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;

  const history = (input.history ?? []).slice(-40);
  const pending = getBlakePendingAction({
    tenantId: input.actor.tenantId,
    actorId: input.actor.id,
    conversationId: input.conversationId,
  });
  if (pending && exactConfirmation(input.message)) {
    const result = await confirmBlakeOrchestratorAction(pending.id, input.actor, input.access);
    return { reply: result.reply, aiUsed: false, intent: { action: "chat" }, status: result.status };
  }
  if (pending && exactCancellation(input.message)) {
    removeBlakePendingAction(pending.id);
    return { reply: "Cancelled — I have not made that change in NeXa.", aiUsed: false, intent: { action: "chat" } };
  }

  const definitions = visibleDefinitions(input.access);
  const definitionsByName = new Map(definitions.map((item) => [item.name, item]));
  const tools = openAiTools(definitions);
  const instructions = buildSystemPrompt({
    actor: input.actor,
    definitions,
    history: [...history, { role: "user", text: input.message }],
    conversationId: input.conversationId,
    timeZone: input.timeZone,
  });
  const model = process.env.BLAKE_MODEL?.trim()
    || process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || "gpt-4.1-mini";

  if (input.conversationId) {
    patchBlakeOrchestratorConversation({
      id: input.conversationId,
      tenantId: input.actor.tenantId,
      actorId: input.actor.id,
      patch: { lastUserMessage: input.message },
    });
  }

  try {
    let response = await callOpenAi({
      apiKey,
      model,
      instructions,
      tools,
      messages: [
        ...history.map((item) => ({ role: item.role, content: item.text })),
        { role: "user", content: input.message },
      ],
    });

    for (let round = 0; round < maximumToolRounds; round += 1) {
      const calls = functionCalls(response);
      if (!calls.length) {
        const reply = outputText(response) || "I couldn't form a reliable answer from NeXa. Please try that again.";
        if (input.conversationId) {
          patchBlakeOrchestratorConversation({
            id: input.conversationId,
            tenantId: input.actor.tenantId,
            actorId: input.actor.id,
            patch: { lastAssistantReply: reply },
          });
        }
        return { reply, aiUsed: true, intent: { action: "chat" } };
      }

      const toolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
      for (const call of calls) {
        const definition = definitionsByName.get(call.name);
        if (!definition) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: safeJson({ ok: false, error: `Capability ${call.name} is not available to this user.` }),
          });
          continue;
        }
        const args = parseArguments(call.arguments);
        const missing = requiredInputMissing(definition, args);
        if (missing.length) {
          toolOutputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: safeJson({ ok: false, error: `Missing required information: ${missing.join(", ")}. Ask the user only for those missing details.` }),
          });
          continue;
        }

        if (definition.mode === "write" && definition.requiresConfirmation) {
          const now = new Date();
          const action = saveBlakePendingAction({
            id: `blake-orchestrator-${crypto.randomUUID()}`,
            tenantId: input.actor.tenantId,
            actorId: input.actor.id,
            actorName: input.actor.name,
            conversationId: input.conversationId,
            channel: input.actor.channel,
            capability: call.name,
            input: args,
            title: humanise(call.name),
            detail: confirmationDetail(call.name, args),
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + pendingLifetimeMs).toISOString(),
          });
          return pendingResponse(action);
        }

        const result = await blakeCore.execute(call.name, args, {
          actor: input.actor,
          access: input.access,
          conversationId: input.conversationId,
          confirmed: false,
        });
        const resultPayload = result.ok
          ? { ok: true, data: result.data, executionId: result.executionId }
          : { ok: false, error: result.error, executionId: result.executionId };
        rememberBlakeTool({
          conversationId: input.conversationId,
          tenantId: input.actor.tenantId,
          actorId: input.actor.id,
          memory: {
            capability: call.name,
            input: args,
            output: resultPayload,
            executionId: result.executionId,
            createdAt: new Date().toISOString(),
          },
        });
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: safeJson(resultPayload, 24000),
        });
      }

      if (!response.id) throw new Error("OpenAI did not return a response id for tool continuation.");
      response = await callOpenAi({
        apiKey,
        model,
        instructions,
        tools,
        previousResponseId: response.id,
        toolOutputs,
      });
    }

    return {
      reply: "I reached the NeXa tool-call limit for that request before I could finish reliably. Nothing unconfirmed was changed. Please narrow the request slightly and I'll continue.",
      aiUsed: true,
      intent: { action: "chat" },
      status: 409,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Blake AI error";
    console.error("Blake orchestrator failed", message);
    return {
      reply: "Blake's AI connection failed while I was working through that request. I have not guessed or silently fallen back to a simpler bot. Please try again in a moment.",
      aiUsed: true,
      intent: { action: "chat" },
      status: 502,
    };
  }
}

import { NextResponse } from "next/server";

import { canEditTenders, getAccessProfileFromHeaders } from "@/lib/access";
import type { BlakeScreenContext } from "@/lib/blake-open-record";
import { contextualiseJobDirectoryFollowUp, handleBlakeJobDirectoryMessage } from "@/lib/blake-job-directory";
import {
  confirmBlakeOrchestratorAction,
  handleBlakeOrchestratedMessage,
} from "@/lib/blake-orchestrator";
import { parseJsonRequestBody } from "@/lib/http";
import {
  confirmNexaAssistantAction,
  handleNexaAssistantMessage,
  type BlakeHistoryMessage,
  type BuddyClientContext,
} from "@/lib/nexa-assistant";
import { loadServerStore } from "@/lib/server-store";
import { confirmCreateLeadWorkflow } from "@/lib/blake-create-lead-workflow";
import { confirmBlakeWriteAction, handleBlakeWriteMessage } from "@/lib/blake-write-operator";

export const runtime = "nodejs";
export const maxDuration = 90;

function readScreenContext(input: unknown): BlakeScreenContext | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const view = typeof raw.view === "string" ? raw.view.slice(0, 80) : undefined;
  const tenderId = typeof raw.tenderId === "string" ? raw.tenderId.slice(0, 120) : undefined;
  const jobId = typeof raw.jobId === "string" ? raw.jobId.slice(0, 120) : undefined;
  const takeoffId = typeof raw.takeoffId === "string" ? raw.takeoffId.slice(0, 120) : undefined;
  if (!view && !tenderId && !jobId && !takeoffId) return undefined;
  return { view, tenderId, jobId, takeoffId };
}

type AssistantRequest = {
  message?: string;
  history?: BlakeHistoryMessage[];
  buddyContext?: BuddyClientContext;
  screenContext?: BlakeScreenContext;
  confirmActionId?: string;
  sourceRoute?: string;
  sourcePage?: string;
  channel?: "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
  conversationId?: string;
  timeZone?: string;
};

function normaliseLeadCreationRequest(message: string) {
  if (!/\blead\b/i.test(message) || /\bL[-\s]?\d{3,6}\b/i.test(message)) return message;
  if (/^\s*(?:how|where|why|what do i need|show me how)\b/i.test(message)) return message;
  if (/\b(?:create|start|add|new)\b.*\blead\b|\bnew lead\b/i.test(message)) return message;
  if (/\b(?:make|set up|open|raise|log)\b.*\blead\b/i.test(message)) return `Create lead. ${message}`;
  return message;
}

export async function POST(request: Request) {
  try {
    const access = getAccessProfileFromHeaders(request.headers);
    const canChat = access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
    if (!canChat) {
      return NextResponse.json({ error: "Your role cannot use Ayla." }, { status: 403 });
    }
    const payload = await parseJsonRequestBody<AssistantRequest>(request);
    if (!payload) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const channel: "web_text" | "web_voice" | "mobile_text" | "mobile_voice" =
      ["web_text", "web_voice", "mobile_text", "mobile_voice"].includes(String(payload.channel))
        ? payload.channel as "web_text" | "web_voice" | "mobile_text" | "mobile_voice"
        : "web_text";
    const actor = {
      id: request.headers.get("x-nexa-auth-user-id")
        || request.headers.get("x-hubflo-employee-id")
        || "nexa-user",
      name: request.headers.get("x-nexa-auth-user-name") || "NeXa user",
      tenantId: request.headers.get("x-hubflo-tenant-id") || "default",
      canCreateLead: access.canCreateLead,
      access,
      channel,
    };

    if (payload.confirmActionId) {
      if (payload.confirmActionId.startsWith("blake-orchestrator-")) {
        const result = await confirmBlakeOrchestratorAction(payload.confirmActionId, {
          id: actor.id,
          name: actor.name,
          tenantId: actor.tenantId,
          channel,
        }, access);
        return NextResponse.json(result, { status: result.status });
      }
      // Legacy action formats remain valid while existing conversations/cards age out.
      if (payload.confirmActionId.startsWith("blake-write-")) {
        const result = await confirmBlakeWriteAction(payload.confirmActionId, {
          id: actor.id,
          name: actor.name,
          tenantId: actor.tenantId,
          channel,
        }, access);
        return NextResponse.json(result, { status: result.status });
      }
      if (payload.confirmActionId.startsWith("blake-lead-")) {
        const result = await confirmCreateLeadWorkflow(payload.confirmActionId, {
          actorId: actor.id,
          actorName: actor.name,
          tenantId: actor.tenantId,
          canCreateLead: actor.canCreateLead,
          workflowRunId: payload.confirmActionId,
        });
        return NextResponse.json(result, { status: result.status });
      }
      const pending = loadServerStore<{ actions: Array<{ id: string; kind?: string }> }>("nexa-assistant-actions", {
        actions: [],
      });
      const pendingAction = pending.actions.find((item) => item.id === payload.confirmActionId);
      const isFaultConfirm = pendingAction?.kind === "fault_report";
      const isBudgetConfirm = pendingAction?.kind === "budget_prices";
      if (isBudgetConfirm && !canEditTenders(access)) {
        return NextResponse.json({ error: "Your role can chat with Blake but cannot write tender rates." }, { status: 403 });
      }
      if (!isFaultConfirm && !isBudgetConfirm && !access.canEditJobs) {
        return NextResponse.json({ error: "Your role can chat with Blake but cannot create bookings." }, { status: 403 });
      }
      const result = await confirmNexaAssistantAction(payload.confirmActionId, actor);
      return NextResponse.json(result, { status: result.status });
    }

    const rawMessage = payload.message?.trim();
    if (!rawMessage) return NextResponse.json({ error: "Ask Ayla a question first." }, { status: 400 });
    const history = Array.isArray(payload.history)
      ? payload.history
        .filter((item): item is BlakeHistoryMessage => Boolean(item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string"))
        .slice(-40)
        .map((item) => ({ role: item.role, text: item.text.slice(0, 6000) }))
      : [];
    const buddyContext =
      payload.buddyContext && typeof payload.buddyContext === "object" ? payload.buddyContext : undefined;
    const conversationId = typeof payload.conversationId === "string" ? payload.conversationId.slice(0, 120) : undefined;

    // Primary path: one ChatGPT-style orchestrator reasons over the full authorised NeXa capability registry.
    // The older deterministic handlers below are compatibility fallbacks only when no OpenAI key is configured.
    const orchestrated = await handleBlakeOrchestratedMessage({
      message: rawMessage,
      actor: { id: actor.id, name: actor.name, tenantId: actor.tenantId, channel },
      access,
      history,
      conversationId,
      timeZone: typeof payload.timeZone === "string" ? payload.timeZone.slice(0, 80) : undefined,
    });
    if (orchestrated) {
      return NextResponse.json(orchestrated, { status: orchestrated.status ?? 200 });
    }

    // Compatibility fallback for environments where OpenAI is intentionally not configured.
    const jobDirectoryResponse = await handleBlakeJobDirectoryMessage(
      rawMessage,
      { id: actor.id, name: actor.name, tenantId: actor.tenantId, channel },
      access,
      history,
    );
    if (jobDirectoryResponse) {
      return NextResponse.json(jobDirectoryResponse);
    }

    const writeResponse = await handleBlakeWriteMessage(
      rawMessage,
      { id: actor.id, name: actor.name, tenantId: actor.tenantId, channel },
      access,
      history,
      conversationId,
    );
    if (writeResponse) {
      return NextResponse.json(writeResponse, { status: writeResponse.status ?? 200 });
    }

    const message = normaliseLeadCreationRequest(contextualiseJobDirectoryFollowUp(rawMessage, history));
    return NextResponse.json(
      await handleNexaAssistantMessage(message, actor, {
        history,
        buddyContext,
        screenContext: readScreenContext(payload.screenContext),
        sourceRoute: payload.sourceRoute,
        sourcePage: payload.sourcePage,
        conversationId,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Blake could not finish that request.",
        reply: "Blake hit a server snag. Try again in a moment — nothing unconfirmed was changed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  const canChat = access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
  if (!canChat) {
    return NextResponse.json({ error: "Your role cannot use Ayla." }, { status: 403 });
  }
  const url = new URL(request.url);
  const { loadBlakeMemoryForScreen } = await import("@/lib/blake-record-memory");
  const memory = loadBlakeMemoryForScreen({
    tenderId: url.searchParams.get("tenderId"),
    jobId: url.searchParams.get("jobId"),
    takeoffId: url.searchParams.get("takeoffId"),
  });
  return NextResponse.json({
    messages: memory.messages,
    scope: memory.scope,
    lastScanSummary: memory.lastScanSummary || null,
    rejectedCodes: memory.rejectedCodes,
  });
}

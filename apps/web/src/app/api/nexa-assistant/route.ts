import { NextResponse } from "next/server";

import { canEditTenders, getAccessProfileFromHeaders } from "@/lib/access";
import type { BlakeScreenContext } from "@/lib/blake-open-record";
import { parseJsonRequestBody } from "@/lib/http";
import {
  confirmNexaAssistantAction,
  handleNexaAssistantMessage,
  type BlakeHistoryMessage,
  type BuddyClientContext,
} from "@/lib/nexa-assistant";
import { loadServerStore } from "@/lib/server-store";

export const runtime = "nodejs";
export const maxDuration = 90;

function readScreenContext(input: unknown): BlakeScreenContext | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const view = typeof raw.view === "string" ? raw.view.slice(0, 80) : undefined;
  const tenderId = typeof raw.tenderId === "string" ? raw.tenderId.slice(0, 120) : undefined;
  const jobId = typeof raw.jobId === "string" ? raw.jobId.slice(0, 120) : undefined;
  if (!view && !tenderId && !jobId) return undefined;
  return { view, tenderId, jobId };
}

type AssistantRequest = {
  message?: string;
  history?: BlakeHistoryMessage[];
  buddyContext?: BuddyClientContext;
  screenContext?: BlakeScreenContext;
  confirmActionId?: string;
  sourceRoute?: string;
  sourcePage?: string;
};

export async function POST(request: Request) {
  try {
    const access = getAccessProfileFromHeaders(request.headers);
    const canChat = access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
    if (!canChat) {
      return NextResponse.json({ error: "Your role cannot use Blake." }, { status: 403 });
    }
    const payload = await parseJsonRequestBody<AssistantRequest>(request);
    if (!payload) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const actor = {
      id: request.headers.get("x-nexa-auth-user-id")
        || request.headers.get("x-hubflo-employee-id")
        || "nexa-user",
      name: request.headers.get("x-nexa-auth-user-name") || "NeXa user",
    };

    if (payload.confirmActionId) {
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

    const message = payload.message?.trim();
    if (!message) return NextResponse.json({ error: "Ask Blake a question first." }, { status: 400 });
    const history = Array.isArray(payload.history)
      ? payload.history
        .filter((item): item is BlakeHistoryMessage => Boolean(item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string"))
        .slice(-16)
        .map((item) => ({ role: item.role, text: item.text.slice(0, 4000) }))
      : [];
    const buddyContext =
      payload.buddyContext && typeof payload.buddyContext === "object" ? payload.buddyContext : undefined;
    return NextResponse.json(
      await handleNexaAssistantMessage(message, actor, {
        history,
        buddyContext,
        screenContext: readScreenContext(payload.screenContext),
        sourceRoute: payload.sourceRoute,
        sourcePage: payload.sourcePage,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Blake could not finish that request.",
        reply: "Blake hit a server snag logging that. Try again in a moment — nothing was saved yet.",
      },
      { status: 500 },
    );
  }
}

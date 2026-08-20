import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { confirmBlakeOperatorAction } from "@/lib/blake-operator";
import {
  confirmNexaAssistantAction,
  type BuddyClientContext,
  type BlakeHistoryMessage,
} from "@/lib/nexa-assistant";
import { handleContextAwareNexaAssistantMessage } from "@/lib/nexa-assistant-context";
import { parseJsonRequestBody } from "@/lib/http";

type AssistantRequest = {
  message?: string;
  history?: BlakeHistoryMessage[];
  buddyContext?: BuddyClientContext;
  confirmActionId?: string;
};

export async function POST(request: Request) {
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
    const operatorResult = await confirmBlakeOperatorAction(payload.confirmActionId, actor, access);
    if (operatorResult.matched) {
      return NextResponse.json(operatorResult, { status: operatorResult.status });
    }
    if (!access.canEditJobs) {
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
  return NextResponse.json(await handleContextAwareNexaAssistantMessage(message, actor, access, { history, buddyContext }));
}

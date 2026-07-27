import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { confirmNexaAssistantAction, handleNexaAssistantMessage, type BuddyHistoryMessage } from "@/lib/nexa-assistant";
import { parseJsonRequestBody } from "@/lib/http";

type AssistantRequest = {
  message?: string;
  history?: BuddyHistoryMessage[];
  confirmActionId?: string;
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  const canChat = access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
  if (!canChat) {
    return NextResponse.json({ error: "Your role cannot use Buddy." }, { status: 403 });
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
    if (!access.canEditJobs) {
      return NextResponse.json({ error: "Your role can chat with Buddy but cannot create bookings." }, { status: 403 });
    }
    const result = await confirmNexaAssistantAction(payload.confirmActionId, actor);
    return NextResponse.json(result, { status: result.status });
  }

  const message = payload.message?.trim();
  if (!message) return NextResponse.json({ error: "Ask Buddy a question first." }, { status: 400 });
  const history = Array.isArray(payload.history)
    ? payload.history
      .filter((item): item is BuddyHistoryMessage => Boolean(item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string"))
      .slice(-16)
      .map((item) => ({ role: item.role, text: item.text.slice(0, 4000) }))
    : [];
  return NextResponse.json(await handleNexaAssistantMessage(message, actor, { history }));
}

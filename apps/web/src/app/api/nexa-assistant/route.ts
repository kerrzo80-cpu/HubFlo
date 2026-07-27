import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { confirmNexaAssistantAction, handleNexaAssistantMessage } from "@/lib/nexa-assistant";
import { parseJsonRequestBody } from "@/lib/http";

type AssistantRequest = {
  message?: string;
  confirmActionId?: string;
};

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showSchedule) {
    return NextResponse.json({ error: "Your role cannot access the team schedule." }, { status: 403 });
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
      return NextResponse.json({ error: "Your role can check availability but cannot create bookings." }, { status: 403 });
    }
    const result = await confirmNexaAssistantAction(payload.confirmActionId, actor);
    return NextResponse.json(result, { status: result.status });
  }

  const message = payload.message?.trim();
  if (!message) return NextResponse.json({ error: "Ask NeXa a question first." }, { status: 400 });
  return NextResponse.json(await handleNexaAssistantMessage(message, actor));
}

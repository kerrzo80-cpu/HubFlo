import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { blakeCore, getOrCreateBlakeContext } from "@/lib/blake-core";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

function trustedActor(request: Request, channel: "web_text" | "web_voice" | "mobile_text" | "mobile_voice") {
  return {
    id: request.headers.get("x-nexa-auth-user-id") || request.headers.get("x-hubflo-employee-id") || "nexa-user",
    name: request.headers.get("x-nexa-auth-user-name") || "NeXa user",
    tenantId: request.headers.get("x-hubflo-tenant-id") || "default",
    channel,
  } as const;
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  const visible = blakeCore.definitions().filter((item) => item.requiredPermissions.every((permission) => access[permission as keyof typeof access] === true));
  return NextResponse.json({
    coreVersion: 2,
    capabilities: visible,
    writeCapabilities: visible.filter((item) => item.mode === "write").map((item) => item.name),
    writeAccess: {
      canCreateLead: access.canCreateLead,
      canCreateQuote: access.canCreateQuote,
      canCreateJob: access.canCreateJob,
      canEditJobs: access.canEditJobs,
      canEditInvoice: access.canEditInvoice,
      canRequestPurchase: access.canRequestPurchase,
      canApprovePurchase: access.canApprovePurchase,
    },
  });
}

export async function POST(request: Request) {
  const body = await parseJsonRequestBody<{ capability?: string; input?: unknown; conversationId?: string; channel?: string; confirmed?: boolean }>(request);
  if (!body?.capability) return NextResponse.json({ error: "Capability is required." }, { status: 400 });
  const channel = ["web_text", "web_voice", "mobile_text", "mobile_voice"].includes(String(body.channel))
    ? body.channel as "web_text" | "web_voice" | "mobile_text" | "mobile_voice"
    : "web_text";
  const actor = trustedActor(request, channel);
  const conversation = getOrCreateBlakeContext({ id: body.conversationId, tenantId: actor.tenantId, actorId: actor.id, channel });
  const result = await blakeCore.execute(body.capability, body.input, {
    actor,
    access: getAccessProfileFromHeaders(request.headers),
    conversationId: conversation.id,
    confirmed: body.confirmed === true,
  });
  const status = result.ok ? 200 : result.error?.code === "INVALID_INPUT" ? 400 : result.error?.code === "NOT_FOUND" ? 404 : result.error?.code === "EXECUTION_FAILED" ? 409 : 403;
  return NextResponse.json({ ...result, conversationId: conversation.id }, { status });
}

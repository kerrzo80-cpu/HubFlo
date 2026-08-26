import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { createBlakeChat, deleteBlakeChat, listBlakeChats, updateBlakeChat, type BlakeChatMessage } from "@/lib/blake-chat-store";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

function identity(headers: Headers) {
  return {
    tenantId: headers.get("x-hubflo-tenant-id") || "default",
    userId: headers.get("x-nexa-auth-user-id") || headers.get("x-hubflo-employee-id") || "nexa-user",
  };
}

function mayChat(headers: Headers) {
  const access = getAccessProfileFromHeaders(headers);
  return access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
}

export async function GET(request: Request) {
  if (!mayChat(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake." }, { status: 403 });
  const actor = identity(request.headers);
  return NextResponse.json({ chats: listBlakeChats(actor.tenantId, actor.userId) });
}

export async function POST(request: Request) {
  if (!mayChat(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake." }, { status: 403 });
  const body = await parseJsonRequestBody<{ title?: string }>(request);
  const actor = identity(request.headers);
  return NextResponse.json({ chat: createBlakeChat(actor.tenantId, actor.userId, body?.title) }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!mayChat(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake." }, { status: 403 });
  const body = await parseJsonRequestBody<{ id?: string; title?: string; messages?: BlakeChatMessage[] }>(request);
  if (!body?.id) return NextResponse.json({ error: "Chat id is required." }, { status: 400 });
  const actor = identity(request.headers);
  const chat = updateBlakeChat(actor.tenantId, actor.userId, body.id, { title: body.title, messages: body.messages });
  return chat ? NextResponse.json({ chat }) : NextResponse.json({ error: "Chat not found." }, { status: 404 });
}

export async function DELETE(request: Request) {
  if (!mayChat(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chat id is required." }, { status: 400 });
  const actor = identity(request.headers);
  return deleteBlakeChat(actor.tenantId, actor.userId, id)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Chat not found." }, { status: 404 });
}

import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  archiveBlakeKnowledge,
  listBlakeKnowledge,
  updateBlakeKnowledge,
  type BlakeKnowledgeCategory,
  type BlakeKnowledgeItem,
} from "@/lib/blake-knowledge";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

function identity(headers: Headers) {
  return {
    tenantId: headers.get("x-hubflo-tenant-id") || "default",
    userId: headers.get("x-nexa-auth-user-id") || headers.get("x-hubflo-employee-id") || "nexa-user",
    userName: headers.get("x-nexa-auth-user-name") || headers.get("x-hubflo-employee-name") || "NeXa user",
  };
}

function canUseBlake(headers: Headers) {
  const access = getAccessProfileFromHeaders(headers);
  return access.showCore && (access.showJobs || access.showQuotes || access.showCustomers || access.showFinance || access.canCustomize);
}

function mayManage(item: BlakeKnowledgeItem, headers: Headers) {
  const access = getAccessProfileFromHeaders(headers);
  const actor = identity(headers);
  if (item.scope === "user") return item.actorId === actor.userId;
  if (item.scope === "company") return access.canCustomize;
  if (item.scope === "job") return access.showJobs && access.canEditJobs;
  if (item.scope === "quote") return access.showQuotes && access.canCreateQuote;
  if (item.scope === "lead") return access.canCreateLead;
  if (item.scope === "customer" || item.scope === "site" || item.scope === "employee") return access.canCustomize;
  return false;
}

function visibleItems(request: Request, includeInactive = false) {
  const actor = identity(request.headers);
  const access = getAccessProfileFromHeaders(request.headers);
  const items = listBlakeKnowledge({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    includeEntityScopes: true,
    includeInactive,
    limit: 50,
  });
  return items.filter((item) => {
    if (item.scope === "company" || item.scope === "user") return true;
    if (item.scope === "job") return access.showJobs;
    if (item.scope === "quote") return access.showQuotes;
    if (item.scope === "lead") return access.canCreateLead || access.showJobs || access.showQuotes;
    if (item.scope === "customer" || item.scope === "site") return access.showCustomers;
    if (item.scope === "employee") return access.showSchedule;
    return false;
  });
}

export async function GET(request: Request) {
  if (!canUseBlake(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake Knowledge." }, { status: 403 });
  const url = new URL(request.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const query = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const scope = url.searchParams.get("scope")?.trim() || "";
  const items = visibleItems(request, includeInactive).filter((item) => {
    if (scope && item.scope !== scope) return false;
    if (!query) return true;
    return `${item.title} ${item.content} ${item.key} ${item.category} ${item.scope}`.toLowerCase().includes(query);
  });
  return NextResponse.json({ items });
}

export async function PATCH(request: Request) {
  if (!canUseBlake(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake Knowledge." }, { status: 403 });
  const body = await parseJsonRequestBody<{ id?: string; title?: string; content?: string; category?: BlakeKnowledgeCategory }>(request);
  if (!body?.id) return NextResponse.json({ error: "Knowledge id is required." }, { status: 400 });
  const existing = visibleItems(request, false).find((item) => item.id === body.id);
  if (!existing) return NextResponse.json({ error: "Knowledge item not found." }, { status: 404 });
  if (!mayManage(existing, request.headers)) return NextResponse.json({ error: "Your role cannot change that knowledge item." }, { status: 403 });
  const actor = identity(request.headers);
  const item = updateBlakeKnowledge({
    id: body.id,
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorName: actor.userName,
    title: body.title,
    content: body.content,
    category: body.category,
  });
  return item ? NextResponse.json({ item }) : NextResponse.json({ error: "Knowledge item could not be updated." }, { status: 409 });
}

export async function DELETE(request: Request) {
  if (!canUseBlake(request.headers)) return NextResponse.json({ error: "Your role cannot use Blake Knowledge." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Knowledge id is required." }, { status: 400 });
  const existing = visibleItems(request, false).find((item) => item.id === id);
  if (!existing) return NextResponse.json({ error: "Knowledge item not found." }, { status: 404 });
  if (!mayManage(existing, request.headers)) return NextResponse.json({ error: "Your role cannot forget that knowledge item." }, { status: 403 });
  const actor = identity(request.headers);
  const item = archiveBlakeKnowledge({ id, tenantId: actor.tenantId, actorId: actor.userId });
  return item ? NextResponse.json({ item }) : NextResponse.json({ error: "Knowledge item could not be archived." }, { status: 409 });
}

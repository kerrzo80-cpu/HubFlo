import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  listSimproEntityLinks,
  simproEntityLinkStats,
  type SimproLinkEntityType,
  upsertSimproEntityLink,
} from "@/lib/simpro-entity-links";
import { parseJsonRequestBody } from "@/lib/http";
import { getSimproDirectConfigStatus } from "@/lib/simpro-auth";

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

const entityTypes: SimproLinkEntityType[] = [
  "client",
  "site",
  "quote",
  "job",
  "invoice",
  "section",
  "costCentre",
  "attachment",
  "note",
];

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entityType = request.nextUrl.searchParams.get("entityType") as SimproLinkEntityType | null;
  const companyId = request.nextUrl.searchParams.get("companyId")?.trim();
  const links = listSimproEntityLinks({
    entityType: entityType && entityTypes.includes(entityType) ? entityType : undefined,
    companyId: companyId || undefined,
  });

  return NextResponse.json({
    stats: simproEntityLinkStats(),
    links,
  });
}

export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<{
    entityType?: SimproLinkEntityType;
    externalId?: string;
    externalNumber?: string;
    nexaId?: string;
    nexaRef?: string;
    nexaName?: string;
    companyId?: string;
    importedReadOnly?: boolean;
  }>(request);

  const config = getSimproDirectConfigStatus();
  const companyId = body?.companyId?.trim() || config.companyId || "";
  const entityType = body?.entityType;
  const externalId = body?.externalId?.trim() || "";
  const nexaId = body?.nexaId?.trim() || "";

  if (!companyId || !entityType || !entityTypes.includes(entityType) || !externalId || !nexaId) {
    return NextResponse.json(
      { error: "companyId, entityType, externalId, and nexaId are required" },
      { status: 400 },
    );
  }

  try {
    const link = upsertSimproEntityLink({
      companyId,
      entityType,
      externalId,
      externalNumber: body?.externalNumber,
      nexaId,
      nexaRef: body?.nexaRef,
      nexaName: body?.nexaName,
      importedReadOnly: body?.importedReadOnly ?? true,
    });
    return NextResponse.json({ link, stats: simproEntityLinkStats() }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save entity link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

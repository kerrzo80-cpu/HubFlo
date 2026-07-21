import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  getSimproSyncStatus,
  runSimproImport,
  type SimproSyncEntity,
  type SimproSyncMode,
} from "@/lib/simpro-sync";

const allowedEntities: SimproSyncEntity[] = ["clients", "sites", "quotes", "jobs", "invoices"];

type SyncRequestBody = {
  mode?: SimproSyncMode;
  apply?: boolean;
  entities?: string[];
  actor?: string;
};

function canManageIntegrations(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

export async function GET(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(getSimproSyncStatus());
}

export async function POST(request: NextRequest) {
  if (!canManageIntegrations(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<SyncRequestBody>(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const entities = body.entities
    ?.filter((entity): entity is SimproSyncEntity => allowedEntities.includes(entity as SimproSyncEntity));
  const mode: SimproSyncMode = body.mode ?? (body.apply ? "apply" : "preview");
  const actor = body.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa user";
  const run = await runSimproImport({
    mode,
    entities,
    actor,
  });

  return NextResponse.json({
    run,
    status: getSimproSyncStatus(),
  });
}

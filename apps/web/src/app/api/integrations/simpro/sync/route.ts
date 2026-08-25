import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  getSimproSyncStatus,
  resolveSimproSyncConflict,
  runSimproImport,
  type SimproConflictResolveAction,
  type SimproSyncEntity,
  type SimproSyncMode,
} from "@/lib/simpro-sync";

export const runtime = "nodejs";
/** Quote/job Apply can be long — give Render enough room before the platform kills the request. */
export const maxDuration = 300;

const allowedEntities: SimproSyncEntity[] = ["clients", "sites", "leads", "quotes", "jobs", "invoices", "schedules"];

type SyncRequestBody = {
  mode?: SimproSyncMode;
  apply?: boolean;
  entities?: string[];
  actor?: string;
  resolve?: {
    operationId: string;
    action: SimproConflictResolveAction;
    nexaId?: string;
  };
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

  const actor = body.actor?.trim() || request.headers.get(employeeHeaderName) || "Blake user";

  if (body.resolve?.operationId && body.resolve.action) {
    try {
      const operation = resolveSimproSyncConflict({
        operationId: body.resolve.operationId,
        action: body.resolve.action,
        nexaId: body.resolve.nexaId,
        actor,
      });
      return NextResponse.json({
        operation,
        status: getSimproSyncStatus(),
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Unable to resolve simPRO conflict.",
          status: getSimproSyncStatus(),
        },
        { status: 400 },
      );
    }
  }

  const entities = body.entities
    ?.filter((entity): entity is SimproSyncEntity => allowedEntities.includes(entity as SimproSyncEntity));
  const mode: SimproSyncMode = body.mode ?? (body.apply ? "apply" : "preview");

  try {
    const run = await runSimproImport({
      mode,
      entities,
      actor,
    });

    return NextResponse.json({
      run,
      status: getSimproSyncStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run simPRO sync.";
    const lower = message.toLowerCase();
    const status =
      lower.includes("forbidden")
        ? 403
        : lower.includes("unauthenticated") || lower.includes("invalid refresh token")
          ? 400
          : 500;

    return NextResponse.json(
      {
        error: message,
        status: getSimproSyncStatus(),
      },
      { status },
    );
  }
}

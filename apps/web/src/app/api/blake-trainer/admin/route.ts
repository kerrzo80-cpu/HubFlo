import { NextResponse } from "next/server";

import type { HubRole } from "@/lib/access";
import { parseRole } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import {
  setFlowStatus,
  upsertFlow,
  upsertMaterial,
  upsertModule,
} from "@/lib/blake-trainer/store";
import type {
  TrainerFlow,
  TrainerFlowStatus,
  TrainerMaterial,
  TrainerMaterialKind,
  TrainerModule,
} from "@/lib/blake-trainer/types";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

type AdminAction =
  | { action: "upsert_material"; material: Partial<TrainerMaterial> & { title: string; content: string; kind: TrainerMaterialKind } }
  | { action: "upsert_flow"; flow: Partial<TrainerFlow> & { title: string } }
  | { action: "upsert_module"; module: Partial<TrainerModule> & { title: string } }
  | { action: "set_flow_status"; flowId: string; status: TrainerFlowStatus };

function requireAdmin(request: Request):
  | { error: NextResponse; role?: undefined; name?: undefined }
  | { error?: undefined; role: HubRole; name: string } {
  const user = getAuthenticatedUser(request);
  const url = new URL(request.url);
  const role =
    parseRole(url.searchParams.get("role"))
    || (user?.role as HubRole | undefined)
    || parseRole(request.headers.get("x-hubflo-role"))
    || "Engineer";
  if (role !== "Owner/Admin" && role !== "Manager") {
    return { error: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }
  return {
    role,
    name: user?.name || "Brian Kerr",
  };
}

export async function POST(request: Request) {
  const gate = requireAdmin(request);
  if (gate.error) return gate.error;

  const body = await parseJsonRequestBody<AdminAction>(request);
  if (!body?.action) {
    return NextResponse.json({ error: "Choose an admin action." }, { status: 400 });
  }

  try {
    if (body.action === "upsert_material") {
      const material = upsertMaterial({
        ...body.material,
        approvedBy: body.material.approved ? gate.name : body.material.approvedBy,
      });
      return NextResponse.json({ ok: true, material });
    }
    if (body.action === "upsert_flow") {
      const flow = upsertFlow({
        ...body.flow,
        createdBy: body.flow.createdBy || gate.name,
      });
      return NextResponse.json({ ok: true, flow });
    }
    if (body.action === "upsert_module") {
      const module = upsertModule(body.module);
      return NextResponse.json({ ok: true, module });
    }
    if (body.action === "set_flow_status") {
      const flow = setFlowStatus(body.flowId, body.status);
      return NextResponse.json({ ok: true, flow });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Admin action failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

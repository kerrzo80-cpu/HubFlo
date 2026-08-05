import { NextResponse } from "next/server";

import type { HubRole } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import {
  getBlakeTrainerState,
  getFlow,
  getModulesForFlow,
  listFlows,
  listProgress,
  summariseCompletion,
} from "@/lib/blake-trainer/store";
import { parseRole } from "@/lib/access";

export const runtime = "nodejs";

function actor(request: Request) {
  const user = getAuthenticatedUser(request);
  const url = new URL(request.url);
  const role =
    parseRole(url.searchParams.get("role"))
    || (user?.role as HubRole | undefined)
    || "Engineer";
  return {
    userId: user?.id || url.searchParams.get("userId") || "demo-learner",
    userName: user?.name || url.searchParams.get("userName") || "Learner",
    role,
    isAdmin: role === "Owner/Admin" || role === "Manager",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "catalog";
  const { role, userId, isAdmin } = actor(request);

  if (view === "admin" && isAdmin) {
    const state = getBlakeTrainerState();
    return NextResponse.json({
      ok: true,
      role,
      materials: state.materials,
      modules: state.modules,
      flows: state.flows,
      completion: summariseCompletion(),
    });
  }

  if (view === "completion" && isAdmin) {
    return NextResponse.json({
      ok: true,
      completion: summariseCompletion(url.searchParams.get("flowId") || undefined),
    });
  }

  const flowId = url.searchParams.get("flowId");
  if (flowId) {
    const flow = getFlow(flowId);
    if (!flow) return NextResponse.json({ error: "Flow not found." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      flow,
      modules: getModulesForFlow(flow),
      progress: listProgress({ userId, flowId }),
    });
  }

  const flows = listFlows({ status: "published", role });
  const progress = listProgress({ userId });
  return NextResponse.json({
    ok: true,
    role,
    userId,
    flows,
    progress,
  });
}

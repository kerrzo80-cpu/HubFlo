import { NextResponse } from "next/server";

import type { HubRole } from "@/lib/access";
import { parseRole } from "@/lib/access";
import { getAuthenticatedUser } from "@/lib/auth-request";
import { runBlakeTrainerTurn } from "@/lib/blake-trainer/tutor";
import type { TrainerTurnMode, TrainerTurnRequest } from "@/lib/blake-trainer/types";
import { parseJsonRequestBody } from "@/lib/http";

export const runtime = "nodejs";

type Body = {
  flowId?: string;
  progressId?: string;
  userId?: string;
  userName?: string;
  role?: string;
  mode?: TrainerTurnMode;
  message?: string;
  voice?: boolean;
};

export async function POST(request: Request) {
  const body = await parseJsonRequestBody<Body>(request);
  if (!body?.flowId) {
    return NextResponse.json({ error: "Choose a training flow." }, { status: 400 });
  }

  const user = getAuthenticatedUser(request);
  const role =
    parseRole(body.role)
    || (user?.role as HubRole | undefined)
    || "Engineer";

  const input: TrainerTurnRequest = {
    flowId: body.flowId,
    progressId: body.progressId,
    userId: body.userId || user?.id || "demo-learner",
    userName: body.userName || user?.name || "Learner",
    role,
    mode: body.mode || "continue",
    message: body.message,
    voice: Boolean(body.voice),
  };

  try {
    const result = await runBlakeTrainerTurn(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trainer turn failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

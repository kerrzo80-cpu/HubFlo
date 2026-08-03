import { NextResponse } from "next/server";

import {
  assignTimeCheckGap,
  getOrCreateDailyTimeCheck,
  recordBlakeTimePrompt,
  submitDailyTimeCheck,
  summariseTimeCheck,
  updateTimeCheckLine,
  type TimeCheckGapReason,
} from "@/lib/engineer-time-check-store";
import { parseJsonRequestBody } from "@/lib/http";
import { resolveFieldEngineerId } from "@/lib/field/field-scope";

export const runtime = "nodejs";

/**
 * Field-facing time-check API (same store as /api/engineer/time-check).
 * Keeps Hours working even if engineer routes move.
 */

type TimeCheckAction =
  | {
      action: "prompt";
      payload?: {
        date?: string;
        engineerId?: string;
      };
    }
  | {
      action: "update_line";
      payload: {
        date?: string;
        engineerId?: string;
        scheduleId: string;
        actualStart?: string;
        actualEnd?: string;
        breakMinutes?: number;
        note?: string;
        confirmAsScheduled?: boolean;
      };
    }
  | {
      action: "assign_gap";
      payload: {
        date?: string;
        engineerId?: string;
        hours: number;
        reason: TimeCheckGapReason;
        note?: string;
      };
    }
  | {
      action: "submit";
      payload?: {
        date?: string;
        engineerId?: string;
        confirmRemainingAsScheduled?: boolean;
      };
    };

function withSummary(check: ReturnType<typeof getOrCreateDailyTimeCheck>) {
  return {
    check,
    summary: summariseTimeCheck(check),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? undefined;
  const engineerId = resolveFieldEngineerId(request.headers, url.searchParams.get("engineerId") ?? undefined);
  return NextResponse.json(withSummary(getOrCreateDailyTimeCheck({ date, engineerId })));
}

export async function POST(request: Request) {
  const body = await parseJsonRequestBody<TimeCheckAction>(request);
  if (!body?.action) {
    return NextResponse.json({ error: "Choose a time check action." }, { status: 400 });
  }

  // Always scope reads and writes to the authenticated engineer; never trust a
  // client-supplied engineerId for non-supervisors.
  const scopedEngineerId = resolveFieldEngineerId(request.headers, body.payload?.engineerId);
  if (body.payload) {
    body.payload.engineerId = scopedEngineerId;
  } else if (body.action === "prompt" || body.action === "submit") {
    body.payload = { engineerId: scopedEngineerId };
  }

  try {
    if (body.action === "prompt") {
      return NextResponse.json(withSummary(recordBlakeTimePrompt(body.payload)));
    }

    if (body.action === "update_line") {
      return NextResponse.json(withSummary(updateTimeCheckLine(body.payload)));
    }

    if (body.action === "assign_gap") {
      return NextResponse.json(withSummary(assignTimeCheckGap(body.payload)));
    }

    if (body.action === "submit") {
      return NextResponse.json(withSummary(submitDailyTimeCheck(body.payload)));
    }

    return NextResponse.json({ error: "Unknown time check action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Time check failed." },
      { status: 400 },
    );
  }
}

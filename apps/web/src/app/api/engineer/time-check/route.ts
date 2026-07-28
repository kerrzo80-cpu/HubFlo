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

export const runtime = "nodejs";

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
  const engineerId = url.searchParams.get("engineerId") ?? undefined;
  return NextResponse.json(withSummary(getOrCreateDailyTimeCheck({ date, engineerId })));
}

export async function POST(request: Request) {
  const body = await parseJsonRequestBody<TimeCheckAction>(request);
  if (!body?.action) {
    return NextResponse.json({ error: "Choose a time check action." }, { status: 400 });
  }

  try {
    if (body.action === "prompt") {
      return NextResponse.json(withSummary(recordBlakeTimePrompt(body.payload)));
    }

    if (body.action === "update_line") {
      if (!body.payload?.scheduleId) {
        return NextResponse.json({ error: "Pick a scheduled job to review." }, { status: 400 });
      }
      return NextResponse.json(withSummary(updateTimeCheckLine(body.payload)));
    }

    if (body.action === "assign_gap") {
      if (!body.payload?.reason || !(body.payload.hours > 0)) {
        return NextResponse.json({ error: "Assign gap hours and a reason." }, { status: 400 });
      }
      return NextResponse.json(withSummary(assignTimeCheckGap(body.payload)));
    }

    if (body.action === "submit") {
      return NextResponse.json(withSummary(submitDailyTimeCheck(body.payload)));
    }

    return NextResponse.json({ error: "Unknown time check action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update time check." },
      { status: 400 },
    );
  }
}

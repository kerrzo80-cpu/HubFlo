import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getBoardPackSchedule, saveBoardPackSchedule } from "@/lib/board-pack-schedule";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ schedule: getBoardPackSchedule() });
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showFinance && !access.canCustomize) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    enabled?: boolean;
    to?: string;
    cc?: string;
    weekday?: number;
    hourUtc?: number;
  } | null;

  try {
    const schedule = saveBoardPackSchedule({
      enabled: body?.enabled,
      to: body?.to,
      cc: body?.cc,
      weekday: body?.weekday,
      hourUtc: body?.hourUtc,
    });
    return NextResponse.json({ ok: true, schedule });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save schedule." },
      { status: 400 },
    );
  }
}

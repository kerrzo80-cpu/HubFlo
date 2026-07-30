import { NextResponse } from "next/server";

import { getEngineerSchedule } from "@/lib/engineer-data";
import { withLiveFieldDates } from "@/lib/field/nexa/from-core";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const engineerId = url.searchParams.get("engineerId") ?? undefined;
  const dates = Array.from(
    new Set(withLiveFieldDates(getEngineerSchedule(engineerId)).map((item) => item.date)),
  ).sort();
  return NextResponse.json(dates);
}

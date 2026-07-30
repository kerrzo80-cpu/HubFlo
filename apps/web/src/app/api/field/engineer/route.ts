import { NextResponse } from "next/server";

import { getEngineerSchedule } from "@/lib/engineer-data";
import { engineerProfileFromSchedule, withLiveFieldDates } from "@/lib/field/nexa/from-core";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const engineerId = url.searchParams.get("engineerId") ?? undefined;
  const items = withLiveFieldDates(getEngineerSchedule(engineerId));
  return NextResponse.json(engineerProfileFromSchedule(items, engineerId));
}

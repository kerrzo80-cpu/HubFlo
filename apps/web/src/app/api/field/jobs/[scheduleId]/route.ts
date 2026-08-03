import { NextResponse } from "next/server";

import { getEngineerScheduleItem } from "@/lib/engineer-data";
import { engineerScheduleToFieldItem, withLiveFieldDates } from "@/lib/field/nexa/from-core";

export const runtime = "nodejs";

type Params = { params: Promise<{ scheduleId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { scheduleId } = await params;
  const item = getEngineerScheduleItem(scheduleId);
  if (!item) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  const [live] = withLiveFieldDates([item]);
  return NextResponse.json(engineerScheduleToFieldItem(live ?? item));
}

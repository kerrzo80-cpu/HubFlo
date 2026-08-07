import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { normalizeBusinessBranding } from "@/lib/branding";
import {
  buildRunSheetHtml,
  DEFAULT_TRAVEL_BUFFER_MINUTES,
  findDispatchClashes,
  type DispatchBooking,
} from "@/lib/dispatch";
import { getEngineerSchedule } from "@/lib/engineer-data";
import { resolveFieldEngineerId } from "@/lib/field/field-scope";
import { engineerScheduleToFieldItem, withLiveFieldDates } from "@/lib/field/nexa/from-core";
import { getHubDetailState } from "@/lib/hub-detail-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  void getAccessProfileFromHeaders(request.headers);
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const engineerId = resolveFieldEngineerId(request.headers, url.searchParams.get("engineerId") ?? undefined);
  const buffer = Number(url.searchParams.get("travelBuffer") || DEFAULT_TRAVEL_BUFFER_MINUTES);
  const travelBufferMinutes = Number.isFinite(buffer) ? Math.max(0, Math.min(120, buffer)) : DEFAULT_TRAVEL_BUFFER_MINUTES;
  const format = url.searchParams.get("format") || "html";

  const items = withLiveFieldDates(getEngineerSchedule(engineerId))
    .filter((item) => item.date === date)
    .map(engineerScheduleToFieldItem)
    .sort((a, b) => a.start.localeCompare(b.start));

  const engineerName = items[0]?.engineerName || "Engineer";
  const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);

  const bookings: DispatchBooking[] = items.map((item) => ({
    id: item.scheduleId,
    engineerName: item.engineerName,
    date: item.date,
    start: item.start,
    end: item.end,
    label: item.jobRef,
    customer: item.customer,
    address: item.address,
    jobRef: item.jobRef,
  }));
  const clashes = findDispatchClashes(bookings, travelBufferMinutes);

  if (format === "json") {
    return NextResponse.json({
      engineerName,
      date,
      travelBufferMinutes,
      jobs: items,
      clashes,
    });
  }

  const html = buildRunSheetHtml({
    engineerName,
    date,
    companyName: brand.tradingName || brand.companyName || "EWG",
    travelBufferMinutes,
    jobs: items.map((item) => ({
      start: item.start,
      end: item.end,
      jobRef: item.jobRef,
      customer: item.customer,
      address: item.address,
      description: item.description,
      phone: item.phone,
      costCentre: item.costCentre,
    })),
  });

  const clashBanner =
    clashes.length > 0
      ? `<div class="banner" style="background:#fff1f0;border-color:#d64545;margin-top:12px"><strong>${clashes.length} travel/clash warning(s)</strong><ul>${clashes
          .map((clash) => `<li>${clash.detail}</li>`)
          .join("")}</ul></div>`
      : "";

  return new NextResponse(html.replace("</h1>", `</h1>${clashBanner}`), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

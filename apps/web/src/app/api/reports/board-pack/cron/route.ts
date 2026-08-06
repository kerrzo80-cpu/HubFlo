import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  getBoardPackSchedule,
  markBoardPackSent,
  shouldSendBoardPackNow,
} from "@/lib/board-pack-schedule";
import { normalizeBusinessBranding } from "@/lib/branding";
import { sendEmailMessage } from "@/lib/email-integration-store";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { buildManagerBoardPackRows, buildReportsBoardPackPdf } from "@/lib/reports-board-pack";

export const runtime = "nodejs";
export const maxDuration = 60;

function canRunWithSecret(request: NextRequest) {
  const expected = process.env.NEXA_IMPORT_TICK_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-nexa-import-tick-secret")?.trim();
  return Boolean(provided && provided === expected);
}

function canManage(request: NextRequest) {
  const access = getAccessProfileFromHeaders(request.headers);
  return access.showFinance || access.canCustomize;
}

async function sendBoardPackNow(force = false) {
  const schedule = getBoardPackSchedule();
  if (!force && !shouldSendBoardPackNow()) {
    return { ok: true as const, skipped: true as const, reason: "Not due", schedule };
  }
  if (!schedule.to) {
    throw new Error("Board pack schedule has no recipient.");
  }

  const brand = normalizeBusinessBranding(getHubDetailState().businessSettings);
  const company = brand.tradingName || brand.companyName || "Errol Watson Group";
  const dateLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const pack = buildManagerBoardPackRows();
  const pdf = await buildReportsBoardPackPdf({
    companyName: company,
    title: pack.title,
    dateLabel,
    generatedAt: pack.asAt,
    rows: pack.rows,
  });

  await sendEmailMessage({
    to: schedule.to,
    cc: schedule.cc,
    subject: `${company} board pack · ${dateLabel}`,
    text: [
      `Morning board pack for ${company}.`,
      "",
      "PDF attached. Generated automatically from NeXa Reports.",
      "",
      "Open Core → Reports for live filters.",
    ].join("\n"),
    attachments: [
      {
        filename: `ewg-board-pack-${new Date().toISOString().slice(0, 10)}.pdf`,
        content: Buffer.from(pdf),
        contentType: "application/pdf",
      },
    ],
  });

  const next = markBoardPackSent(true);
  return { ok: true as const, skipped: false as const, schedule: next };
}

export async function POST(request: NextRequest) {
  if (!canManage(request) && !canRunWithSecret(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { force?: boolean } | null;
  try {
    const result = await sendBoardPackNow(Boolean(body?.force));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Board pack send failed.";
    markBoardPackSent(false, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!canManage(request) && !canRunWithSecret(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    schedule: getBoardPackSchedule(),
    dueNow: shouldSendBoardPackNow(),
  });
}

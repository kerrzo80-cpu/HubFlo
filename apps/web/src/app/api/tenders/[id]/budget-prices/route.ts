import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { applyBlakeBudgetPricesToTender, listTenders } from "@/lib/tenders-data";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!(access.canCreateQuote || access.canEditJobs || access.showFinance || access.canCustomize)) {
    return NextResponse.json(
      { error: "Sign in with tender / quote access to run Blake budget prices." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const body = (await parseJsonRequestBody<{ forceRefresh?: boolean; actor?: string }>(request)) || {};

  try {
    const { tender, priced } = await applyBlakeBudgetPricesToTender(id, {
      forceRefresh: Boolean(body.forceRefresh),
    });

    try {
      appendAuditEvent({
        actor: body.actor?.trim() || "NeXa user",
        action: "tender.blake_budget_prices",
        recordType: "tender",
        recordId: tender.id,
        summary: priced.aiUsed
          ? `Blake budget prices · ${priced.blakeFilled} Blake · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`
          : `Guide budget prices · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`,
        source: "tenders",
        importance: "normal",
      });
    } catch {
      // non-blocking
    }

    return NextResponse.json({
      ok: true,
      tender,
      tenders: listTenders(),
      aiUsed: priced.aiUsed,
      connected: priced.connected,
      model: priced.model,
      error: priced.error,
      pricedCount: priced.pricedCount,
      stillOpenCount: priced.stillOpenCount,
      libraryFilled: priced.libraryFilled,
      blakeFilled: priced.blakeFilled,
      leftBlank: priced.leftBlank,
      budgetTotal: priced.budgetTotal,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to apply Blake budget prices" },
      { status: 400 },
    );
  }
}

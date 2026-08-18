import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { applyBlakeBudgetPricesToTender, listTenders } from "@/lib/tenders-data";

export const runtime = "nodejs";
export const maxDuration = 120;

type ProgressEvent = {
  type: "progress";
  stage: "library" | "blake" | "done";
  message: string;
  chunkIndex?: number;
  chunkTotal?: number;
  pricedSoFar?: number;
  openSoFar?: number;
};

function wantsStream(request: NextRequest) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("application/x-ndjson")) return true;
  return request.nextUrl.searchParams.get("stream") === "1";
}

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
  const body =
    (await parseJsonRequestBody<{ forceRefresh?: boolean; actor?: string; lineIds?: string[] }>(request))
    || {};
  const lineIds = Array.isArray(body.lineIds)
    ? body.lineIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  const stream = wantsStream(request);

  if (!stream) {
    try {
      const { tender, priced } = await applyBlakeBudgetPricesToTender(id, {
        forceRefresh: Boolean(body.forceRefresh),
        lineIds,
      });

      try {
        appendAuditEvent({
          actor: body.actor?.trim() || "NeXa user",
          action: "tender.blake_budget_prices",
          recordType: "tender",
          recordId: tender.id,
          summary: priced.aiUsed
            ? `Blake budget prices · ${priced.targetedCount} selected · ${priced.blakeFilled} Blake · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`
            : `Guide budget prices · ${priced.targetedCount} selected · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`,
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
        targetedCount: priced.targetedCount,
        targetedPricedCount: priced.targetedPricedCount,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to apply Blake budget prices" },
        { status: 400 },
      );
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const write = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        write({
          type: "progress",
          stage: "library",
          message: "Matching library…",
        } satisfies ProgressEvent);

        const { tender, priced } = await applyBlakeBudgetPricesToTender(id, {
          forceRefresh: Boolean(body.forceRefresh),
          lineIds,
          signal: request.signal,
          onProgress: (progress) => {
            write({
              type: "progress",
              ...progress,
            } satisfies ProgressEvent);
          },
        });

        try {
          appendAuditEvent({
            actor: body.actor?.trim() || "NeXa user",
            action: "tender.blake_budget_prices",
            recordType: "tender",
            recordId: tender.id,
            summary: priced.aiUsed
              ? `Blake budget prices · ${priced.targetedCount} selected · ${priced.blakeFilled} Blake · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`
              : `Guide budget prices · ${priced.targetedCount} selected · ${priced.libraryFilled} library · ${priced.leftBlank} blank · £${priced.budgetTotal}`,
            source: "tenders",
            importance: "normal",
          });
        } catch {
          // non-blocking
        }

        write({
          type: "result",
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
          targetedCount: priced.targetedCount,
          targetedPricedCount: priced.targetedPricedCount,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to apply Blake budget prices";
        write({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

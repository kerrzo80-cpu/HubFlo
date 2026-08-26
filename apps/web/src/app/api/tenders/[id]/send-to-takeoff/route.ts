import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";
import { sendTenderToTakeoff } from "@/lib/tenders-data";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!(access.canCreateQuote || access.canEditJobs || access.showFinance || access.canCustomize)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await parseJsonRequestBody<{ createNew?: boolean; actor?: string }>(request)) || {};

  try {
    const result = sendTenderToTakeoff(id, { createNew: Boolean(body.createNew) });
    appendAuditEvent({
      actor: body.actor?.trim() || "NeXa user",
      action: result.created ? "created" : "opened",
      recordType: "takeoff",
      recordId: result.takeoff.id,
      summary: result.created
        ? `Takeoff ${result.takeoff.reference} created from tender ${result.tender.name}${
            result.drawingsCopied ? ` · ${result.drawingsCopied} drawing(s) copied` : ""
          }.`
        : `Opened linked takeoff ${result.takeoff.reference} from tender ${result.tender.name}${
            result.drawingsCopied ? ` · ${result.drawingsCopied} new drawing(s) copied` : ""
          }.`,
      source: "tenders",
      importance: "normal",
    });
    return NextResponse.json({
      tender: result.tender,
      takeoff: result.takeoff,
      created: result.created,
      drawingsCopied: result.drawingsCopied,
      href: `/takeoff?projectId=${encodeURIComponent(result.takeoff.id)}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to link takeoff" },
      { status: 400 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { attachMarkedTakeoffDrawingToQuote } from "@/lib/takeoff-data";

type MarkedDrawingPayload = {
  documentId?: string;
  actor?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<MarkedDrawingPayload>(request);
  if (!body?.documentId) {
    return NextResponse.json({ error: "Choose a saved marked drawing first" }, { status: 400 });
  }

  const { id } = await params;
  const actor = body.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  const result = attachMarkedTakeoffDrawingToQuote(id, body.documentId, actor);
  if (!result) {
    return NextResponse.json(
      { error: "Marked drawing saved in Takeoffs, but no linked quote/job could be updated." },
      { status: 409 },
    );
  }

  return NextResponse.json(result);
}

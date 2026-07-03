import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { pushTakeoffProjectToQuote } from "@/lib/takeoff-data";

type PushPayload = {
  quoteId?: string;
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

  const body = await parseJsonRequestBody<PushPayload>(request);
  if (!body?.quoteId) {
    return NextResponse.json({ error: "Choose a quote before pushing Takeoff output" }, { status: 400 });
  }

  const { id } = await params;
  const actor = body.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  const result = pushTakeoffProjectToQuote(id, body.quoteId, actor);

  if (!result) {
    return NextResponse.json(
      { error: "Takeoff project must exist, be approved and link to an existing quote before push" },
      { status: 409 },
    );
  }

  return NextResponse.json(result);
}

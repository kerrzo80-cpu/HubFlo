import { NextRequest, NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { pushQuoteToSimpro } from "@/lib/simpro-bridge";

type SimproPushRequest = {
  actor?: string;
  costCentres?: unknown;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<SimproPushRequest>(request);
  const { id } = await params;
  const result = await pushQuoteToSimpro(id, {
    actor: body?.actor,
    costCentres: body?.costCentres,
  });

  if (!result) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const status = result.exportRecord.status === "Failed" ? 502 : 200;
  return NextResponse.json(result, { status });
}

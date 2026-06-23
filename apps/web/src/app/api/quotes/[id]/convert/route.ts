import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { convertQuoteToJob } from "@/lib/workflow-data";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateJob || !access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await parseJsonRequestBody<{
    actor?: string;
    chargeValue?: number;
  }>(request)) || {};
  const result = convertQuoteToJob(id, payload.actor || "HubFlo user", payload.chargeValue);

  if (!result) {
    return NextResponse.json(
      { error: "Quote must be accepted and not already converted" },
      { status: 409 },
    );
  }

  return NextResponse.json(result, { status: 201 });
}

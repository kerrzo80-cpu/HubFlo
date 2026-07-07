import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { pushSurveyProjectToQuote } from "@/lib/takeoff-data";

type SurveyPushPayload = {
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

  const body = await parseJsonRequestBody<SurveyPushPayload>(request);
  if (!body?.quoteId) {
    return NextResponse.json({ error: "Search and select the NeXa quote before pushing this survey." }, { status: 400 });
  }

  const { id } = await params;
  const actor = body.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Survey";
  const result = pushSurveyProjectToQuote(id, body.quoteId, actor);

  if (!result) {
    return NextResponse.json(
      { error: "Survey or quote not found. Open the survey, link the quote, then push again." },
      { status: 409 },
    );
  }

  return NextResponse.json(result);
}

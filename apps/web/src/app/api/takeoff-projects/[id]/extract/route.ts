import { NextRequest, NextResponse } from "next/server";

import { employeeHeaderName, getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { runTakeoffDraftExtraction } from "@/lib/takeoff-data";

type ExtractPayload = {
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

  const body = await parseJsonRequestBody<ExtractPayload>(request);
  const { id } = await params;
  const actor = body?.actor?.trim() || request.headers.get(employeeHeaderName) || "NeXa Takeoff";
  const result = runTakeoffDraftExtraction(id, actor);

  if (!result) {
    return NextResponse.json({ error: "Takeoff project not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}

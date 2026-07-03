import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showQuotes && !access.showJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = getTakeoffOpenAiConfig();

  return NextResponse.json({
    connected: config.connected,
    model: config.model,
    source: config.source,
    updatedAt: config.updatedAt,
    keyName: "OPENAI_API_KEY",
  });
}

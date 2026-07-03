import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { saveTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

type SaveOpenAiConfigPayload = {
  apiKey?: string;
  model?: string;
};

function looksLikeOpenAiKey(value: string) {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<SaveOpenAiConfigPayload>(request);
  const apiKey = payload?.apiKey?.trim() ?? "";
  const model = payload?.model?.trim() || "gpt-5.5";

  if (!looksLikeOpenAiKey(apiKey)) {
    return NextResponse.json({ error: "Paste a valid OpenAI API key starting with sk-." }, { status: 400 });
  }

  const saved = saveTakeoffOpenAiConfig(apiKey, model);
  return NextResponse.json({
    connected: saved.connected,
    model: saved.model,
    source: saved.source,
    updatedAt: saved.updatedAt,
    keyName: "OPENAI_API_KEY",
  });
}

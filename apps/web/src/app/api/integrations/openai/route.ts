import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { openAiApiKeyEnvName, openAiKeySource, resolveOpenAiApiKey } from "@/lib/openai-env";
import {
  DEFAULT_OPENAI_MODEL,
  clearStoredOpenAiConfig,
  getStoredOpenAiConfig,
  saveStoredOpenAiConfig,
} from "@/lib/openai-key-store";

export const runtime = "nodejs";

type SaveOpenAiPayload = {
  apiKey?: string;
  model?: string;
};

function looksLikeOpenAiKey(value: string) {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

function status() {
  const stored = getStoredOpenAiConfig();
  const source = openAiKeySource();
  return {
    connected: Boolean(resolveOpenAiApiKey()),
    source,
    model: stored.model?.trim() || DEFAULT_OPENAI_MODEL,
    updatedAt: stored.updatedAt,
    envKeyName: openAiApiKeyEnvName(),
    // Never return the key itself; only whether an in-app key is saved.
    hasInAppKey: source === "in-app",
  };
}

export async function GET() {
  return NextResponse.json(status());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<SaveOpenAiPayload>(request);
  const apiKey = payload?.apiKey?.trim() ?? "";
  const model = payload?.model?.trim() || DEFAULT_OPENAI_MODEL;

  if (!looksLikeOpenAiKey(apiKey)) {
    return NextResponse.json({ error: "Paste a valid OpenAI API key (starts with sk-)." }, { status: 400 });
  }

  saveStoredOpenAiConfig(apiKey, model);
  return NextResponse.json(status());
}

export async function DELETE(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  clearStoredOpenAiConfig();
  return NextResponse.json(status());
}

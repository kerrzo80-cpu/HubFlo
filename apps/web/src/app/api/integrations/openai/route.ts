import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { openAiApiKeyEnvName, openAiKeySource, resolveOpenAiApiKey } from "@/lib/openai-env";
import {
  DEFAULT_OPENAI_MODEL,
  clearStoredOpenAiConfig,
  getStoredOpenAiConfig,
  saveStoredOpenAiConfig,
  saveStoredOpenAiModel,
} from "@/lib/openai-key-store";
import { requireEnvSecretsOnly } from "@/lib/runtime-security";
import { listAiModelConfig } from "@/lib/ai-model-config";

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
    requireEnvSecrets: requireEnvSecretsOnly(),
    workloads: listAiModelConfig(),
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

  if (requireEnvSecretsOnly()) {
    if (apiKey) {
      return NextResponse.json(
        {
          error:
            "OpenAI keys cannot be stored in NeXa on live/production. Set OPENAI_API_KEY or NEXA_OPENAI_API_KEY in host secrets (Render / AWS Secrets Manager).",
        },
        { status: 400 },
      );
    }
    saveStoredOpenAiModel(model);
    return NextResponse.json(status());
  }

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

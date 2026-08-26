import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { openAiKeySource, resolveOpenAiApiKey } from "@/lib/openai-env";
import { DEFAULT_OPENAI_MODEL, getStoredOpenAiConfig } from "@/lib/openai-key-store";
import { openAiFetch } from "@/lib/openai-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Lightweight OpenAI key ops check — lists models with a short timeout.
 * Never returns the key.
 */
export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCustomize && !access.canCreateQuote) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const apiKey = resolveOpenAiApiKey();
  const source = openAiKeySource();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        source,
        error: "No OpenAI key configured (env or Core Setup).",
      },
      { status: 422 },
    );
  }

  const model = getStoredOpenAiConfig().model?.trim() || DEFAULT_OPENAI_MODEL;
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await openAiFetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const ms = Date.now() - started;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          connected: true,
          source,
          model,
          status: response.status,
          ms,
          error: text.slice(0, 240) || `OpenAI returned ${response.status}`,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      connected: true,
      source,
      model,
      ms,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        connected: true,
        source,
        model,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "OpenAI smoke failed",
      },
      { status: 502 },
    );
  }
}

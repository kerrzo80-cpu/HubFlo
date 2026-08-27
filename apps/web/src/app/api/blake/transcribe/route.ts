import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { recordBlakeAiDirectCost } from "@/lib/blake-ai-usage";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { openAiFetch, OPENAI_LONG_TIMEOUT_MS } from "@/lib/openai-fetch";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const GPT_TRANSCRIBE_USD_PER_MINUTE = 0.0045;

function canUseAyla(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
}

function safeDurationMs(value: FormDataEntryValue | null) {
  const parsed = Number(typeof value === "string" ? value : "");
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, 120_000));
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canUseAyla(access)) {
    return NextResponse.json({ error: "Your role cannot use Ayla voice." }, { status: 403 });
  }

  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI is not connected for Ayla transcription." }, { status: 503 });
  }

  const body = await request.formData().catch(() => null);
  const audio = body?.get("audio");
  const durationMs = safeDurationMs(body?.get("durationMs") ?? null);
  if (!(audio instanceof File) || audio.size <= 0) {
    return NextResponse.json({ error: "No voice recording was received." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "That voice turn is too large. Keep each turn under two minutes." }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "ayla-turn.webm");
  upstream.append("model", process.env.BLAKE_TRANSCRIBE_MODEL?.trim() || "gpt-transcribe");
  upstream.append("language", "en");
  upstream.append(
    "prompt",
    "UK trade business conversation. Common terms include Blake, Ayla, simPRO, work area, cost centre, tender, valuation, invoice, job, quote, lead, boiler, radiator, cylinder, ASHP, UFH, Gas Safe, Aberdeen and Aberdeenshire.",
  );
  upstream.append("response_format", "json");

  const response = await openAiFetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upstream,
  }, OPENAI_LONG_TIMEOUT_MS);

  const raw = await response.text();
  let payload: { text?: string; error?: { message?: string } } = {};
  try {
    payload = raw ? JSON.parse(raw) as typeof payload : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: payload.error?.message || `Ayla transcription failed (${response.status}).` },
      { status: response.status },
    );
  }

  const text = payload.text?.trim() || "";
  if (durationMs > 0) {
    recordBlakeAiDirectCost({
      model: "gpt-transcribe",
      estimatedCostUsd: (durationMs / 60_000) * GPT_TRANSCRIBE_USD_PER_MINUTE,
    });
  }

  return NextResponse.json({
    text,
    durationMs,
    estimatedCostUsd: durationMs > 0 ? (durationMs / 60_000) * GPT_TRANSCRIBE_USD_PER_MINUTE : null,
  });
}

import { NextResponse } from "next/server";

import {
  buildRealtimeInstructions,
  normaliseBlakeVoiceAccent,
  openaiVoiceForAccent,
  type BlakeVoiceAccent,
} from "@/lib/field/ask-blake-voice-accent";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

type SessionBody = {
  accent?: BlakeVoiceAccent | string;
};

/**
 * Mint an ephemeral Realtime client secret for Talk (browser WebRTC).
 * Never expose the long-lived OPENAI_API_KEY to the phone.
 */
export async function POST(request: Request) {
  const config = getTakeoffOpenAiConfig();
  if (!config.apiKey) {
    return NextResponse.json(
      { error: "OpenAI isn’t connected — set OPENAI_API_KEY on Render for Talk Lab." },
      { status: 503 },
    );
  }

  const body = (await parseJsonRequestBody<SessionBody>(request)) ?? {};
  const accent = normaliseBlakeVoiceAccent(body.accent);
  const voice = openaiVoiceForAccent(accent);
  const instructions = buildRealtimeInstructions(accent);

  const sessionConfig = {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions,
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice,
        },
      },
    },
  };

  async function mint(model: string, outputVoice: string) {
    const payload = {
      ...sessionConfig,
      session: {
        ...sessionConfig.session,
        model,
        audio: {
          ...sessionConfig.session.audio,
          output: { voice: outputVoice },
        },
      },
    };
    return fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  let response = await mint("gpt-realtime", voice);
  if (!response.ok) response = await mint("gpt-realtime-mini", voice);
  if (!response.ok) response = await mint("gpt-4o-realtime-preview", voice);

  let raw = await response.text();
  let payload: { value?: string; error?: { message?: string } } = {};
  try {
    payload = raw ? JSON.parse(raw) as typeof payload : {};
  } catch {
    payload = {};
  }

  // Newer voices (cedar/verse) may fail on older preview models — fall back to ash.
  let usedVoice = voice;
  if ((!response.ok || !payload.value) && voice !== "ash") {
    response = await mint("gpt-realtime", "ash");
    if (!response.ok) response = await mint("gpt-realtime-mini", "ash");
    raw = await response.text();
    try {
      payload = raw ? JSON.parse(raw) as typeof payload : {};
    } catch {
      payload = {};
    }
    if (response.ok && payload.value) usedVoice = "ash";
  }

  if (!response.ok || !payload.value) {
    return NextResponse.json(
      {
        error: payload.error?.message
          || `Realtime session failed (${response.status}). Check the OpenAI key supports Realtime.`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    clientSecret: payload.value,
    build: "realtime-voice-picker-v1",
    accent,
    voice: usedVoice,
  });
}

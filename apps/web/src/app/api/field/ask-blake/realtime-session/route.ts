import { NextResponse } from "next/server";

import { askBlakeDeveloperPrompt, ASK_BLAKE_SCOTTISH_VOICE_INSTRUCTIONS } from "@/lib/field/ask-blake";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

/**
 * Mint an ephemeral Realtime client secret for Talk Lab (browser WebRTC).
 * Never expose the long-lived OPENAI_API_KEY to the phone.
 */
export async function POST() {
  const config = getTakeoffOpenAiConfig();
  if (!config.apiKey) {
    return NextResponse.json(
      { error: "OpenAI isn’t connected — set OPENAI_API_KEY on Render for Talk Lab." },
      { status: 503 },
    );
  }

  const instructions = [
    askBlakeDeveloperPrompt("voice"),
    "",
    ASK_BLAKE_SCOTTISH_VOICE_INSTRUCTIONS,
    "You are in a live hands-free voice call with a UK plumber/heating engineer on site.",
    "They may also share live camera frames of the job — use what you can see.",
    "Speak with your Scottish accent on every reply. Brief and clear. One question at a time when you need more detail.",
    "Do not give DIY homeowner lectures. Peer-to-peer trade talk only.",
  ].join("\n");

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
          voice: "ash",
        },
      },
    },
  };

  async function mint(model: string) {
    const body = {
      ...sessionConfig,
      session: {
        ...sessionConfig.session,
        model,
      },
    };
    return fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  let response = await mint("gpt-realtime");
  if (!response.ok) response = await mint("gpt-realtime-mini");
  if (!response.ok) response = await mint("gpt-4o-realtime-preview");

  const raw = await response.text();
  let payload: { value?: string; error?: { message?: string } } = {};
  try {
    payload = raw ? JSON.parse(raw) as typeof payload : {};
  } catch {
    return NextResponse.json({ error: "Bad Realtime token response." }, { status: 502 });
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
    build: "realtime-scottish-v1",
  });
}

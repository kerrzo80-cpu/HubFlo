import { NextResponse } from "next/server";

import { ASK_BLAKE_SCOTTISH_VOICE_INSTRUCTIONS } from "@/lib/field/ask-blake";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

/**
 * Short Realtime prompt — long system dumps make Realtime drop the accent
 * and fall back to American while still sprinkling Scots words.
 */
export const ASK_BLAKE_REALTIME_INSTRUCTIONS = [
  "VOICE (non-negotiable): Speak every word in a clear Scottish accent — north-east Scotland / Aberdeenshire.",
  "Do NOT use an American accent. Do NOT use General American vowels or US intonation.",
  "Sound like a Scottish plumber talking on site: warm, male, plain English — not comedy, not slang stuffing.",
  "Say normal UK English words with Scottish pronunciation. Avoid forcing ‘aye/wee’ into every sentence.",
  "",
  ASK_BLAKE_SCOTTISH_VOICE_INSTRUCTIONS,
  "",
  "Role: Ask Blake — on-site co-pilot for UK plumbers / heating engineers / joiners.",
  "Peer-to-peer. Brief answers (about 20–60 spoken words). One follow-up question max.",
  "No DIY lectures, no tool shopping lists, no ‘call a professional’ padding.",
  "If live camera frames arrive, use what you can see with what they’re saying.",
].join("\n");

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

  // cedar follows accent instructions more reliably than ash (which defaults American).
  const voice = "cedar";

  const sessionConfig = {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions: ASK_BLAKE_REALTIME_INSTRUCTIONS,
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
    // cedar may be unavailable on older preview models — retry once with ash + same Scottish instructions.
    if (voice === "cedar") {
      const fallbackBody = {
        session: {
          ...sessionConfig.session,
          model: "gpt-realtime",
          audio: {
            ...sessionConfig.session.audio,
            output: { voice: "ash" },
          },
        },
      };
      const fallback = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(fallbackBody),
      });
      const fallbackRaw = await fallback.text();
      try {
        payload = fallbackRaw ? JSON.parse(fallbackRaw) as typeof payload : {};
      } catch {
        payload = {};
      }
      if (fallback.ok && payload.value) {
        return NextResponse.json({
          clientSecret: payload.value,
          build: "realtime-scottish-v2",
          voice: "ash",
        });
      }
    }

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
    build: "realtime-scottish-v2",
    voice,
  });
}

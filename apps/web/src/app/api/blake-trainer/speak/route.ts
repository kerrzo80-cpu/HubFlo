import { NextResponse } from "next/server";

import {
  accentTtsInstructions,
  normaliseBlakeVoiceAccent,
  openaiVoiceForAccent,
  type BlakeVoiceAccent,
} from "@/lib/field/ask-blake-voice-accent";
import { cleanForSpeech } from "@/lib/field/ask-blake-speech";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import { openAiFetch } from "@/lib/openai-fetch";

export const runtime = "nodejs";

type SpeakBody = {
  text?: string;
  accent?: BlakeVoiceAccent | string;
};

/** Trainer TTS — same OpenAI path as Field, kept under /api/blake-trainer for session cookies. */
export async function POST(request: Request) {
  const body = await parseJsonRequestBody<SpeakBody>(request);
  const text = cleanForSpeech(body?.text ?? "");
  if (!text) return NextResponse.json({ error: "Nothing to speak." }, { status: 400 });

  const config = getTakeoffOpenAiConfig();
  if (!config.apiKey) {
    return NextResponse.json({ error: "OpenAI voice is not connected." }, { status: 503 });
  }

  const accent = normaliseBlakeVoiceAccent(body?.accent ?? "scottish");
  const preferredVoice = openaiVoiceForAccent(accent);
  const instructions = accentTtsInstructions(accent);

  async function synth(model: string, voice: string, withInstructions: boolean) {
    return openAiFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: text.slice(0, 1800),
        response_format: "mp3",
        ...(withInstructions ? { instructions } : {}),
      }),
    });
  }

  let response = await synth("gpt-4o-mini-tts", preferredVoice, true);
  if (!response.ok && preferredVoice !== "ash") {
    response = await synth("gpt-4o-mini-tts", "ash", true);
  }
  if (!response.ok) response = await synth("gpt-4o-mini-tts", "ash", false);
  if (!response.ok) response = await synth("tts-1", "onyx", false);
  if (!response.ok) {
    return NextResponse.json({ error: `OpenAI speech failed (${response.status}).` }, { status: 502 });
  }

  const audio = await response.arrayBuffer();
  return new NextResponse(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

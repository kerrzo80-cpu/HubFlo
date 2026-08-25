import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import {
  accentPromptBlock,
  normaliseBlakeVoiceAccent,
  openaiVoiceForAccent,
  type BlakeVoiceAccent,
} from "@/lib/field/ask-blake-voice-accent";
import { parseJsonRequestBody } from "@/lib/http";
import { resolveOpenAiApiKey } from "@/lib/openai-env";
import { openAiFetch } from "@/lib/openai-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

type SessionBody = {
  accent?: BlakeVoiceAccent | string;
};

function canUseBlake(access: ReturnType<typeof getAccessProfileFromHeaders>) {
  return access.showSchedule || access.showQuotes || access.showJobs || access.canCustomize || access.showFinance;
}

function drivingInstructions(accent: BlakeVoiceAccent) {
  return [
    accentPromptBlock(accent),
    "",
    "You are the low-latency voice layer for Blake inside NeXa Driving Mode.",
    "The NeXa Blake orchestrator is the business brain. You do not independently answer business questions from memory.",
    "Automatic model responses are disabled. The client sends you an approved Blake text response after each completed user turn.",
    "When asked to speak supplied Blake text, preserve the facts, references, figures, names, dates and confirmation wording exactly.",
    "Sound natural and conversational, not like you are reading a report. Keep lists easy to follow while driving.",
    "Do not add facts that are not present in the supplied Blake response.",
  ].join("\n");
}

async function mintClientSecret(apiKey: string, model: string, voice: string, instructions: string) {
  return openAiFetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            noise_reduction: { type: "far_field" },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "en",
              prompt: "UK trade business conversation. Common terms include NeXa, Blake, simPRO, Work Areas, Cost Centres, tenders, valuations, invoices, jobs, quotes, leads, and references like J-1007 or Q-1007.",
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: false,
              interrupt_response: true,
            },
          },
          output: {
            voice,
            speed: 1.05,
          },
        },
      },
    }),
  });
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!canUseBlake(access)) {
    return NextResponse.json({ error: "Your role cannot use Blake Driving Mode." }, { status: 403 });
  }

  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI is not connected for Blake Driving Mode." }, { status: 503 });
  }

  const body = (await parseJsonRequestBody<SessionBody>(request)) ?? {};
  const accent = normaliseBlakeVoiceAccent(body.accent);
  const requestedVoice = openaiVoiceForAccent(accent);
  const instructions = drivingInstructions(accent);
  const configuredModel = process.env.BLAKE_REALTIME_MODEL?.trim() || "gpt-realtime-mini";
  const models = [...new Set([configuredModel, "gpt-realtime-mini", "gpt-realtime"])];
  const voices = [...new Set([requestedVoice, "cedar", "ash"])];

  let lastError = "Realtime session could not be created.";
  for (const model of models) {
    for (const voice of voices) {
      const response = await mintClientSecret(apiKey, model, voice, instructions);
      const raw = await response.text();
      let payload: { value?: string; expires_at?: number; error?: { message?: string } } = {};
      try {
        payload = raw ? JSON.parse(raw) as typeof payload : {};
      } catch {
        payload = {};
      }
      if (response.ok && payload.value) {
        return NextResponse.json({
          clientSecret: payload.value,
          expiresAt: payload.expires_at ?? null,
          model,
          voice,
          accent,
          build: "blake-driving-v1",
        });
      }
      lastError = payload.error?.message || `Realtime session failed (${response.status}).`;
    }
  }

  return NextResponse.json({ error: lastError }, { status: 502 });
}

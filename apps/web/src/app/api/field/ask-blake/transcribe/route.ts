import { NextResponse } from "next/server";

import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const config = getTakeoffOpenAiConfig();
  if (!config.apiKey) {
    return NextResponse.json({ error: "OpenAI listening is not connected." }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read audio." }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: "No audio received." }, { status: 400 });
  }
  const blob = audio as Blob;
  if (blob.size < 200) {
    return NextResponse.json({ error: "That clip was empty — try again closer to the mic." }, { status: 400 });
  }
  if (blob.size > MAX_BYTES) {
    return NextResponse.json({ error: "That clip was too long — keep it under 30 seconds." }, { status: 413 });
  }

  const type = (blob.type || "audio/webm").split(";")[0] || "audio/webm";
  const extension =
    type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "m4a"
      : type.includes("mpeg") || type.includes("mp3") ? "mp3"
        : type.includes("wav") ? "wav"
          : type.includes("ogg") ? "ogg"
            : "webm";

  const filename = `blake-voice.${extension}`;
  const file = new File([blob], filename, { type });

  async function transcribe(model: string) {
    const body = new FormData();
    body.append("file", file, filename);
    body.append("model", model);
    body.append("language", "en");
    body.append(
      "prompt",
      "UK plumbing and heating engineer talking on a job site about boilers, radiators, leaks, valves, pumps, and pipework.",
    );
    return fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body,
    });
  }

  let response = await transcribe("gpt-4o-mini-transcribe");
  if (!response.ok) response = await transcribe("whisper-1");
  if (!response.ok) {
    return NextResponse.json(
      { error: `Couldn’t hear that clearly (${response.status}). Try again.` },
      { status: 502 },
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { text?: string };
  const text = payload.text?.trim() ?? "";
  if (!text) {
    return NextResponse.json({ error: "Didn’t catch any words — speak a bit louder and try again." }, { status: 422 });
  }

  return NextResponse.json({ text });
}

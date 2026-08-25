import { NextResponse } from "next/server";

import {
  askBlakeDeveloperPrompt,
  buildAskBlakeFallback,
  buildAskBlakeUserPayload,
  getOutputText,
  normaliseAskBlakeImages,
  type AskBlakeRequest,
} from "@/lib/field/ask-blake";
import { parseJsonRequestBody } from "@/lib/http";
import { getTakeoffOpenAiConfig } from "@/lib/takeoff-ai-config";
import { openAiFetch } from "@/lib/openai-fetch";

export const runtime = "nodejs";

/** Fast models for on-site Field replies — avoid heavy defaults that time out on photos. */
const FIELD_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"] as const;

async function runOpenAi(input: AskBlakeRequest, apiKey: string, preferredModel: string) {
  const images = normaliseAskBlakeImages(input)
    .filter((image) => image.length <= 900_000)
    .slice(0, 3);
  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" | "auto" | "high" }
  > = [{ type: "input_text", text: buildAskBlakeUserPayload(input) }];

  for (const image of images) {
    userContent.push({
      type: "input_image",
      image_url: image,
      detail: images.length > 1 ? "low" : "auto",
    });
  }

  const models = [preferredModel, ...FIELD_MODELS].filter(
    (model, index, list) => Boolean(model) && list.indexOf(model) === index,
  );

  let lastError: Error | null = null;
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 28_000);
    try {
      const response = await openAiFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input: [
            {
              role: "developer",
              content: [{ type: "input_text", text: askBlakeDeveloperPrompt(input.mode) }],
            },
            {
              role: "user",
              content: userContent,
            },
          ],
        }),
      });

      if (!response.ok) {
        lastError = new Error(`OpenAI returned ${response.status} for ${model}.`);
        if (response.status === 401 || response.status === 403) throw lastError;
        continue;
      }
      const output = getOutputText(await response.json());
      if (!output) {
        lastError = new Error("OpenAI did not return a reply.");
        continue;
      }
      return { reply: output, model };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error(`OpenAI timed out on ${model}.`);
        continue;
      }
      lastError = error instanceof Error ? error : new Error("OpenAI request failed.");
      if (lastError.message.includes("401") || lastError.message.includes("403")) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("OpenAI could not reply.");
}

export async function GET() {
  const config = getTakeoffOpenAiConfig();
  return NextResponse.json({
    ok: true,
    connected: config.connected,
    source: config.source,
    model: config.model,
    keyName: config.keyName,
    talk: {
      whisper: config.connected,
      browserSpeech: true,
      speak: config.connected,
    },
  });
}

export async function POST(request: Request) {
  const body = await parseJsonRequestBody<AskBlakeRequest>(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const message = body.message?.trim();
  const images = normaliseAskBlakeImages(body);
  if (!message && !images.length) {
    return NextResponse.json({ error: "Ask Blake a question or attach a photo." }, { status: 400 });
  }

  const mode = body.mode === "voice" ? "voice" : "text";
  const input: AskBlakeRequest = {
    message: message || (images.length > 1
      ? "What do you see in these photos, and what should I check next?"
      : "What do you see in this photo, and what should I check next?"),
    imageDataUrls: images,
    history: Array.isArray(body.history) ? body.history.slice(-12) : [],
    job: body.job ?? null,
    mode,
  };

  const config = getTakeoffOpenAiConfig();
  if (!config.apiKey) {
    return NextResponse.json({
      reply: buildAskBlakeFallback(input),
      provider: "fallback",
      warning: "OpenAI is not connected on this pilot — Blake replied with field fallback guidance.",
    });
  }

  try {
    const result = await runOpenAi(input, config.apiKey, config.model);
    return NextResponse.json({ reply: result.reply, provider: "OpenAI", model: result.model });
  } catch (error) {
    return NextResponse.json({
      reply: buildAskBlakeFallback(input),
      provider: "fallback",
      warning: error instanceof Error ? error.message : "Ask Blake could not reach OpenAI.",
    });
  }
}

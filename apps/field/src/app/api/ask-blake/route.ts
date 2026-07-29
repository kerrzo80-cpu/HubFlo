import { NextResponse } from "next/server";

import {
  ASK_BLAKE_SYSTEM_PROMPT,
  buildAskBlakeFallback,
  buildAskBlakeUserPayload,
  getOutputText,
  type AskBlakeRequest,
} from "@/lib/ask-blake";

export const runtime = "nodejs";

async function parseJsonRequestBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const model = process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim()
    || "gpt-5.5";
  return { apiKey, model };
}

async function runOpenAi(input: AskBlakeRequest, apiKey: string, model: string) {
  const image = input.imageDataUrl?.startsWith("data:image/") ? input.imageDataUrl : undefined;
  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{ type: "input_text", text: buildAskBlakeUserPayload(input) }];

  if (image) {
    userContent.push({ type: "input_image", image_url: image, detail: "high" });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: ASK_BLAKE_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI returned ${response.status}.`);
  const output = getOutputText(await response.json());
  if (!output) throw new Error("OpenAI did not return a reply.");
  return output;
}

export async function POST(request: Request) {
  const body = await parseJsonRequestBody<AskBlakeRequest>(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const message = body.message?.trim();
  if (!message && !body.imageDataUrl) {
    return NextResponse.json({ error: "Ask Blake a question or attach a photo." }, { status: 400 });
  }

  const input: AskBlakeRequest = {
    message: message || "What do you see in this photo, and what should I check next?",
    imageDataUrl: body.imageDataUrl,
    history: Array.isArray(body.history) ? body.history.slice(-12) : [],
    job: body.job ?? null,
  };

  const config = getOpenAiConfig();
  if (!config.apiKey) {
    return NextResponse.json({
      reply: buildAskBlakeFallback(input),
      provider: "fallback",
      warning: "OpenAI is not connected on this pilot — Blake replied with field fallback guidance.",
    });
  }

  try {
    const reply = await runOpenAi(input, config.apiKey, config.model);
    return NextResponse.json({ reply, provider: "OpenAI", model: config.model });
  } catch (error) {
    return NextResponse.json({
      reply: buildAskBlakeFallback(input),
      provider: "fallback",
      warning: error instanceof Error ? error.message : "Ask Blake could not reach OpenAI.",
    });
  }
}

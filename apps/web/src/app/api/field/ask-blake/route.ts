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
import { resolveTenantOpenAiApiKey } from "@/lib/tenancy/tenant-ai";
import { withTenantFromRequest } from "@/lib/tenancy/with-tenant-request";

export const runtime = "nodejs";

/** Fast models for on-site Field replies — avoid heavy defaults that time out on photos. */
const FIELD_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1"] as const;

async function runOpenAi(
  input: AskBlakeRequest,
  apiKey: string,
  preferredModel: string,
  promptOptions: {
    assistantName?: string;
    companyName?: string;
    tone?: string;
    instructions?: string;
    tradeType?: string;
  },
) {
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
      const response = await fetch("https://api.openai.com/v1/responses", {
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
              content: [{ type: "input_text", text: askBlakeDeveloperPrompt(input.mode, promptOptions) }],
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

export async function GET(request: Request) {
  try {
    return await withTenantFromRequest(request, async (tenant) => {
      const ai = resolveTenantOpenAiApiKey(tenant.id);
      return NextResponse.json({
        ok: true,
        connected: Boolean(ai.apiKey) && ai.settings.enabled,
        source: ai.source,
        model: ai.model,
        assistantName: ai.settings.assistantName,
        tenantId: tenant.id,
        enabled: ai.settings.enabled && tenant.enabledModules.includes("ask-blake"),
        talk: {
          whisper: Boolean(ai.apiKey),
          browserSpeech: true,
          speak: Boolean(ai.apiKey),
        },
      });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Ask Blake status." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    return await withTenantFromRequest(request, async (tenant) => {
      if (!tenant.enabledModules.includes("ask-blake")) {
        return NextResponse.json({ error: "Ask Blake is not enabled for this company." }, { status: 403 });
      }

      const body = await parseJsonRequestBody<AskBlakeRequest>(request);
      if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

      const message = body.message?.trim();
      const images = normaliseAskBlakeImages(body);
      if (!message && !images.length) {
        return NextResponse.json({ error: "Ask Blake a question or attach a photo." }, { status: 400 });
      }

      const ai = resolveTenantOpenAiApiKey(tenant.id);
      if (!ai.settings.enabled) {
        return NextResponse.json({ error: "Ask Blake is disabled for this company." }, { status: 403 });
      }
      if (!ai.settings.permissions.canAnswerTrade) {
        return NextResponse.json({ error: "Trade answers are not permitted for this company." }, { status: 403 });
      }

      const mode = body.mode === "voice" ? "voice" : "text";
      const input: AskBlakeRequest = {
        message:
          message ||
          (images.length > 1
            ? "What do you see in these photos, and what should I check next?"
            : "What do you see in this photo, and what should I check next?"),
        imageDataUrls: images,
        history: Array.isArray(body.history) ? body.history.slice(-12) : [],
        job: ai.settings.permissions.canUseJobContext ? body.job ?? null : null,
        mode,
      };

      const promptOptions = {
        assistantName: ai.settings.assistantName,
        companyName: tenant.branding.tradingName || tenant.name,
        tone: ai.settings.tone,
        instructions: ai.settings.instructions,
        tradeType: ai.settings.tradeType,
      };

      if (!ai.apiKey) {
        return NextResponse.json({
          reply: buildAskBlakeFallback(input),
          provider: "fallback",
          warning: "OpenAI is not connected — Blake replied with field fallback guidance.",
          tenantId: tenant.id,
          keySource: ai.source,
        });
      }

      try {
        const result = await runOpenAi(input, ai.apiKey, ai.model, promptOptions);
        return NextResponse.json({
          reply: result.reply,
          provider: "OpenAI",
          model: result.model,
          tenantId: tenant.id,
          keySource: ai.source,
        });
      } catch (error) {
        return NextResponse.json({
          reply: buildAskBlakeFallback(input),
          provider: "fallback",
          warning: error instanceof Error ? error.message : "Ask Blake could not reach OpenAI.",
          tenantId: tenant.id,
          keySource: ai.source,
        });
      }
    });
  } catch (error) {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status: number }).status)
        : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ask Blake failed." },
      { status: status || 500 },
    );
  }
}

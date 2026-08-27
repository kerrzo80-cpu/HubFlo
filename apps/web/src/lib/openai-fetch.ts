import { extractOpenAiUsage, getBlakeAiSpendGuard, recordBlakeAiUsage } from "@/lib/blake-ai-usage";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

/** Default cap for most OpenAI Responses / chat calls. */
export const OPENAI_DEFAULT_TIMEOUT_MS = 60_000;

/** Longer budget for takeoff extract / multi-file vision. */
export const OPENAI_LONG_TIMEOUT_MS = 120_000;

/** Short budget for Field Ask Blake interactive paths. */
export const OPENAI_FIELD_TIMEOUT_MS = 28_000;

function requestedModel(init?: RequestInit) {
  if (typeof init?.body !== "string") return undefined;
  try {
    const body = JSON.parse(init.body) as { model?: unknown };
    return typeof body.model === "string" ? body.model : undefined;
  } catch {
    return undefined;
  }
}

function isOpenAiRequest(url: string) {
  try {
    return new URL(url).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

/**
 * Server-side fetch to OpenAI with a hard timeout so hung calls cannot pin
 * Render/AWS memory indefinitely. OpenAI JSON calls are also metered here so
 * Ayla's usage guard applies consistently to chat, survey and takeoff AI.
 */
export async function openAiFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = OPENAI_DEFAULT_TIMEOUT_MS,
) {
  const meter = isOpenAiRequest(url);
  if (meter) {
    const guard = getBlakeAiSpendGuard();
    if (guard.limitReached) {
      return new Response(JSON.stringify({
        error: {
          message: `Blake AI monthly spend limit reached (${guard.estimatedCostUsd.toFixed(2)} USD of ${guard.limitUsd?.toFixed(2)} USD). Increase the configured limit to resume AI calls.`,
          type: "blake_ai_spend_limit",
        },
      }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const response = await fetchWithTimeout(url, init, timeoutMs);
  if (meter && response.ok) {
    try {
      const body = await response.clone().json();
      const usage = extractOpenAiUsage(body, requestedModel(init));
      if (usage) recordBlakeAiUsage(usage);
    } catch {
      // Usage metering must never break an otherwise successful AI response.
    }
  }
  return response;
}

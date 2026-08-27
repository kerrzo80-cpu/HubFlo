import { extractOpenAiUsage, getBlakeAiSpendGuard, recordBlakeAiUsage } from "@/lib/blake-ai-usage";
import { resolveOpenAiApiKeyCandidates } from "@/lib/openai-env";
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

function isMinutePricedTranscription(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.openai.com" && parsed.pathname === "/v1/audio/transcriptions";
  } catch {
    return false;
  }
}

function bearerToken(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const auth = headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function withBearer(init: RequestInit | undefined, key: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${key}`);
  return { ...init, headers };
}

async function shouldTryAlternateKey(response: Response) {
  if (response.status === 401 || response.status === 403) return true;
  if (response.status !== 429) return false;
  try {
    const text = (await response.clone().text()).toLowerCase();
    return text.includes("quota")
      || text.includes("billing")
      || text.includes("api key")
      || text.includes("rate_limit")
      || text.includes("rate limit");
  } catch {
    return true;
  }
}

async function fetchOpenAiWithConfiguredKeyFailover(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
) {
  let response = await fetchWithTimeout(url, init, timeoutMs);
  if (response.ok || !(await shouldTryAlternateKey(response))) return response;

  const currentKey = bearerToken(init);
  const alternates = resolveOpenAiApiKeyCandidates().filter((item) => item.key !== currentKey);
  for (const alternate of alternates) {
    console.warn(`OpenAI rejected the active credential; retrying with ${alternate.source}.`);
    response = await fetchWithTimeout(url, withBearer(init, alternate.key), timeoutMs);
    if (response.ok || !(await shouldTryAlternateKey(response))) return response;
  }
  return response;
}

/**
 * Server-side fetch to OpenAI with a hard timeout so hung calls cannot pin
 * Render/AWS memory indefinitely. OpenAI JSON calls are also metered here so
 * Ayla's usage guard applies consistently to chat, survey and takeoff AI.
 * Minute-priced audio transcription is recorded by its owning route instead of
 * the token meter so it is counted once at the published per-minute rate.
 *
 * Live can contain both the historic NEXA_OPENAI_API_KEY and a generic
 * OPENAI_API_KEY. If OpenAI rejects one credential (auth/quota/rate-limit),
 * retry the same request with the other configured credential before failing.
 * No key values are logged or returned to the browser.
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

  const response = meter
    ? await fetchOpenAiWithConfiguredKeyFailover(url, init, timeoutMs)
    : await fetchWithTimeout(url, init, timeoutMs);

  if (meter && response.ok && !isMinutePricedTranscription(url)) {
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

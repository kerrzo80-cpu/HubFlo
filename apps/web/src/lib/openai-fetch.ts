import { fetchWithTimeout } from "@/lib/fetch-timeout";

/** Default cap for most OpenAI Responses / chat calls. */
export const OPENAI_DEFAULT_TIMEOUT_MS = 60_000;

/** Longer budget for takeoff extract / multi-file vision. */
export const OPENAI_LONG_TIMEOUT_MS = 120_000;

/** Short budget for Field Ask Blake interactive paths. */
export const OPENAI_FIELD_TIMEOUT_MS = 28_000;

/**
 * Server-side fetch to OpenAI with a hard timeout so hung calls cannot pin
 * Render/AWS memory indefinitely.
 */
export function openAiFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = OPENAI_DEFAULT_TIMEOUT_MS,
) {
  return fetchWithTimeout(url, init, timeoutMs);
}

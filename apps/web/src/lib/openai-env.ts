import { getStoredOpenAiKey } from "@/lib/openai-key-store";

type OpenAiKeyCandidate = {
  key: string;
  source: "NEXA_OPENAI_API_KEY" | "OPENAI_API_KEY" | "in-app";
};

/**
 * Return every configured OpenAI key without duplicates. The Blake-specific
 * Render key is tried first because older live deployments may still have a
 * stale generic OPENAI_API_KEY alongside the current NEXA_OPENAI_API_KEY.
 * Callers that support failover can try the next candidate only when OpenAI
 * rejects the current credential/quota; keys are never logged or returned to
 * the browser.
 */
export function resolveOpenAiApiKeyCandidates(): OpenAiKeyCandidate[] {
  const raw: OpenAiKeyCandidate[] = [
    { key: process.env.NEXA_OPENAI_API_KEY?.trim() || "", source: "NEXA_OPENAI_API_KEY" },
    { key: process.env.OPENAI_API_KEY?.trim() || "", source: "OPENAI_API_KEY" },
    { key: getStoredOpenAiKey()?.trim() || "", source: "in-app" },
  ];
  const configured = raw.filter((item) => Boolean(item.key));

  const seen = new Set<string>();
  return configured.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

/**
 * Resolve one OpenAI API key for legacy callers. Blake-specific environment
 * configuration wins, then the generic environment key, then the in-app key.
 */
export function resolveOpenAiApiKey() {
  return resolveOpenAiApiKeyCandidates()[0]?.key || "";
}

export function openAiApiKeyEnvName() {
  return resolveOpenAiApiKeyCandidates()[0]?.source || "OPENAI_API_KEY or NEXA_OPENAI_API_KEY";
}

/** Where the active key comes from: an environment variable, the in-app Setup key, or nowhere. */
export function openAiKeySource(): "env" | "in-app" | "none" {
  const candidate = resolveOpenAiApiKeyCandidates()[0];
  if (!candidate) return "none";
  return candidate.source === "in-app" ? "in-app" : "env";
}

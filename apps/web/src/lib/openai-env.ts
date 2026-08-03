import { getStoredOpenAiKey } from "@/lib/openai-key-store";

/**
 * Resolve the OpenAI API key. Environment variables win (Render / production),
 * then the in-app key saved in Core Setup, then empty. Preferring env keeps
 * hosted deployments authoritative while letting operators enable AI in-app.
 */
export function resolveOpenAiApiKey() {
  return (
    process.env.OPENAI_API_KEY?.trim()
    || process.env.NEXA_OPENAI_API_KEY?.trim()
    || getStoredOpenAiKey()
    || ""
  );
}

export function openAiApiKeyEnvName() {
  if (process.env.OPENAI_API_KEY?.trim()) return "OPENAI_API_KEY";
  if (process.env.NEXA_OPENAI_API_KEY?.trim()) return "NEXA_OPENAI_API_KEY";
  return "OPENAI_API_KEY or NEXA_OPENAI_API_KEY";
}

/** Where the active key comes from: an environment variable, the in-app Setup key, or nowhere. */
export function openAiKeySource(): "env" | "in-app" | "none" {
  if (process.env.OPENAI_API_KEY?.trim() || process.env.NEXA_OPENAI_API_KEY?.trim()) return "env";
  if (getStoredOpenAiKey()) return "in-app";
  return "none";
}

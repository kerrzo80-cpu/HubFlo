import { openAiApiKeyEnvName, resolveOpenAiApiKey } from "@/lib/openai-env";
import { DEFAULT_OPENAI_MODEL, getStoredOpenAiConfig, saveStoredOpenAiConfig } from "@/lib/openai-key-store";

type ResolvedTakeoffAiConfig = {
  connected: boolean;
  apiKey: string;
  model: string;
  source: "env" | "local" | "none";
  keyName: string;
  updatedAt?: string;
};

export function getTakeoffOpenAiConfig(): ResolvedTakeoffAiConfig {
  const stored = getStoredOpenAiConfig();
  const envKey = process.env.OPENAI_API_KEY?.trim() || process.env.NEXA_OPENAI_API_KEY?.trim() || "";
  const apiKey = resolveOpenAiApiKey();
  const model = process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || process.env.NEXA_ASSISTANT_OPENAI_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim()
    || stored.model?.trim()
    || DEFAULT_OPENAI_MODEL;

  return {
    connected: Boolean(apiKey),
    apiKey,
    model,
    source: envKey ? "env" : stored.apiKey?.trim() ? "local" : "none",
    keyName: openAiApiKeyEnvName(),
    updatedAt: stored.updatedAt,
  };
}

export function saveTakeoffOpenAiConfig(apiKey: string, model = DEFAULT_OPENAI_MODEL) {
  const config = saveStoredOpenAiConfig(apiKey, model);
  return {
    connected: true,
    model: config.model ?? model,
    source: "local" as const,
    updatedAt: config.updatedAt,
  };
}

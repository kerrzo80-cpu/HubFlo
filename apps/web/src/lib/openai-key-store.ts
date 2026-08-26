import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { requireEnvSecretsOnly } from "@/lib/runtime-security";

/**
 * Shared, in-app OpenAI configuration.
 * Environment variables always win (see resolveOpenAiApiKey).
 * In live/users/production, keys must NOT be persisted in the app data store.
 */
const STORE_NAME = "nexa-openai-config";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export type StoredOpenAiConfig = {
  apiKey?: string;
  model?: string;
  updatedAt?: string;
};

export function getStoredOpenAiConfig(): StoredOpenAiConfig {
  return loadServerStore<StoredOpenAiConfig>(STORE_NAME, {});
}

export function getStoredOpenAiKey(): string {
  if (requireEnvSecretsOnly()) return "";
  return getStoredOpenAiConfig().apiKey?.trim() || "";
}

export function saveStoredOpenAiConfig(apiKey: string, model?: string): StoredOpenAiConfig {
  if (requireEnvSecretsOnly()) {
    throw new Error(
      "OpenAI API keys cannot be saved in the app data store on live/production. Set OPENAI_API_KEY or NEXA_OPENAI_API_KEY in the host secrets instead.",
    );
  }
  const existing = getStoredOpenAiConfig();
  const config: StoredOpenAiConfig = {
    apiKey: apiKey.trim(),
    model: model?.trim() || existing.model?.trim() || DEFAULT_OPENAI_MODEL,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, config);
  return config;
}

/** Persist model preference only (no API key) — allowed in all modes. */
export function saveStoredOpenAiModel(model: string): StoredOpenAiConfig {
  const existing = getStoredOpenAiConfig();
  const config: StoredOpenAiConfig = {
    apiKey: requireEnvSecretsOnly() ? undefined : existing.apiKey,
    model: model.trim() || existing.model?.trim() || DEFAULT_OPENAI_MODEL,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, config);
  return config;
}

export function clearStoredOpenAiConfig(): void {
  writeServerStore(STORE_NAME, {} satisfies StoredOpenAiConfig);
}

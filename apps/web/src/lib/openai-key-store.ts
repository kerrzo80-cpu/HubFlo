import { loadServerStore, writeServerStore } from "@/lib/server-store";

/**
 * Shared, in-app OpenAI configuration. Persisting the key here lets every AI
 * feature (Takeoff, Survey, Field "Ask Blake", the NeXa Assistant) use a single
 * key entered in Core Setup, without needing an environment variable / redeploy.
 * Environment variables still take precedence (see resolveOpenAiApiKey).
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
  return getStoredOpenAiConfig().apiKey?.trim() || "";
}

export function saveStoredOpenAiConfig(apiKey: string, model?: string): StoredOpenAiConfig {
  const existing = getStoredOpenAiConfig();
  const config: StoredOpenAiConfig = {
    apiKey: apiKey.trim(),
    model: model?.trim() || existing.model?.trim() || DEFAULT_OPENAI_MODEL,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, config);
  return config;
}

export function clearStoredOpenAiConfig(): void {
  writeServerStore(STORE_NAME, {} satisfies StoredOpenAiConfig);
}

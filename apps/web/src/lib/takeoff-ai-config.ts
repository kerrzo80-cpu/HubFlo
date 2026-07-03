import { loadServerStore, writeServerStore } from "@/lib/server-store";

const STORE_NAME = "takeoff-ai-config";
const DEFAULT_MODEL = "gpt-5.5";

type StoredTakeoffAiConfig = {
  apiKey?: string;
  model?: string;
  updatedAt?: string;
};

function readStoredConfig() {
  return loadServerStore<StoredTakeoffAiConfig>(STORE_NAME, {});
}

export function getTakeoffOpenAiConfig() {
  const stored = readStoredConfig();
  const apiKey = process.env.OPENAI_API_KEY?.trim() || stored.apiKey?.trim() || "";
  const model = process.env.NEXA_TAKEOFF_OPENAI_MODEL?.trim()
    || process.env.OPENAI_MODEL?.trim()
    || stored.model?.trim()
    || DEFAULT_MODEL;

  return {
    connected: Boolean(apiKey),
    apiKey,
    model,
    source: process.env.OPENAI_API_KEY?.trim() ? "env" : stored.apiKey?.trim() ? "local" : "none",
    updatedAt: stored.updatedAt,
  };
}

export function saveTakeoffOpenAiConfig(apiKey: string, model = DEFAULT_MODEL) {
  const trimmedKey = apiKey.trim();
  const trimmedModel = model.trim() || DEFAULT_MODEL;
  const config: StoredTakeoffAiConfig = {
    apiKey: trimmedKey,
    model: trimmedModel,
    updatedAt: new Date().toISOString(),
  };

  writeServerStore(STORE_NAME, config);
  return {
    connected: true,
    model: trimmedModel,
    source: "local",
    updatedAt: config.updatedAt,
  };
}

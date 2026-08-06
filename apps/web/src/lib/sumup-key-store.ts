import { loadServerStore, writeServerStore } from "@/lib/server-store";

const STORE_NAME = "nexa-sumup-config";

export type StoredSumUpConfig = {
  apiKey?: string;
  merchantCode?: string;
  updatedAt?: string;
};

export function getStoredSumUpConfig(): StoredSumUpConfig {
  return loadServerStore<StoredSumUpConfig>(STORE_NAME, {});
}

export function getSumUpApiKey(): string {
  return process.env.SUMUP_API_KEY?.trim() || getStoredSumUpConfig().apiKey?.trim() || "";
}

export function getSumUpMerchantCode(): string {
  return process.env.SUMUP_MERCHANT_CODE?.trim() || getStoredSumUpConfig().merchantCode?.trim() || "";
}

export function isSumUpConfigured() {
  return Boolean(getSumUpApiKey() && getSumUpMerchantCode());
}

export function sumUpKeySource(): "env" | "in-app" | "none" {
  if (process.env.SUMUP_API_KEY?.trim() && process.env.SUMUP_MERCHANT_CODE?.trim()) return "env";
  if (getStoredSumUpConfig().apiKey?.trim() && getStoredSumUpConfig().merchantCode?.trim()) return "in-app";
  if (process.env.SUMUP_API_KEY?.trim() || getStoredSumUpConfig().apiKey?.trim()) {
    // Partial config still counts as in-app/env for messaging; isSumUpConfigured stays false.
    return process.env.SUMUP_API_KEY?.trim() ? "env" : "in-app";
  }
  return "none";
}

export function saveStoredSumUpConfig(input: { apiKey?: string; merchantCode?: string }): StoredSumUpConfig {
  const existing = getStoredSumUpConfig();
  const config: StoredSumUpConfig = {
    apiKey: input.apiKey?.trim() || existing.apiKey,
    merchantCode: input.merchantCode?.trim() || existing.merchantCode,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, config);
  return config;
}

export function clearStoredSumUpConfig() {
  writeServerStore(STORE_NAME, {} satisfies StoredSumUpConfig);
}

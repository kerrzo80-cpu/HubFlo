import { loadServerStore, writeServerStore } from "@/lib/server-store";

const STORE_NAME = "nexa-stripe-config";

export type StoredStripeConfig = {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
  updatedAt?: string;
};

export function getStoredStripeConfig(): StoredStripeConfig {
  return loadServerStore<StoredStripeConfig>(STORE_NAME, {});
}

export function getStripeSecretKey(): string {
  return (
    process.env.STRIPE_SECRET_KEY?.trim() ||
    getStoredStripeConfig().secretKey?.trim() ||
    ""
  );
}

export function getStripePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    getStoredStripeConfig().publishableKey?.trim() ||
    ""
  );
}

export function getStripeWebhookSecret(): string {
  return (
    process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
    getStoredStripeConfig().webhookSecret?.trim() ||
    ""
  );
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey());
}

export function stripeKeySource(): "env" | "in-app" | "none" {
  if (process.env.STRIPE_SECRET_KEY?.trim()) return "env";
  if (getStoredStripeConfig().secretKey?.trim()) return "in-app";
  return "none";
}

export function saveStoredStripeConfig(input: {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
}): StoredStripeConfig {
  const existing = getStoredStripeConfig();
  const config: StoredStripeConfig = {
    secretKey: input.secretKey?.trim() || existing.secretKey,
    publishableKey: input.publishableKey?.trim() || existing.publishableKey,
    webhookSecret: input.webhookSecret?.trim() || existing.webhookSecret,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, config);
  return config;
}

export function clearStoredStripeConfig() {
  writeServerStore(STORE_NAME, {} satisfies StoredStripeConfig);
}

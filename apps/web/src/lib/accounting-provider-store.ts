import { loadServerStore, writeServerStore } from "@/lib/server-store";

/**
 * Per-workspace accounting connector settings.
 * Platform/env Xero app credentials remain an optional fallback; companies
 * normally pick a provider and connect from Setup (simPRO-style), without a
 * Render environment per customer.
 */
const STORE_NAME = "nexa-accounting-provider-v1";

export type AccountingProvider = "none" | "xero" | "quickbooks" | "sage";

export type StoredAccountingProviderConfig = {
  provider?: AccountingProvider;
  /** Optional in-app Xero OAuth app (overrides env when set). */
  xeroClientId?: string;
  xeroClientSecret?: string;
  xeroRedirectUri?: string;
  updatedAt?: string;
};

export const ACCOUNTING_PROVIDER_OPTIONS: Array<{
  key: AccountingProvider;
  label: string;
  detail: string;
  available: boolean;
}> = [
  {
    key: "none",
    label: "None / CSV only",
    detail: "Export invoices as CSV packs. No live accounts API.",
    available: true,
  },
  {
    key: "xero",
    label: "Xero",
    detail: "Connect your Xero organisation from Setup — same pattern as simPRO.",
    available: true,
  },
  {
    key: "quickbooks",
    label: "QuickBooks Online",
    detail: "Same Setup connect pattern — coming next.",
    available: false,
  },
  {
    key: "sage",
    label: "Sage",
    detail: "Same Setup connect pattern — coming next.",
    available: false,
  },
];

export function getStoredAccountingProviderConfig(): StoredAccountingProviderConfig {
  return loadServerStore<StoredAccountingProviderConfig>(STORE_NAME, {});
}

export function getAccountingProvider(): AccountingProvider {
  const provider = getStoredAccountingProviderConfig().provider;
  if (provider === "xero" || provider === "quickbooks" || provider === "sage" || provider === "none") {
    return provider;
  }
  return "none";
}

export function saveAccountingProviderConfig(
  input: Partial<StoredAccountingProviderConfig>,
): StoredAccountingProviderConfig {
  const existing = getStoredAccountingProviderConfig();
  const next: StoredAccountingProviderConfig = {
    provider: input.provider ?? existing.provider ?? "none",
    xeroClientId:
      input.xeroClientId !== undefined ? input.xeroClientId.trim() : existing.xeroClientId,
    xeroClientSecret:
      input.xeroClientSecret !== undefined
        ? input.xeroClientSecret.trim()
        : existing.xeroClientSecret,
    xeroRedirectUri:
      input.xeroRedirectUri !== undefined
        ? input.xeroRedirectUri.trim()
        : existing.xeroRedirectUri,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, next);
  return next;
}

export function defaultXeroRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  if (appUrl) return `${appUrl}/api/integrations/xero/callback`;
  return "https://nexa-live.onrender.com/api/integrations/xero/callback";
}

/** Resolve Xero OAuth app identity: env wins, then Setup-saved credentials. */
export function resolveXeroAppCredentials() {
  const stored = getStoredAccountingProviderConfig();
  const envClientId = process.env.XERO_CLIENT_ID?.trim() || "";
  const envClientSecret = process.env.XERO_CLIENT_SECRET?.trim() || "";
  const envRedirect = process.env.XERO_REDIRECT_URI?.trim() || "";

  const clientId = envClientId || stored.xeroClientId?.trim() || "";
  const clientSecret = envClientSecret || stored.xeroClientSecret?.trim() || "";
  const redirectUri = envRedirect || stored.xeroRedirectUri?.trim() || defaultXeroRedirectUri();

  let source: "env" | "setup" | "none" = "none";
  if (envClientId && envClientSecret) source = "env";
  else if (stored.xeroClientId?.trim() && stored.xeroClientSecret?.trim()) source = "setup";

  return {
    clientId,
    clientSecret,
    redirectUri,
    source,
    ready: Boolean(clientId && clientSecret && redirectUri),
    hasSetupCredentials: Boolean(stored.xeroClientId?.trim() && stored.xeroClientSecret?.trim()),
  };
}

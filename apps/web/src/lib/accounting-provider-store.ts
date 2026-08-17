import { loadServerStore, writeServerStore } from "@/lib/server-store";

/**
 * Per-workspace accounting connector settings.
 *
 * Xero OAuth: one NeXa/HubFlo Web App registered by the platform. Client ID
 * and secret live on Render (`XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`). Offices
 * never open developer.xero.com — they click Connect, sign in on Xero, and
 * approve NeXa for their organisation.
 */

const STORE_NAME = "nexa-accounting-provider-v1";

export type AccountingProvider = "none" | "xero" | "quickbooks" | "sage";

export type StoredAccountingProviderConfig = {
  provider?: AccountingProvider;
  /** Leftover/local-only Xero app credentials. Production uses Render env. */
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
    detail: "Sign in to Xero and approve NeXa — no developer account.",
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
      input.xeroClientId !== undefined ? sanitizeXeroCredential(input.xeroClientId) : existing.xeroClientId,
    xeroClientSecret:
      input.xeroClientSecret !== undefined
        ? sanitizeXeroCredential(input.xeroClientSecret)
        : existing.xeroClientSecret,
    xeroRedirectUri:
      input.xeroRedirectUri !== undefined
        ? sanitizeXeroCredential(input.xeroRedirectUri)
        : existing.xeroRedirectUri,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, next);
  return next;
}

export const XERO_PILOT_CALLBACK_URI = "https://nexa-pilot.onrender.com/api/integrations/xero/callback";
export const XERO_LIVE_CALLBACK_URI = "https://nexa-live.onrender.com/api/integrations/xero/callback";

/** Strip env-dashboard typos (wrapping quotes / whitespace) that make Xero reject the client. */
export function sanitizeXeroCredential(value: unknown) {
  let text = String(value ?? "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

const PLACEHOLDER_CLIENT_ID =
  /^(your[-_ ]?client[-_ ]?id|changeme|placeholder|dummy|example|x+|test([-_ ]?client[-_ ]?id)?|todo|client[_-]?id|nexa[-_ ]?client[-_ ]?id)$/i;
const PLACEHOLDER_CLIENT_SECRET =
  /^(changeme|placeholder|dummy|secret|your[-_ ]?client[-_ ]?secret|x+)$/i;

export function isUsableXeroClientId(value: unknown) {
  const id = sanitizeXeroCredential(value);
  if (id.length < 20) return false;
  if (PLACEHOLDER_CLIENT_ID.test(id)) return false;
  const compact = id.replace(/-/g, "");
  if (compact.length < 20) return false;
  if (/^(.)\1+$/.test(compact)) return false;
  return true;
}

export function isUsableXeroClientSecret(value: unknown) {
  const secret = sanitizeXeroCredential(value);
  if (secret.length < 8) return false;
  if (PLACEHOLDER_CLIENT_SECRET.test(secret)) return false;
  return true;
}

export function nexaPublicOrigin(request?: Request) {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  if (fromEnv) return fromEnv;
  if (request) {
    const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
    const proto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim() || (host.includes("localhost") ? "http" : "https");
    if (host) return `${proto}://${host}`;
    try {
      return new URL(request.url).origin;
    } catch {
      // fall through
    }
  }
  return process.env.NEXA_WORKSPACE_MODE?.trim().toLowerCase() === "live"
    ? "https://nexa-live.onrender.com"
    : "https://nexa-pilot.onrender.com";
}

/** This deploy’s callback — listed once on the platform NeXa Xero app, not per customer. */
export function defaultXeroRedirectUri(request?: Request) {
  return `${nexaPublicOrigin(request)}/api/integrations/xero/callback`;
}

/**
 * Resolve the platform Xero Web App identity.
 * Render env is the intended source. Stored Setup values are a last-resort
 * leftover (not an office path) and are ignored if they look like placeholders.
 */
export function resolveXeroAppCredentials(request?: Request) {
  const stored = getStoredAccountingProviderConfig();
  const envClientId = sanitizeXeroCredential(process.env.XERO_CLIENT_ID);
  const envClientSecret = sanitizeXeroCredential(process.env.XERO_CLIENT_SECRET);
  const envRedirect = sanitizeXeroCredential(process.env.XERO_REDIRECT_URI);
  const storedClientId = sanitizeXeroCredential(stored.xeroClientId);
  const storedClientSecret = sanitizeXeroCredential(stored.xeroClientSecret);

  const envReady = isUsableXeroClientId(envClientId) && isUsableXeroClientSecret(envClientSecret);
  const storedReady =
    !envClientId &&
    !envClientSecret &&
    isUsableXeroClientId(storedClientId) &&
    isUsableXeroClientSecret(storedClientSecret);

  const clientId = envReady ? envClientId : storedReady ? storedClientId : "";
  const clientSecret = envReady ? envClientSecret : storedReady ? storedClientSecret : "";
  const redirectUri = envRedirect || defaultXeroRedirectUri(request);

  let source: "env" | "setup" | "none" = "none";
  if (envReady) source = "env";
  else if (storedReady) source = "setup";

  return {
    clientId,
    clientSecret,
    redirectUri,
    source,
    ready: Boolean(clientId && clientSecret && redirectUri),
    hasSetupCredentials: storedReady,
  };
}

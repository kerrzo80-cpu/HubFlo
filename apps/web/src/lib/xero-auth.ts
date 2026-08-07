import {
  getAccountingProvider,
  resolveXeroAppCredentials,
} from "@/lib/accounting-provider-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

type XeroAuthStore = {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  tenantId?: string;
  tenantName?: string;
  updatedAt?: string;
};

export type XeroConnectionMode = "oauth" | "static-token" | "csv-only" | "missing";

export type XeroAuthStatus = {
  configured: boolean;
  mode: XeroConnectionMode;
  missing: string[];
  detectedEnvKeys: string[];
  tenantIdPresent: boolean;
  redirectUriPresent: boolean;
  hasRefreshToken: boolean;
  hasAccessToken: boolean;
  accessTokenExpiresAt?: string;
  authUrl?: string;
  checkedAt: string;
  /** Where the Xero OAuth app credentials come from. */
  credentialSource: "env" | "setup" | "none";
  /** Selected accounting provider in Setup. */
  provider: "none" | "xero" | "quickbooks" | "sage";
  /** True when Connect Xero can start (app credentials present). */
  canConnect: boolean;
  redirectUri?: string;
  tenantName?: string;
};

const STORE = "nexa-xero-auth-v1";
const tokenStore = loadServerStore<XeroAuthStore>(STORE, {});

function persistTokenStore() {
  tokenStore.updatedAt = new Date().toISOString();
  writeServerStore(STORE, tokenStore);
}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function scopes() {
  return (
    env("XERO_SCOPES") ||
    "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings.read"
  );
}

export function getXeroAuthStatus(): XeroAuthStatus {
  const app = resolveXeroAppCredentials();
  const provider = getAccountingProvider();
  const tenantId = env("XERO_TENANT_ID") || tokenStore.tenantId || "";
  const staticToken = env("XERO_ACCESS_TOKEN");
  const missing: string[] = [];

  if (!app.clientId) missing.push("Xero Client ID (Setup or env)");
  if (!app.clientSecret) missing.push("Xero Client Secret (Setup or env)");
  if (!app.redirectUri) missing.push("Xero redirect URI");

  const hasRefreshToken = Boolean(tokenStore.refreshToken?.trim());
  const hasAccessToken = Boolean(tokenStore.accessToken?.trim() || staticToken);

  let mode: XeroConnectionMode = "csv-only";
  if (hasRefreshToken || (app.ready && tokenStore.accessToken && !staticToken)) mode = "oauth";
  else if (staticToken && tenantId) mode = "static-token";
  else if (!app.clientId && !app.clientSecret && !tenantId && !staticToken) mode = "csv-only";
  else if (!app.ready && !hasRefreshToken && !staticToken) mode = "missing";

  // Live API ready when we have a tenant plus OAuth refresh or a static access token.
  const configured = Boolean(tenantId && (hasRefreshToken || staticToken));
  const detectedEnvKeys = Object.keys(process.env)
    .filter((key) => key.startsWith("XERO_"))
    .sort();

  return {
    configured,
    mode,
    missing: configured ? [] : missing,
    detectedEnvKeys,
    tenantIdPresent: Boolean(tenantId),
    redirectUriPresent: Boolean(app.redirectUri),
    hasRefreshToken,
    hasAccessToken,
    accessTokenExpiresAt: tokenStore.accessTokenExpiresAt,
    authUrl: app.ready
      ? `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${encodeURIComponent(app.clientId)}&redirect_uri=${encodeURIComponent(app.redirectUri)}&scope=${encodeURIComponent(scopes())}&state=nexa-xero`
      : undefined,
    checkedAt: new Date().toISOString(),
    credentialSource: app.source,
    provider,
    canConnect: Boolean(app.ready),
    redirectUri: app.redirectUri,
    tenantName: tokenStore.tenantName,
  };
}

export function getStoredXeroTenantId() {
  return env("XERO_TENANT_ID") || tokenStore.tenantId || "";
}

export function clearXeroConnection() {
  tokenStore.accessToken = undefined;
  tokenStore.refreshToken = undefined;
  tokenStore.accessTokenExpiresAt = undefined;
  tokenStore.tenantId = undefined;
  tokenStore.tenantName = undefined;
  persistTokenStore();
}

async function refreshAccessToken() {
  const app = resolveXeroAppCredentials();
  const refreshToken = tokenStore.refreshToken?.trim();
  if (!app.clientId || !app.clientSecret || !refreshToken) {
    return null;
  }

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (typeof body.error_description === "string" && body.error_description) ||
      (typeof body.error === "string" && body.error) ||
      `Xero token refresh failed (${response.status}).`;
    throw new Error(message);
  }

  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const nextRefresh = typeof body.refresh_token === "string" ? body.refresh_token : refreshToken;
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 1800;
  if (!accessToken) throw new Error("Xero refresh did not return an access token.");

  tokenStore.accessToken = accessToken;
  tokenStore.refreshToken = nextRefresh;
  tokenStore.accessTokenExpiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString();
  persistTokenStore();
  return accessToken;
}

export async function resolveXeroAccessToken() {
  const expiresAt = tokenStore.accessTokenExpiresAt ? Date.parse(tokenStore.accessTokenExpiresAt) : 0;
  if (tokenStore.accessToken && expiresAt > Date.now() + 30_000) {
    return tokenStore.accessToken;
  }
  if (tokenStore.refreshToken) {
    try {
      const refreshed = await refreshAccessToken();
      if (refreshed) return refreshed;
    } catch {
      // fall through to static token
    }
  }
  return env("XERO_ACCESS_TOKEN") || tokenStore.accessToken || "";
}

export async function exchangeXeroAuthorizationCode(code: string, tenantIdHint?: string) {
  const app = resolveXeroAppCredentials();
  if (!app.ready) {
    throw new Error(
      "Xero OAuth needs a Client ID, Client Secret and redirect URI — save them in Setup → Integrations → Xero, or set platform env once.",
    );
  }
  if (!code.trim()) throw new Error("Missing Xero authorisation code.");

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code.trim(),
      redirect_uri: app.redirectUri,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      (typeof body.error_description === "string" && body.error_description) ||
        (typeof body.error === "string" && body.error) ||
        `Xero code exchange failed (${response.status}).`,
    );
  }

  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 1800;
  if (!accessToken) throw new Error("Xero did not return an access token.");

  tokenStore.accessToken = accessToken;
  if (refreshToken) tokenStore.refreshToken = refreshToken;
  tokenStore.accessTokenExpiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString();

  let tenantId = env("XERO_TENANT_ID") || tenantIdHint || tokenStore.tenantId || "";
  let tenantName = tokenStore.tenantName || "";
  if (!tenantId || !tenantName) {
    try {
      const connections = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      const list = (await connections.json().catch(() => [])) as Array<{
        tenantId?: string;
        tenantName?: string;
      }>;
      const first = list.find((row) => row.tenantId);
      tenantId = tenantId || first?.tenantId || "";
      tenantName = tenantName || first?.tenantName || "";
    } catch {
      // keep existing
    }
  }
  if (tenantId) tokenStore.tenantId = tenantId;
  if (tenantName) tokenStore.tenantName = tenantName;
  persistTokenStore();

  return {
    accessToken,
    tenantId,
    tenantName,
    hasRefreshToken: Boolean(tokenStore.refreshToken),
  };
}

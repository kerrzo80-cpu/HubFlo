import { loadServerStore, writeServerStore } from "@/lib/server-store";

type XeroAuthStore = {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  tenantId?: string;
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
  const clientId = env("XERO_CLIENT_ID");
  const clientSecret = env("XERO_CLIENT_SECRET");
  const tenantId = env("XERO_TENANT_ID") || tokenStore.tenantId || "";
  const redirectUri = env("XERO_REDIRECT_URI");
  const staticToken = env("XERO_ACCESS_TOKEN");
  const missing: string[] = [];
  if (!clientId) missing.push("XERO_CLIENT_ID");
  if (!clientSecret) missing.push("XERO_CLIENT_SECRET");
  if (!tenantId) missing.push("XERO_TENANT_ID");

  const hasRefreshToken = Boolean(tokenStore.refreshToken?.trim());
  const hasAccessToken = Boolean(tokenStore.accessToken?.trim() || staticToken);
  const oauthReady = Boolean(clientId && clientSecret && redirectUri);
  if (!redirectUri && (clientId || clientSecret)) missing.push("XERO_REDIRECT_URI");

  let mode: XeroConnectionMode = "csv-only";
  if (hasRefreshToken || (oauthReady && tokenStore.accessToken && !staticToken)) mode = "oauth";
  else if (staticToken && tenantId) mode = "static-token";
  else if (!clientId && !clientSecret && !tenantId && !staticToken) mode = "csv-only";

  // Live API ready when we have a tenant plus OAuth refresh or a static access token.
  const configured = Boolean(tenantId && (hasRefreshToken || staticToken));
  const detectedEnvKeys = Object.keys(process.env)
    .filter((key) => key.startsWith("XERO_"))
    .sort();

  return {
    configured,
    mode,
    missing,
    detectedEnvKeys,
    tenantIdPresent: Boolean(tenantId),
    redirectUriPresent: Boolean(redirectUri),
    hasRefreshToken,
    hasAccessToken,
    accessTokenExpiresAt: tokenStore.accessTokenExpiresAt,
    authUrl: oauthReady
      ? `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes())}&state=nexa-xero`
      : undefined,
    checkedAt: new Date().toISOString(),
  };
}

export function getStoredXeroTenantId() {
  return env("XERO_TENANT_ID") || tokenStore.tenantId || "";
}

async function refreshAccessToken() {
  const clientId = env("XERO_CLIENT_ID");
  const clientSecret = env("XERO_CLIENT_SECRET");
  const refreshToken = tokenStore.refreshToken?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
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
  const clientId = env("XERO_CLIENT_ID");
  const clientSecret = env("XERO_CLIENT_SECRET");
  const redirectUri = env("XERO_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Xero OAuth needs XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI.");
  }
  if (!code.trim()) throw new Error("Missing Xero authorisation code.");

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code.trim(),
      redirect_uri: redirectUri,
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

  // Discover tenant if not already set
  let tenantId = env("XERO_TENANT_ID") || tenantIdHint || tokenStore.tenantId || "";
  if (!tenantId) {
    try {
      const connections = await fetch("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      const list = (await connections.json().catch(() => [])) as Array<{ tenantId?: string }>;
      tenantId = list.find((row) => row.tenantId)?.tenantId || "";
    } catch {
      tenantId = "";
    }
  }
  if (tenantId) tokenStore.tenantId = tenantId;
  persistTokenStore();

  return {
    accessToken,
    tenantId,
    hasRefreshToken: Boolean(tokenStore.refreshToken),
  };
}

import { createHash, randomBytes } from "node:crypto";

import {
  getAccountingProvider,
  nexaPublicOrigin,
  resolveXeroAppCredentials,
  saveAccountingProviderConfig,
  XERO_LIVE_CALLBACK_URI,
  XERO_PILOT_CALLBACK_URI,
} from "@/lib/accounting-provider-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

type XeroAuthStore = {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  tenantId?: string;
  tenantName?: string;
  oauthState?: string;
  codeVerifier?: string;
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
  checkedAt: string;
  credentialSource: "env" | "setup" | "none";
  provider: "none" | "xero" | "quickbooks" | "sage";
  canConnect: boolean;
  redirectUri?: string;
  redirectUrisToRegister: string[];
  tenantName?: string;
  officeMessage?: string;
};

const STORE = "nexa-xero-auth-v1";
const tokenStore = loadServerStore<XeroAuthStore>(STORE, {});
const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_REQUIRED_SCOPES = [
  "offline_access",
  "accounting.invoices",
  "accounting.payments",
  "accounting.contacts",
  "accounting.settings",
] as const;
const XERO_ALLOWED_SCOPES = new Set<string>(XERO_REQUIRED_SCOPES);
const XERO_DEFAULT_SCOPES = XERO_REQUIRED_SCOPES.join(" ");
const XERO_SCOPE_TRANSLATIONS: Record<string, readonly string[]> = {
  "accounting.transactions": ["accounting.invoices", "accounting.payments"],
};

export const XERO_OFFICE_CONNECT_COPY =
  "Click Connect Xero. You’ll sign in to Xero and approve NeXa for your organisation. You don’t need a Xero developer account. NeXa never asks for your Xero password.";

export const XERO_MISSING_CREDENTIALS_MESSAGE =
  "NeXa’s Xero app is not set up on this server yet. You don’t need a developer account — you only sign in to Xero and approve NeXa. Ask the person who hosts NeXa to set XERO_CLIENT_ID and XERO_CLIENT_SECRET on Render (nexa-pilot and nexa-live, one shared NeXa Web App), then click Connect Xero again.";

export const XERO_UNAUTHORIZED_CLIENT_MESSAGE =
  "Xero did not recognise NeXa’s app on this server (unknown or disabled Client ID). You still don’t need a developer account. Ask the person who hosts NeXa to check XERO_CLIENT_ID / XERO_CLIENT_SECRET on Render — they must be the enabled NeXa Web App, not a draft or Custom Connection — then try Connect Xero again.";

function persistTokenStore() {
  tokenStore.updatedAt = new Date().toISOString();
  writeServerStore(STORE, tokenStore);
}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function scopes() {
  const configured = env("XERO_SCOPES");
  if (!configured) return XERO_DEFAULT_SCOPES;
  const requested = configured.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
  const translated = requested.flatMap((scope) => XERO_SCOPE_TRANSLATIONS[scope] || [scope]);
  const filtered = translated.filter(
    (scope, index) => XERO_ALLOWED_SCOPES.has(scope) && translated.indexOf(scope) === index,
  );
  const hasAllRequiredScopes = XERO_REQUIRED_SCOPES.every((scope) => filtered.includes(scope));
  return hasAllRequiredScopes ? filtered.join(" ") : XERO_DEFAULT_SCOPES;
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkce() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function xeroRedirectUrisToRegister() {
  return [XERO_PILOT_CALLBACK_URI, XERO_LIVE_CALLBACK_URI];
}

export function getXeroOfficeMessage(appReady = resolveXeroAppCredentials().ready) {
  return appReady ? XERO_OFFICE_CONNECT_COPY : XERO_MISSING_CREDENTIALS_MESSAGE;
}

export function officeMessageForXeroOAuthError(error: string, description?: string) {
  const code = error.trim().toLowerCase();
  const detail = `${description || ""} ${error}`.toLowerCase();
  if (code === "unauthorized_client" || detail.includes("unknown client") || detail.includes("client not enabled")) {
    return XERO_UNAUTHORIZED_CLIENT_MESSAGE;
  }
  if (code === "access_denied") {
    return "Xero connect was cancelled. Click Connect Xero again when you are ready to approve NeXa.";
  }
  return (description || error || "Xero connect failed.").trim();
}

export function getXeroAuthStatus(request?: Request): XeroAuthStatus {
  const app = resolveXeroAppCredentials(request);
  const provider = getAccountingProvider();
  const tenantId = env("XERO_TENANT_ID") || tokenStore.tenantId || "";
  const staticToken = env("XERO_ACCESS_TOKEN");
  const missing: string[] = [];

  if (!app.clientId) missing.push("Platform XERO_CLIENT_ID on Render");
  if (!app.clientSecret) missing.push("Platform XERO_CLIENT_SECRET on Render");
  if (!app.redirectUri) missing.push("Xero redirect URI");

  const hasRefreshToken = Boolean(tokenStore.refreshToken?.trim());
  const hasAccessToken = Boolean(tokenStore.accessToken?.trim() || staticToken);

  let mode: XeroConnectionMode = "csv-only";
  if (hasRefreshToken || (app.ready && tokenStore.accessToken && !staticToken)) mode = "oauth";
  else if (staticToken && tenantId) mode = "static-token";
  else if (!app.clientId && !app.clientSecret && !tenantId && !staticToken) mode = "csv-only";
  else if (!app.ready && !hasRefreshToken && !staticToken) mode = "missing";

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
    checkedAt: new Date().toISOString(),
    credentialSource: app.source,
    provider,
    canConnect: Boolean(app.ready),
    redirectUri: app.redirectUri,
    redirectUrisToRegister: xeroRedirectUrisToRegister(),
    tenantName: tokenStore.tenantName,
    officeMessage: getXeroOfficeMessage(app.ready),
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
  tokenStore.oauthState = undefined;
  tokenStore.codeVerifier = undefined;
  persistTokenStore();
}

export function startXeroAuthorization(request?: Request) {
  const app = resolveXeroAppCredentials(request);
  if (!app.ready) {
    throw new Error(XERO_MISSING_CREDENTIALS_MESSAGE);
  }

  const { verifier, challenge } = createPkce();
  const state = base64Url(randomBytes(24));
  tokenStore.oauthState = state;
  tokenStore.codeVerifier = verifier;
  persistTokenStore();

  const url = new URL(XERO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("redirect_uri", app.redirectUri);
  url.searchParams.set("scope", scopes());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authUrl: url.toString(), redirectUri: app.redirectUri, state };
}

async function xeroTokenRequest(body: URLSearchParams, request?: Request) {
  const app = resolveXeroAppCredentials(request);
  const response = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, json };
}

async function refreshAccessToken() {
  const app = resolveXeroAppCredentials();
  const refreshToken = tokenStore.refreshToken?.trim();
  if (!app.clientId || !app.clientSecret || !refreshToken) {
    return null;
  }

  const { response, json } = await xeroTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  if (!response.ok) {
    const message =
      (typeof json.error_description === "string" && json.error_description) ||
      (typeof json.error === "string" && json.error) ||
      `Xero token refresh failed (${response.status}).`;
    throw new Error(message);
  }

  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  const nextRefresh = typeof json.refresh_token === "string" ? json.refresh_token : refreshToken;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 1800;
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

export async function exchangeXeroAuthorizationCode(
  code: string,
  options?: { tenantIdHint?: string; state?: string; request?: Request },
) {
  const app = resolveXeroAppCredentials(options?.request);
  if (!app.ready) {
    throw new Error(XERO_MISSING_CREDENTIALS_MESSAGE);
  }
  if (!code.trim()) throw new Error("Missing Xero authorisation code.");
  if (tokenStore.oauthState && options?.state && options.state !== tokenStore.oauthState) {
    throw new Error("Xero connect state did not match. Click Connect Xero and try again.");
  }

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.trim(),
    redirect_uri: app.redirectUri,
  });
  if (tokenStore.codeVerifier) tokenBody.set("code_verifier", tokenStore.codeVerifier);

  const { response, json } = await xeroTokenRequest(tokenBody, options?.request);
  if (!response.ok) {
    const errorCode = typeof json.error === "string" ? json.error : "";
    const description =
      (typeof json.error_description === "string" && json.error_description) ||
      errorCode ||
      `Xero code exchange failed (${response.status}).`;
    throw new Error(officeMessageForXeroOAuthError(errorCode || "error", description));
  }

  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 1800;
  if (!accessToken) throw new Error("Xero did not return an access token.");

  tokenStore.accessToken = accessToken;
  if (refreshToken) tokenStore.refreshToken = refreshToken;
  tokenStore.accessTokenExpiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString();
  tokenStore.oauthState = undefined;
  tokenStore.codeVerifier = undefined;

  let tenantId = env("XERO_TENANT_ID") || options?.tenantIdHint || tokenStore.tenantId || "";
  let tenantName = tokenStore.tenantName || "";
  try {
    const connections = await fetch("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const list = (await connections.json().catch(() => [])) as Array<{
      tenantId?: string;
      tenantName?: string;
    }>;
    const first = Array.isArray(list) ? list.find((row) => row.tenantId) : undefined;
    tenantId = tenantId || first?.tenantId || "";
    tenantName = tenantName || first?.tenantName || "";
  } catch {
    // keep existing
  }
  if (!tenantId) {
    persistTokenStore();
    throw new Error(
      "Xero signed in but did not return an organisation. On the Xero consent screen, choose the company to connect, then try Connect Xero again.",
    );
  }
  tokenStore.tenantId = tenantId;
  if (tenantName) tokenStore.tenantName = tenantName;
  persistTokenStore();
  saveAccountingProviderConfig({ provider: "xero" });

  return {
    accessToken,
    tenantId,
    tenantName,
    hasRefreshToken: Boolean(tokenStore.refreshToken),
  };
}

export function xeroCallbackAppOrigin(request: Request) {
  return nexaPublicOrigin(request);
}

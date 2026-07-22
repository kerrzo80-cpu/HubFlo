import { existsSync, readFileSync } from "node:fs";

import { loadServerStore, writeServerStore } from "@/lib/server-store";

type SourceValue = {
  name: string;
  value: string;
};

type SimproAuthStore = {
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  updatedAt?: string;
};

export type SimproDirectConfigStatus =
  | {
      configured: true;
      missing: [];
      baseUrl: string;
      companyId: string;
      sourceNames: {
        baseUrl?: string;
        token?: string;
        companyId?: string;
        clientId?: string;
        clientSecret?: string;
        refreshToken?: string;
        tokenUrl?: string;
      };
    }
  | {
      configured: false;
      missing: string[];
      baseUrl?: string;
      companyId?: string;
      sourceNames: {
        baseUrl?: string;
        token?: string;
        companyId?: string;
        clientId?: string;
        clientSecret?: string;
        refreshToken?: string;
        tokenUrl?: string;
      };
    };

export type ResolvedSimproDirectConfig = {
  baseUrl: string;
  companyId: string;
  token: string;
};

const tokenStore = loadServerStore<SimproAuthStore>("simpro-auth-store", {});

function persistTokenStore() {
  tokenStore.updatedAt = new Date().toISOString();
  writeServerStore("simpro-auth-store", tokenStore);
}

function envFirst(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }

  return null;
}

function cleanEndpoint(value?: string) {
  return value?.trim().replace(/\/+$/, "");
}

function normaliseBaseUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const cleaned = cleanEndpoint(withProtocol) ?? "";
  return cleaned.endsWith("/api/v1.0") ? cleaned : `${cleaned}/api/v1.0`;
}

function tokenUrlFromBase(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}/oauth2/token`;
  } catch {
    return "";
  }
}

function readRefreshTokenFile(pathValue?: string) {
  if (!pathValue) return undefined;
  try {
    if (!existsSync(pathValue)) return undefined;
    const value = readFileSync(pathValue, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function currentRefreshTokenSource() {
  const inlineToken = envFirst([
    "SIMPRO_REFRESH_TOKEN",
    "SIMPRO_OAUTH_REFRESH_TOKEN",
    "SIMPRO_TOKEN_REFRESH",
  ]);
  if (inlineToken) return inlineToken;

  const refreshTokenFile = envFirst(["SIMPRO_REFRESH_TOKEN_FILE"]);
  const fileToken = readRefreshTokenFile(refreshTokenFile?.value);
  if (refreshTokenFile && fileToken) {
    return { name: refreshTokenFile.name, value: fileToken };
  }

  if (tokenStore.refreshToken?.trim()) {
    return { name: "simpro-auth-store.refreshToken", value: tokenStore.refreshToken.trim() };
  }

  return null;
}

function oauthConfig() {
  const clientId = envFirst(["SIMPRO_CLIENT_ID", "SIMPRO_OAUTH_CLIENT_ID"]);
  const clientSecret = envFirst(["SIMPRO_CLIENT_SECRET", "SIMPRO_OAUTH_CLIENT_SECRET"]);
  const refreshToken = currentRefreshTokenSource();
  const tokenUrl = envFirst(["SIMPRO_OAUTH_TOKEN_URL"]);

  return {
    clientId,
    clientSecret,
    refreshToken,
    tokenUrl,
  };
}

function cachedAccessToken() {
  if (!tokenStore.accessToken?.trim() || !tokenStore.accessTokenExpiresAt) return undefined;
  const expiresAt = Date.parse(tokenStore.accessTokenExpiresAt);
  if (!Number.isFinite(expiresAt)) return undefined;
  if (Date.now() >= expiresAt - 60_000) return undefined;
  return tokenStore.accessToken.trim();
}

function accessTokenSource() {
  const token = envFirst([
    "SIMPRO_API_KEY",
    "SIMPRO_ACCESS_TOKEN",
    "SIMPRO_API_TOKEN",
    "SIMPRO_TOKEN",
    "SIMPRO_OAUTH_ACCESS_TOKEN",
    "SIMPRO_BEARER_TOKEN",
  ]);
  if (token) return token;

  const cached = cachedAccessToken();
  if (cached) {
    return { name: "simpro-auth-store.accessToken", value: cached };
  }

  return null;
}

export function getSimproDirectConfigStatus(): SimproDirectConfigStatus {
  const base = envFirst([
    "SIMPRO_API_BASE_URL",
    "SIMPRO_BUILD_URL",
    "SIMPRO_BASE_URL",
    "SIMPRO_SITE_URL",
    "SIMPRO_API_URL",
    "SIMPRO_URL",
    "SIMPRO_HOST",
    "SIMPRO_DOMAIN",
  ]);
  const companyId = envFirst(["SIMPRO_COMPANY_ID", "SIMPRO_COMPANY", "SIMPRO_COMPANY_NUMBER", "SIMPRO_COMPANYID"]);
  const directToken = accessTokenSource();
  const oauth = oauthConfig();
  const hasOauthConfig = Boolean(oauth.clientId && oauth.clientSecret && oauth.refreshToken);
  const missing = [
    !base ? "SIMPRO_API_BASE_URL / SIMPRO_BUILD_URL / SIMPRO_URL" : null,
    !companyId ? "SIMPRO_COMPANY_ID / SIMPRO_COMPANY" : null,
    !directToken && !hasOauthConfig
      ? "SIMPRO_ACCESS_TOKEN or SIMPRO_CLIENT_ID / SIMPRO_CLIENT_SECRET / SIMPRO_REFRESH_TOKEN"
      : null,
  ].filter((item): item is string => Boolean(item));

  const sourceNames = {
    baseUrl: base?.name,
    token: directToken?.name,
    companyId: companyId?.name,
    clientId: oauth.clientId?.name,
    clientSecret: oauth.clientSecret?.name,
    refreshToken: oauth.refreshToken?.name,
    tokenUrl: oauth.tokenUrl?.name,
  };

  if (missing.length > 0 || !base || !companyId || (!directToken && !hasOauthConfig)) {
    return {
      configured: false,
      missing,
      baseUrl: base ? normaliseBaseUrl(base.value) : undefined,
      companyId: companyId?.value,
      sourceNames,
    };
  }

  return {
    configured: true,
    missing: [],
    baseUrl: normaliseBaseUrl(base.value),
    companyId: companyId.value,
    sourceNames,
  };
}

async function refreshAccessToken(baseUrl: string) {
  const oauth = oauthConfig();
  if (!oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) {
    throw new Error("simPRO OAuth refresh credentials are incomplete.");
  }

  const tokenUrl = oauth.tokenUrl?.value?.trim() || tokenUrlFromBase(baseUrl);
  if (!tokenUrl) {
    throw new Error("simPRO OAuth token URL could not be determined.");
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oauth.refreshToken.value,
      client_id: oauth.clientId.value,
      client_secret: oauth.clientSecret.value,
    }).toString(),
    cache: "no-store",
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : oauth.refreshToken.value;
  const expiresIn = typeof body.expires_in === "number"
    ? body.expires_in
    : typeof body.expires_in === "string"
      ? Number(body.expires_in)
      : 3600;

  if (!response.ok || !accessToken) {
    const message =
      (typeof body.error_description === "string" && body.error_description.trim()) ||
      (typeof body.error === "string" && body.error.trim()) ||
      (typeof body.message === "string" && body.message.trim()) ||
      `simPRO OAuth token request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  tokenStore.accessToken = accessToken;
  tokenStore.refreshToken = refreshToken;
  tokenStore.accessTokenExpiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString();
  persistTokenStore();

  return accessToken;
}

export async function resolveSimproDirectConfig(): Promise<ResolvedSimproDirectConfig> {
  const status = getSimproDirectConfigStatus();
  if (!status.configured) {
    throw new Error(`simPRO direct API is not configured: ${status.missing.join(", ")}.`);
  }

  const token = accessTokenSource()?.value ?? (await refreshAccessToken(status.baseUrl));
  if (!token) {
    throw new Error("simPRO access token is unavailable.");
  }

  return {
    baseUrl: status.baseUrl,
    companyId: status.companyId,
    token,
  };
}

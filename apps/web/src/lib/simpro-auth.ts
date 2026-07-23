import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

export type SimproAuthDiagnostics = {
  baseUrl?: string;
  companyId?: string;
  configured: boolean;
  missing: string[];
  sourceNames: {
    baseUrl?: string;
    token?: string;
    companyId?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    tokenUrl?: string;
  };
  refreshTokenFile: {
    path?: string;
    exists: boolean;
    tokenLength: number;
  };
  tokenStore: {
    refreshTokenLength: number;
    accessTokenLength: number;
    accessTokenExpiresAt?: string;
  };
  refreshCandidates: Array<{
    name: string;
    length: number;
  }>;
};

export type SimproReconnectStatus = {
  ready: boolean;
  missing: string[];
  authUrl?: string;
  checkedAt: string;
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

function hostBaseUrl(value: string) {
  return normaliseBaseUrl(value).replace(/\/api\/v1\.0$/i, "");
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

function refreshTokenFilePath() {
  return envFirst(["SIMPRO_REFRESH_TOKEN_FILE"])?.value?.trim() || "";
}

function inlineRefreshTokenSource() {
  return envFirst([
    "SIMPRO_REFRESH_TOKEN",
    "SIMPRO_OAUTH_REFRESH_TOKEN",
    "SIMPRO_TOKEN_REFRESH",
  ]);
}

function refreshTokenCandidates() {
  seedRefreshTokenFileFromEnv();

  const candidates: SourceValue[] = [];
  const seen = new Set<string>();
  const push = (candidate?: SourceValue | null) => {
    if (!candidate?.value?.trim()) return;
    const value = candidate.value.trim();
    if (seen.has(value)) return;
    seen.add(value);
    candidates.push({ name: candidate.name, value });
  };

  const refreshTokenFile = envFirst(["SIMPRO_REFRESH_TOKEN_FILE"]);
  const fileToken = readRefreshTokenFile(refreshTokenFile?.value);
  if (refreshTokenFile && fileToken) {
    push({ name: refreshTokenFile.name, value: fileToken });
  }

  if (tokenStore.refreshToken?.trim()) {
    push({ name: "simpro-auth-store.refreshToken", value: tokenStore.refreshToken.trim() });
  }

  push(inlineRefreshTokenSource());

  return candidates;
}

function seedRefreshTokenFileFromEnv() {
  const filePath = refreshTokenFilePath();
  const inlineToken = inlineRefreshTokenSource();
  if (!filePath || !inlineToken?.value) return;

  try {
    const existing = readRefreshTokenFile(filePath);
    if (existing) return;
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    return;
  }

  try {
    writeFileSync(filePath, inlineToken.value.trim());
  } catch {
    // Ignore file seeding failures and fall back to other token sources.
  }
}

function persistRefreshTokenToFile(refreshToken: string) {
  const filePath = refreshTokenFilePath();
  if (!filePath || !refreshToken.trim()) return;

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, refreshToken.trim());
  } catch {
    // Ignore file persistence failures and keep the token in the NeXa store.
  }
}

function currentRefreshTokenSource() {
  return refreshTokenCandidates()[0] ?? null;
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

export function getSimproReconnectStatus(): SimproReconnectStatus {
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
  const clientId = envFirst(["SIMPRO_CLIENT_ID", "SIMPRO_OAUTH_CLIENT_ID"]);
  const clientSecret = envFirst(["SIMPRO_CLIENT_SECRET", "SIMPRO_OAUTH_CLIENT_SECRET"]);
  const missing = [
    !base ? "SIMPRO_BASE_URL" : null,
    !clientId ? "SIMPRO_CLIENT_ID" : null,
    !clientSecret ? "SIMPRO_CLIENT_SECRET" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: missing.length === 0,
    missing,
    authUrl: base && clientId ? `${hostBaseUrl(base.value)}/oauth2/login?client_id=${encodeURIComponent(clientId.value)}` : undefined,
    checkedAt: new Date().toISOString(),
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

export function getSimproAuthDiagnostics(): SimproAuthDiagnostics {
  const status = getSimproDirectConfigStatus();
  const refreshTokenFile = refreshTokenFilePath();
  const fileToken = readRefreshTokenFile(refreshTokenFile);

  return {
    baseUrl: status.baseUrl,
    companyId: status.companyId,
    configured: status.configured,
    missing: status.missing,
    sourceNames: status.sourceNames,
    refreshTokenFile: {
      path: refreshTokenFile || undefined,
      exists: Boolean(refreshTokenFile && existsSync(refreshTokenFile)),
      tokenLength: fileToken?.length ?? 0,
    },
    tokenStore: {
      refreshTokenLength: tokenStore.refreshToken?.trim().length ?? 0,
      accessTokenLength: tokenStore.accessToken?.trim().length ?? 0,
      accessTokenExpiresAt: tokenStore.accessTokenExpiresAt,
    },
    refreshCandidates: refreshTokenCandidates().map((candidate) => ({
      name: candidate.name,
      length: candidate.value.length,
    })),
  };
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
  if (!oauth.clientId || !oauth.clientSecret) {
    throw new Error("simPRO OAuth refresh credentials are incomplete.");
  }
  const refreshCandidates = refreshTokenCandidates();
  if (!refreshCandidates.length) {
    throw new Error("simPRO OAuth refresh credentials are incomplete.");
  }

  const tokenUrl = oauth.tokenUrl?.value?.trim() || tokenUrlFromBase(baseUrl);
  if (!tokenUrl) {
    throw new Error("simPRO OAuth token URL could not be determined.");
  }

  let lastMessage = "simPRO OAuth token request failed.";

  for (const refreshCandidate of refreshCandidates) {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshCandidate.value,
        client_id: oauth.clientId.value,
        client_secret: oauth.clientSecret.value,
      }).toString(),
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : refreshCandidate.value;
    const expiresIn = typeof body.expires_in === "number"
      ? body.expires_in
      : typeof body.expires_in === "string"
        ? Number(body.expires_in)
        : 3600;

    if (response.ok && accessToken) {
      tokenStore.accessToken = accessToken;
      tokenStore.refreshToken = refreshToken;
      tokenStore.accessTokenExpiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString();
      persistTokenStore();
      persistRefreshTokenToFile(refreshToken);

      return accessToken;
    }

    lastMessage =
      (typeof body.error_description === "string" && body.error_description.trim()) ||
      (typeof body.error === "string" && body.error.trim()) ||
      (typeof body.message === "string" && body.message.trim()) ||
      `simPRO OAuth token request failed with HTTP ${response.status}.`;
  }

  throw new Error(lastMessage);
}

export async function exchangeSimproAuthorizationCode(codeInput: string) {
  const fromUrlMatch = codeInput.match(/[?&]code=([^&]+)/i);
  const code = (fromUrlMatch ? decodeURIComponent(fromUrlMatch[1] ?? "") : codeInput).trim().replace(/^["']|["']$/g, "");
  if (!code) {
    throw new Error("Paste the fresh simPRO authorisation code or full redirect URL.");
  }

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
  const oauth = oauthConfig();
  if (!base || !oauth.clientId || !oauth.clientSecret) {
    throw new Error("The simPRO OAuth settings are incomplete in Render.");
  }

  const browserBaseUrl = hostBaseUrl(base.value);
  const tokenUrl = oauth.tokenUrl?.value?.trim() || tokenUrlFromBase(normaliseBaseUrl(base.value));
  if (!tokenUrl) {
    throw new Error("simPRO OAuth token URL could not be determined.");
  }

  const basePayload = {
    grant_type: "authorization_code",
    client_id: oauth.clientId.value,
    client_secret: oauth.clientSecret.value,
    code,
  };

  const payloads: Array<Record<string, string>> = [
    basePayload,
    {
      ...basePayload,
      redirect_uri: `${browserBaseUrl}/oauth2/accessCode`,
    },
    {
      ...basePayload,
      redirect_uri: "/oauth2/accessCode",
    },
  ];

  let lastMessage = "simPRO rejected the authorisation code.";
  for (const payload of payloads) {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(payload).toString(),
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
    const expiresIn = typeof body.expires_in === "number"
      ? body.expires_in
      : typeof body.expires_in === "string"
        ? Number(body.expires_in)
        : 3600;

    if (response.ok && refreshToken) {
      tokenStore.refreshToken = refreshToken;
      tokenStore.accessToken = accessToken || undefined;
      tokenStore.accessTokenExpiresAt = accessToken
        ? new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000).toISOString()
        : undefined;
      persistTokenStore();
      persistRefreshTokenToFile(refreshToken);
      return {
        refreshTokenLength: refreshToken.length,
        accessTokenLength: accessToken.length,
      };
    }

    lastMessage =
      (typeof body.error_description === "string" && body.error_description.trim()) ||
      (typeof body.error === "string" && body.error.trim()) ||
      (typeof body.message === "string" && body.message.trim()) ||
      `simPRO token exchange failed with HTTP ${response.status}.`;
  }

  throw new Error(lastMessage);
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

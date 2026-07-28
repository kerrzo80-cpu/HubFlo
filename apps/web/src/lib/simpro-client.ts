/**
 * Shared Simpro API helpers for read-only discovery/import.
 * Reuses simpro-auth token resolution — no second auth stack.
 */

import {
  getSimproDirectConfigStatus,
  resolveSimproDirectConfig,
  type ResolvedSimproDirectConfig,
} from "@/lib/simpro-auth";

export type UnknownRecord = Record<string, unknown>;

export type SimproFetchResult = {
  endpoint: string;
  status: number;
  ok: boolean;
  body: unknown;
  headers: Record<string, string>;
};

export type SimproClientOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerMap(headers: Headers) {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function retryAfterMs(headers: Record<string, string>, attempt: number, baseDelayMs: number) {
  const raw = headers["retry-after"];
  if (raw) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber >= 0) return Math.min(60_000, asNumber * 1000);
    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate)) return Math.min(60_000, Math.max(0, asDate - Date.now()));
  }
  return Math.min(60_000, baseDelayMs * 2 ** attempt);
}

export function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

export function extractSimproRecords(body: unknown): UnknownRecord[] {
  if (Array.isArray(body)) {
    return body.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  const record = asRecord(body);
  if (!record) return [];
  for (const key of ["data", "items", "results", "Results", "Records", "records"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
    }
  }
  return [];
}

export function simproRecordId(record: UnknownRecord | null | undefined) {
  if (!record) return "";
  for (const key of ["ID", "Id", "id"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function getSimproReadConfig() {
  const status = getSimproDirectConfigStatus();
  if (!status.configured) {
    throw new Error(`Simpro direct API is not configured. Missing: ${status.missing.join(", ")}.`);
  }
  return resolveSimproDirectConfig();
}

export async function simproGet(
  config: ResolvedSimproDirectConfig,
  path: string,
  options: SimproClientOptions = {},
): Promise<SimproFetchResult> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const endpoint = path.startsWith("http")
    ? path
    : `${config.baseUrl}/companies/${config.companyId}${path.startsWith("/") ? path : `/${path}`}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        cache: "no-store",
      });
      const headers = headerMap(response.headers);
      const body = await response.json().catch(() => ({}));

      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(retryAfterMs(headers, attempt, baseDelayMs));
          continue;
        }
      }

      return {
        endpoint,
        status: response.status,
        ok: response.ok,
        body,
        headers,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
    }
  }

  throw lastError ?? new Error(`Simpro request failed for ${endpoint}`);
}

export async function simproGetAbsolute(
  config: ResolvedSimproDirectConfig,
  absolutePath: string,
  options: SimproClientOptions = {},
): Promise<SimproFetchResult> {
  const host = config.baseUrl.replace(/\/api\/v1\.0$/i, "");
  const url = absolutePath.startsWith("http")
    ? absolutePath
    : `${host}${absolutePath.startsWith("/") ? absolutePath : `/${absolutePath}`}`;
  return simproGet(config, url, options);
}

export async function simproGetFirstOk(
  config: ResolvedSimproDirectConfig,
  paths: string[],
  options?: SimproClientOptions,
) {
  const attempts: Array<{ path: string; status: number; endpoint: string }> = [];
  for (const path of paths) {
    const result = await simproGet(config, path, options);
    attempts.push({ path, status: result.status, endpoint: result.endpoint });
    if (result.ok) return { ...result, attempts };
  }
  return {
    endpoint: attempts[attempts.length - 1]?.endpoint ?? "",
    status: attempts[attempts.length - 1]?.status ?? 0,
    ok: false as const,
    body: null,
    headers: {},
    attempts,
  };
}

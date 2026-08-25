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
  /** Override company path segment (multi-company builds). */
  companyId?: string;
  /** Hard timeout per attempt (default 30s). */
  timeoutMs?: number;
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

export function withSimproCompany(
  config: ResolvedSimproDirectConfig,
  companyId: string,
): ResolvedSimproDirectConfig {
  return companyId && companyId !== config.companyId ? { ...config, companyId } : config;
}

/** OpenAPI uses /quotes/{id} with no trailing slash; some builds 404 on /quotes/{id}/. */
export function simproEntityDetailPaths(entity: "quotes" | "jobs", externalId: string) {
  const id = String(externalId || "").trim();
  return [
    `/${entity}/${id}?display=all`,
    `/${entity}/${id}`,
    `/${entity}/${id}/?display=all`,
    `/${entity}/${id}/`,
  ];
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
  const companyId = options.companyId ?? config.companyId;
  const endpoint = path.startsWith("http")
    ? path
    : `${config.baseUrl}/companies/${companyId}${path.startsWith("/") ? path : `/${path}`}`;

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
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
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

let cachedCompanyIds: string[] | null = null;

export function clearSimproCompanyIdCache() {
  cachedCompanyIds = null;
}

export async function listSimproCompanyIds(config: ResolvedSimproDirectConfig) {
  if (cachedCompanyIds?.length) return cachedCompanyIds;
  const result = await simproGetAbsolute(config, "/api/v1.0/companies/", { maxRetries: 1 });
  const ids = result.ok
    ? extractSimproRecords(result.body)
        .map((record) => simproRecordId(record))
        .filter(Boolean)
    : [];
  const ordered = [config.companyId, ...ids.filter((id) => id !== config.companyId)].slice(0, 6);
  cachedCompanyIds = ordered.length ? ordered : [config.companyId];
  return cachedCompanyIds;
}

/**
 * Retrieve quote/job detail. Handles:
 * - trailing-slash vs no-slash path differences
 * - multi-company builds where list on company 0 returns IDs that 404 until the real company is used
 */
export async function simproGetEntityDetail(
  config: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  externalId: string,
  options?: SimproClientOptions,
) {
  const id = String(externalId || "").trim();
  if (!id) {
    return {
      endpoint: "",
      status: 0,
      ok: false as const,
      body: null,
      headers: {},
      attempts: [] as Array<{ path: string; status: number; endpoint: string; companyId: string }>,
      companyId: config.companyId,
    };
  }

  const paths = simproEntityDetailPaths(entity, id);
  const attempts: Array<{ path: string; status: number; endpoint: string; companyId: string }> = [];
  const companyIds = await listSimproCompanyIds(config);

  for (const companyId of companyIds) {
    for (const path of paths) {
      const result = await simproGet(config, path, { ...options, companyId, maxRetries: options?.maxRetries ?? 2 });
      attempts.push({ path, status: result.status, endpoint: result.endpoint, companyId });
      if (result.ok) {
        return { ...result, attempts, companyId };
      }
      // Auth failures won't recover on another path/company.
      if (result.status === 401 || result.status === 403) {
        return { ...result, ok: false as const, body: null, attempts, companyId };
      }
    }
  }

  // Last resort: list filter by ID (some builds still return the row even when detail 404s).
  // CRITICAL: never take records[0] — unfiltered lists would stamp every quote with the same customer.
  for (const companyId of companyIds) {
    const listPaths = [
      `/${entity}/?pageSize=25&ID=${encodeURIComponent(id)}&columns=ID,Name,Description,Customer,Site,Total,Status,Stage`,
      `/${entity}/?pageSize=25&ID=${encodeURIComponent(id)}`,
      `/${entity}/?pageSize=25&search=all&ID=${encodeURIComponent(id)}`,
    ];
    for (const path of listPaths) {
      const listed = await simproGet(config, path, { companyId, maxRetries: 1 });
      attempts.push({ path, status: listed.status, endpoint: listed.endpoint, companyId });
      if (!listed.ok) continue;
      const match = extractSimproRecords(listed.body).find((record) => simproRecordId(record) === id);
      if (match) {
        return {
          endpoint: listed.endpoint,
          status: 200,
          ok: true as const,
          body: match,
          headers: listed.headers,
          attempts,
          companyId,
        };
      }
    }
  }

  return {
    endpoint: attempts[attempts.length - 1]?.endpoint ?? "",
    status: attempts[attempts.length - 1]?.status ?? 0,
    ok: false as const,
    body: null,
    headers: {},
    attempts,
    companyId: config.companyId,
  };
}

/** Customer detail paths — prefer no trailing slash (same quirk as quotes). */
export function simproCustomerDetailPaths(customerId: string) {
  const id = String(customerId || "").trim();
  return [
    `/customers/${id}?display=all`,
    `/customers/companies/${id}?display=all`,
    `/customers/individuals/${id}?display=all`,
    `/customers/${id}`,
    `/customers/${id}/?display=all`,
    `/customers/companies/${id}/?display=all`,
    `/customers/individuals/${id}/?display=all`,
  ];
}

/**
 * Retrieve a customer by ID across path variants and companies.
 * Does not invent a match from an unrelated list row.
 */
export async function simproGetCustomerDetail(
  config: ResolvedSimproDirectConfig,
  customerId: string,
  options?: SimproClientOptions,
) {
  const id = String(customerId || "").trim();
  if (!id) {
    return {
      endpoint: "",
      status: 0,
      ok: false as const,
      body: null,
      headers: {},
      attempts: [] as Array<{ path: string; status: number; endpoint: string; companyId: string }>,
      companyId: config.companyId,
    };
  }

  const paths = simproCustomerDetailPaths(id);
  const attempts: Array<{ path: string; status: number; endpoint: string; companyId: string }> = [];
  const companyIds = await listSimproCompanyIds(config);

  for (const companyId of companyIds) {
    const pathsForCompany =
      companyId === config.companyId
        ? paths
        : paths.slice(0, 3);
    for (const path of pathsForCompany) {
      const result = await simproGet(config, path, { ...options, companyId, maxRetries: options?.maxRetries ?? 1 });
      attempts.push({ path, status: result.status, endpoint: result.endpoint, companyId });
      if (result.ok) {
        const record = asRecord(result.body);
        const returnedId = simproRecordId(record);
        // Reject wrong-body matches (mirrors quote list-filter exact-ID rule).
        if (record && (!returnedId || returnedId === id)) {
          return { ...result, attempts, companyId };
        }
      }
      if (result.status === 401 || result.status === 403) {
        return { ...result, ok: false as const, body: null, attempts, companyId };
      }
    }
  }

  return {
    endpoint: attempts[attempts.length - 1]?.endpoint ?? "",
    status: attempts[attempts.length - 1]?.status ?? 0,
    ok: false as const,
    body: null,
    headers: {},
    attempts,
    companyId: config.companyId,
  };
}

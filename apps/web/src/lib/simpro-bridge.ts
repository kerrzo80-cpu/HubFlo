import { appendAuditEvent, getClientSites, getClients, type AuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { getQuotes, updateQuote, type Quote } from "@/lib/workflow-data";

type UnknownRecord = Record<string, unknown>;

type QuoteCostLineInput = {
  id?: unknown;
  catalogItemId?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitCost?: unknown;
  unitSell?: unknown;
  supplierRequired?: unknown;
};

type QuoteCostCentreInput = {
  id?: unknown;
  name?: unknown;
  templateName?: unknown;
  clientDescription?: unknown;
  engineerDescription?: unknown;
  lines?: unknown;
};

export type SimproQuoteExportLine = {
  id: string;
  costCentreId: string;
  costCentreName: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell: number;
  totalCost: number;
  totalSell: number;
  supplierRequired: boolean;
  catalogItemId?: string;
};

export type SimproQuoteExportPayload = {
  source: "nexa-pilot";
  createdAt: string;
  quote: {
    id: string;
    ref: string;
    status: Quote["status"];
    description: string;
    owner: string;
    value: number;
    due: string;
  };
  customer: {
    id?: string;
    name: string;
    email?: string;
    phone?: string;
  };
  site: {
    id?: string;
    name?: string;
    address?: string;
  };
  costCentres: Array<{
    id: string;
    name: string;
    templateName?: string;
    clientDescription?: string;
    engineerDescription?: string;
    lines: SimproQuoteExportLine[];
  }>;
  totals: {
    cost: number;
    sell: number;
    profit: number;
  };
};

type SimproQuoteExportCostCentre = SimproQuoteExportPayload["costCentres"][number];

export type SimproQuoteExportRecord = {
  id: string;
  quoteId: string;
  quoteRef: string;
  createdAt: string;
  actor: string;
  status: "Queued" | "Sent" | "Failed";
  mode: "manual" | "webhook" | "scheduler" | "direct";
  simproQuoteId?: string;
  endpoint?: string;
  setupRequired?: string;
  error?: string;
  payload: SimproQuoteExportPayload;
};

export type SimproPushResult = {
  quote: Quote;
  exportRecord: SimproQuoteExportRecord;
  auditEvent: AuditEvent;
};

export type SimproBridgeStatus = {
  configured: boolean;
  mode: "webhook" | "scheduler" | "direct" | "missing";
  missing: string[];
  endpoint?: string;
  detectedEnvKeys: string[];
  sourceNames?: {
    webhookUrl?: string;
    schedulerUrl?: string;
    schedulerPassword?: string;
    directBaseUrl?: string;
    directToken?: string;
    companyId?: string;
  };
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asIdentifier(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asBoolean(value: unknown) {
  return value === true;
}

function envFirst(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }

  return null;
}

function detectedSimproEnvKeys() {
  return Object.keys(process.env)
    .filter((key) => key.startsWith("SIMPRO_"))
    .sort();
}

function cleanEndpoint(value?: string) {
  return value?.trim().replace(/\/+$/, "");
}

function getBridgeEndpoint() {
  return cleanEndpoint(process.env.SIMPRO_QUOTE_PUSH_URL);
}

function getSchedulerConfig() {
  const quoteUrl = envFirst(["SIMPRO_SCHEDULER_QUOTE_PUSH_URL", "SIMPRO_SCHEDULER_QUOTE_URL"]);
  const base = envFirst(["SIMPRO_SCHEDULER_BASE_URL", "SCHEDULER_BASE_URL"]);
  const password = envFirst(["SIMPRO_SCHEDULER_HUB_PASSWORD", "SCHEDULER_HUB_PASSWORD"]);
  const endpoint = cleanEndpoint(quoteUrl?.value) ?? (base ? `${cleanEndpoint(base.value)}/api/hub/simpro/quote` : undefined);
  const hasAnyConfig = Boolean(quoteUrl || base || password);
  const missing = [
    !endpoint ? "SIMPRO_SCHEDULER_QUOTE_PUSH_URL or SIMPRO_SCHEDULER_BASE_URL" : null,
    !password ? "SIMPRO_SCHEDULER_HUB_PASSWORD" : null,
  ].filter((item): item is string => Boolean(item));

  if (missing.length > 0 || !endpoint || !password) {
    return {
      configured: false as const,
      hasAnyConfig,
      missing,
      endpoint,
      password: undefined,
      sourceNames: {
        schedulerUrl: quoteUrl?.name ?? base?.name,
        schedulerPassword: password?.name,
      },
    };
  }

  return {
    configured: true as const,
    hasAnyConfig,
    missing: [],
    endpoint,
    password: password.value,
    sourceNames: {
      schedulerUrl: quoteUrl?.name ?? base?.name,
      schedulerPassword: password.name,
    },
  };
}

function normaliseBaseUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const cleaned = cleanEndpoint(withProtocol) ?? "";
  return cleaned.endsWith("/api/v1.0") ? cleaned : `${cleaned}/api/v1.0`;
}

function getDirectConfig() {
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
  const token = envFirst([
    "SIMPRO_API_KEY",
    "SIMPRO_ACCESS_TOKEN",
    "SIMPRO_API_TOKEN",
    "SIMPRO_TOKEN",
    "SIMPRO_OAUTH_ACCESS_TOKEN",
    "SIMPRO_BEARER_TOKEN",
  ]);
  const companyId = envFirst(["SIMPRO_COMPANY_ID", "SIMPRO_COMPANY", "SIMPRO_COMPANY_NUMBER", "SIMPRO_COMPANYID"]);
  const missing = [
    !base ? "SIMPRO_API_BASE_URL / SIMPRO_BUILD_URL / SIMPRO_URL" : null,
    !token ? "SIMPRO_API_KEY / SIMPRO_ACCESS_TOKEN / SIMPRO_TOKEN" : null,
    !companyId ? "SIMPRO_COMPANY_ID / SIMPRO_COMPANY" : null,
  ].filter((item): item is string => Boolean(item));

  if (missing.length > 0 || !base || !token || !companyId) {
    return {
      configured: false as const,
      missing,
      baseUrl: undefined,
      token: undefined,
      companyId: undefined,
      sourceNames: {
        baseUrl: base?.name,
        token: token?.name,
        companyId: companyId?.name,
      },
    };
  }

  return {
    configured: true as const,
    missing: [],
    baseUrl: normaliseBaseUrl(base.value),
    token: token.value,
    companyId: companyId.value,
    sourceNames: {
      baseUrl: base.name,
      token: token.name,
      companyId: companyId.name,
    },
  };
}

export function getSimproBridgeStatus(): SimproBridgeStatus {
  const endpoint = getBridgeEndpoint();
  const detectedEnvKeys = detectedSimproEnvKeys();

  if (endpoint) {
    return {
      configured: true,
      mode: "webhook",
      missing: [],
      endpoint,
      detectedEnvKeys,
      sourceNames: {
        webhookUrl: "SIMPRO_QUOTE_PUSH_URL",
      },
    };
  }

  const scheduler = getSchedulerConfig();
  if (scheduler.configured) {
    return {
      configured: true,
      mode: "scheduler",
      missing: [],
      endpoint: scheduler.endpoint,
      detectedEnvKeys,
      sourceNames: {
        schedulerUrl: scheduler.sourceNames.schedulerUrl,
        schedulerPassword: scheduler.sourceNames.schedulerPassword,
      },
    };
  }

  if (scheduler.hasAnyConfig) {
    return {
      configured: false,
      mode: "missing",
      missing: scheduler.missing,
      endpoint: scheduler.endpoint,
      detectedEnvKeys,
      sourceNames: {
        schedulerUrl: scheduler.sourceNames.schedulerUrl,
        schedulerPassword: scheduler.sourceNames.schedulerPassword,
      },
    };
  }

  const direct = getDirectConfig();
  if (direct.configured) {
    return {
      configured: true,
      mode: "direct",
      missing: [],
      endpoint: `${direct.baseUrl}/companies/${direct.companyId}/quotes/`,
      detectedEnvKeys,
      sourceNames: {
        directBaseUrl: direct.sourceNames.baseUrl,
        directToken: direct.sourceNames.token,
        companyId: direct.sourceNames.companyId,
      },
    };
  }

  return {
    configured: false,
    mode: "missing",
    missing: ["SIMPRO_QUOTE_PUSH_URL or SIMPRO_SCHEDULER_QUOTE_PUSH_URL", ...direct.missing],
    detectedEnvKeys,
    sourceNames: {
      directBaseUrl: direct.sourceNames.baseUrl,
      directToken: direct.sourceNames.token,
      companyId: direct.sourceNames.companyId,
    },
  };
}

function normaliseCostLine(
  line: QuoteCostLineInput,
  centreId: string,
  centreName: string,
): SimproQuoteExportLine {
  const quantity = asNumber(line.quantity, 0);
  const unitCost = asNumber(line.unitCost, 0);
  const unitSell = asNumber(line.unitSell, 0);

  return {
    id: asString(line.id, crypto.randomUUID()),
    catalogItemId: asString(line.catalogItemId) || undefined,
    costCentreId: centreId,
    costCentreName: centreName,
    description: asString(line.description, "Quote line to confirm"),
    quantity,
    unitCost,
    unitSell,
    totalCost: Math.round(quantity * unitCost * 100) / 100,
    totalSell: Math.round(quantity * unitSell * 100) / 100,
    supplierRequired: asBoolean(line.supplierRequired),
  };
}

function normaliseCostCentres(input: unknown): SimproQuoteExportPayload["costCentres"] {
  if (!Array.isArray(input)) return [];

  const centres: SimproQuoteExportCostCentre[] = [];
  input.forEach((item, index) => {
    const centre = asRecord(item);
    if (!centre) return;

    const id = asString(centre.id, `cost-centre-${index + 1}`);
    const name = asString(centre.name, `Cost centre ${index + 1}`);
    const lines = Array.isArray(centre.lines)
      ? centre.lines
        .map((line) => asRecord(line))
        .filter((line): line is QuoteCostLineInput => Boolean(line))
        .map((line) => normaliseCostLine(line, id, name))
      : [];

    centres.push({
      id,
      name,
      templateName: asString(centre.templateName) || undefined,
      clientDescription: asString(centre.clientDescription) || undefined,
      engineerDescription: asString(centre.engineerDescription) || undefined,
      lines,
    });
  });

  return centres;
}

function quoteCostCentresFromHubState(quoteId: string) {
  const hubState = getHubDetailState();
  const centresByQuote = asRecord(hubState.quoteCostCentres);
  return centresByQuote?.[quoteId];
}

function buildPayload(quote: Quote, costCentresInput?: unknown): SimproQuoteExportPayload {
  const clients = getClients();
  const sites = getClientSites();
  const client = clients.find((item) => item.id === quote.clientId || item.name === quote.customer);
  const site = sites.find((item) => item.id === quote.siteId || item.clientId === client?.id);
  const costCentres = normaliseCostCentres(costCentresInput ?? quoteCostCentresFromHubState(quote.id));
  const lines = costCentres.flatMap((centre) => centre.lines);
  const cost = Math.round(lines.reduce((sum, line) => sum + line.totalCost, 0) * 100) / 100;
  const sell = Math.round((lines.reduce((sum, line) => sum + line.totalSell, 0) || quote.value) * 100) / 100;

  return {
    source: "nexa-pilot",
    createdAt: new Date().toISOString(),
    quote: {
      id: quote.id,
      ref: quote.ref,
      status: quote.status,
      description: quote.description,
      owner: quote.owner,
      value: sell,
      due: quote.due,
    },
    customer: {
      id: client?.id ?? quote.clientId,
      name: client?.name ?? quote.customer,
      email: client?.email,
      phone: client?.phone,
    },
    site: {
      id: site?.id ?? quote.siteId,
      name: site?.name,
      address: site?.address,
    },
    costCentres,
    totals: {
      cost,
      sell,
      profit: Math.round((sell - cost) * 100) / 100,
    },
  };
}

async function postToWebhook(payload: SimproQuoteExportPayload) {
  const endpoint = getBridgeEndpoint();
  if (!endpoint) return null;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SIMPRO_QUOTE_PUSH_TOKEN
        ? { Authorization: `Bearer ${process.env.SIMPRO_QUOTE_PUSH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const message = asString(body.error) || asString(body.message) || `Webhook returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    endpoint,
    simproQuoteId: asString(body.simproQuoteId) || asString(body.quoteId) || asString(body.id) || undefined,
  };
}

function schedulerBaseFromEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function cookieHeaderFromResponse(response: Response) {
  const headersWithGetSetCookie = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookieHeaders = headersWithGetSetCookie.getSetCookie?.() ?? [];
  const fallbackCookie = response.headers.get("set-cookie");
  const cookies = (setCookieHeaders.length > 0 ? setCookieHeaders : fallbackCookie ? [fallbackCookie] : [])
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.join("; ");
}

async function postToSchedulerBridge(payload: SimproQuoteExportPayload) {
  const scheduler = getSchedulerConfig();
  if (!scheduler.configured) return null;

  const baseUrl = schedulerBaseFromEndpoint(scheduler.endpoint);
  if (!baseUrl) throw new Error("Scheduler bridge URL is invalid.");

  const loginResponse = await fetch(`${baseUrl}/hub/login?next=/hub/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ password: scheduler.password }).toString(),
  });
  const cookieHeader = cookieHeaderFromResponse(loginResponse);
  if (!cookieHeader) {
    throw new Error("Scheduler bridge login failed. Check SIMPRO_SCHEDULER_HUB_PASSWORD.");
  }

  const response = await fetch(scheduler.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const message = asString(body.error) || asString(body.message) || `Scheduler Simpro bridge returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    endpoint: scheduler.endpoint,
    simproQuoteId:
      asString(body.simproQuoteId) ||
      asString(body.quoteId) ||
      asString(body.id) ||
      asString(asRecord(body.quote)?.id) ||
      undefined,
  };
}

function numericId(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildSimproQuoteDescription(payload: SimproQuoteExportPayload) {
  const costCentreLines = payload.costCentres.flatMap((centre) => {
    const heading = [`Cost centre: ${centre.name}`];
    if (centre.clientDescription) heading.push(`Client description: ${centre.clientDescription}`);
    const lines = centre.lines.map((line) =>
      `- ${line.description}: qty ${line.quantity}, cost £${line.unitCost.toFixed(2)}, sell £${line.unitSell.toFixed(2)}`,
    );
    return [...heading, ...lines, ""];
  });

  return [
    `Created from NeXa quote ${payload.quote.ref}`,
    payload.quote.description,
    "",
    `Customer: ${payload.customer.name}`,
    payload.site.address ? `Site: ${payload.site.address}` : null,
    "",
    `Totals: cost £${payload.totals.cost.toFixed(2)} / sell £${payload.totals.sell.toFixed(2)} / profit £${payload.totals.profit.toFixed(2)}`,
    "",
    ...costCentreLines,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildDirectQuoteBody(payload: SimproQuoteExportPayload) {
  const customerId =
    numericId(payload.customer.id) ?? numericId(process.env.SIMPRO_DEFAULT_CUSTOMER_ID ?? process.env.SIMPRO_CUSTOMER_ID);
  const siteId = numericId(payload.site.id) ?? numericId(process.env.SIMPRO_DEFAULT_SITE_ID ?? process.env.SIMPRO_SITE_ID);
  const body: UnknownRecord = {
    Name: `${payload.quote.ref} - ${payload.quote.description}`.slice(0, 120),
    Description: buildSimproQuoteDescription(payload),
  };

  if (customerId) body.Customer = customerId;
  if (siteId) body.Site = siteId;

  return body;
}

async function postToDirectSimpro(payload: SimproQuoteExportPayload) {
  const direct = getDirectConfig();
  if (!direct.configured) return null;

  const endpoint = `${direct.baseUrl}/companies/${direct.companyId}/quotes/`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${direct.token}`,
    },
    body: JSON.stringify(buildDirectQuoteBody(payload)),
  });

  const body = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const errors = Array.isArray(body.errors) ? body.errors.join("; ") : "";
    const returnedMessage = asString(body.error) || asString(body.message) || errors;
    const message = response.status === 401
      ? `Simpro rejected the access token or company permission (HTTP 401). Check SIMPRO_ACCESS_TOKEN is current and authorised for company ${direct.companyId}.`
      : returnedMessage || `Simpro returned HTTP ${response.status} from ${endpoint}`;
    throw new Error(message);
  }

  return {
    endpoint,
    simproQuoteId: asIdentifier(body.ID) ?? asIdentifier(body.id) ?? asIdentifier(body.quoteId) ?? asIdentifier(body.simproQuoteId),
  };
}

function saveExportRecord(record: SimproQuoteExportRecord) {
  const state = getHubDetailState();
  const current = Array.isArray(state.simproExports) ? state.simproExports : [];
  saveHubDetailState({
    ...state,
    simproExports: [record, ...current.filter((item) => asRecord(item)?.id !== record.id)].slice(0, 100),
  });
}

export async function pushQuoteToSimpro(
  quoteId: string,
  options: {
    actor?: string;
    costCentres?: unknown;
  } = {},
): Promise<SimproPushResult | null> {
  const quote = getQuotes().find((item) => item.id === quoteId || item.ref === quoteId);
  if (!quote) return null;

  const actor = options.actor?.trim() || "NeXa user";
  const payload = buildPayload(quote, options.costCentres);
  const exportRecord: SimproQuoteExportRecord = {
    id: `simpro-export-${crypto.randomUUID()}`,
    quoteId: quote.id,
    quoteRef: quote.ref,
    createdAt: payload.createdAt,
    actor,
    status: "Queued",
    mode: "manual",
    payload,
  };

  const bridgeStatus = getSimproBridgeStatus();

  if (!bridgeStatus.configured) {
    exportRecord.setupRequired = bridgeStatus.missing.join(", ");
  } else {
    const sendMode = bridgeStatus.mode === "direct" ? "direct" : bridgeStatus.mode === "scheduler" ? "scheduler" : "webhook";
    try {
      const sendResult =
        sendMode === "direct"
          ? await postToDirectSimpro(payload)
          : sendMode === "scheduler"
            ? await postToSchedulerBridge(payload)
            : await postToWebhook(payload);

      if (sendResult) {
        exportRecord.status = "Sent";
        exportRecord.mode = sendMode;
        exportRecord.endpoint = sendResult.endpoint;
        exportRecord.simproQuoteId = sendResult.simproQuoteId;
      }
    } catch (error) {
      exportRecord.status = "Failed";
      exportRecord.mode = sendMode;
      exportRecord.error = error instanceof Error ? error.message : "Unable to send to Simpro bridge";
    }
  }

  saveExportRecord(exportRecord);

  const updatedQuote = updateQuote(quote.id, {
    value: payload.totals.sell,
    next: exportRecord.status === "Sent"
      ? `Sent to Simpro${exportRecord.simproQuoteId ? ` as ${exportRecord.simproQuoteId}` : ""}`
      : exportRecord.status === "Failed"
        ? "Simpro handoff failed - review bridge settings"
        : "Queued in NeXa - Simpro bridge not configured",
    simproQuoteId: exportRecord.simproQuoteId,
    simproStatus: exportRecord.status,
    simproSentAt: exportRecord.createdAt,
  }) ?? quote;

  const auditEvent = appendAuditEvent({
    actor,
    action: exportRecord.status === "Sent" ? "sent" : exportRecord.status === "Failed" ? "failed" : "queued",
    recordType: "quote",
    recordId: quote.id,
    summary: exportRecord.status === "Sent"
      ? `${quote.ref} sent to Simpro ${exportRecord.mode === "direct" ? "API" : "bridge"}${exportRecord.simproQuoteId ? ` as ${exportRecord.simproQuoteId}` : ""}.`
      : exportRecord.status === "Failed"
        ? `${quote.ref} could not be sent to Simpro bridge: ${exportRecord.error}.`
        : `${quote.ref} saved in the NeXa Simpro queue. It has not been sent to Simpro yet because ${exportRecord.setupRequired ?? "Simpro connection settings"} are not configured.`,
    source: "simpro bridge",
    importance: exportRecord.status === "Failed" ? "high" : "normal",
  });

  return {
    quote: updatedQuote,
    exportRecord,
    auditEvent,
  };
}

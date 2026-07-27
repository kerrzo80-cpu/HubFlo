import { appendAuditEvent, getClientSites, getClients, type AuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { getSimproDirectConfigStatus, resolveSimproDirectConfig } from "@/lib/simpro-auth";
import { getJobs, getQuotes, updateJob, updateQuote, type Job, type Quote } from "@/lib/workflow-data";

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

type JobScheduleAssignmentInput = {
  id?: unknown;
  employeeId?: unknown;
  employeeName?: unknown;
  startDate?: unknown;
  startTime?: unknown;
  endDate?: unknown;
  endTime?: unknown;
  plannedHours?: unknown;
  notes?: unknown;
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

export type SimproJobExportPayload = {
  source: "nexa-pilot";
  createdAt: string;
  job: {
    id: string;
    ref: string;
    status: Job["status"];
    description: string;
    manager: string;
    value: number;
    due: string;
    sourceQuoteRef?: string;
    simproJobId?: string;
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
  schedule: Array<{
    id: string;
    employeeId?: string;
    employeeName: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    plannedHours: number;
    notes?: string;
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
  entityType: "quote" | "job";
  recordId: string;
  recordRef: string;
  quoteId: string;
  quoteRef: string;
  jobId?: string;
  jobRef?: string;
  createdAt: string;
  actor: string;
  status: "Queued" | "Sent" | "Failed";
  mode: "manual" | "webhook" | "scheduler" | "direct";
  simproQuoteId?: string;
  simproJobId?: string;
  endpoint?: string;
  setupRequired?: string;
  error?: string;
  payload: SimproQuoteExportPayload | SimproJobExportPayload;
};

export type SimproPushResult = {
  quote: Quote;
  exportRecord: SimproQuoteExportRecord;
  auditEvent: AuditEvent;
};

export type SimproJobPushResult = {
  job: Job;
  exportRecord: SimproQuoteExportRecord;
  auditEvent: AuditEvent;
};

export type SimproBridgeStatus = {
  configured: boolean;
  mode: "webhook" | "scheduler" | "direct" | "missing";
  missing: string[];
  endpoint?: string;
  guidance: string;
  quotePushReady: boolean;
  jobPushReady: boolean;
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

export type SimproOutboundTestResult = {
  ok: boolean;
  mode: SimproBridgeStatus["mode"];
  message: string;
  endpoint?: string;
  checkedAt: string;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

/** Turn Simpro/API error payloads into a readable banner string (never "[object Object]"). */
function formatSimproErrorValue(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (depth > 3) return "";

  if (Array.isArray(value)) {
    return value
      .map((item) => formatSimproErrorValue(item, depth + 1))
      .filter(Boolean)
      .join("; ");
  }

  const record = asRecord(value);
  if (!record) return "";

  const message = asString(record.message)
    || asString(record.error)
    || asString(record.detail)
    || asString(record.title)
    || asString(record.msg)
    || formatSimproErrorValue(record.errors, depth + 1);

  const path = asString(record.path)
    || asString(record.field)
    || asString(record.property)
    || asString(record.name);

  if (message && path) return `${path}: ${message}`;
  if (message) return message;
  if (path) return path;

  try {
    const json = JSON.stringify(record);
    return json && json !== "{}" ? json : "";
  } catch {
    return "";
  }
}

function simproHttpErrorMessage(body: UnknownRecord, status: number, endpoint: string) {
  const returnedMessage = formatSimproErrorValue(body.error)
    || formatSimproErrorValue(body.message)
    || formatSimproErrorValue(body.errors)
    || formatSimproErrorValue(body);
  return returnedMessage || `Simpro returned HTTP ${status} from ${endpoint}`;
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

function getSchedulerConfig(entity: "quote" | "job" = "quote") {
  const schedulerUrlEnvNames =
    entity === "job"
      ? ["SIMPRO_SCHEDULER_JOB_PUSH_URL", "SIMPRO_SCHEDULER_JOB_URL"]
      : ["SIMPRO_SCHEDULER_QUOTE_PUSH_URL", "SIMPRO_SCHEDULER_QUOTE_URL"];
  const quoteUrl = envFirst(schedulerUrlEnvNames);
  const base = envFirst(["SIMPRO_SCHEDULER_BASE_URL", "SCHEDULER_BASE_URL"]);
  const password = envFirst(["SIMPRO_SCHEDULER_HUB_PASSWORD", "SCHEDULER_HUB_PASSWORD"]);
  const endpoint =
    cleanEndpoint(quoteUrl?.value) ??
    (base ? `${cleanEndpoint(base.value)}/api/hub/simpro/${entity === "job" ? "job" : "quote"}` : undefined);
  const hasAnyConfig = Boolean(quoteUrl || base || password);
  const missing = [
    !endpoint
      ? entity === "job"
        ? "SIMPRO_SCHEDULER_JOB_PUSH_URL or SIMPRO_SCHEDULER_BASE_URL"
        : "SIMPRO_SCHEDULER_QUOTE_PUSH_URL or SIMPRO_SCHEDULER_BASE_URL"
      : null,
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

export function getSimproBridgeStatus(): SimproBridgeStatus {
  const endpoint = getBridgeEndpoint();
  const detectedEnvKeys = detectedSimproEnvKeys();
  const schedulerQuote = getSchedulerConfig("quote");
  const schedulerJob = getSchedulerConfig("job");
  const direct = getSimproDirectConfigStatus();

  if (endpoint) {
    return {
      configured: true,
      mode: "webhook",
      missing: [],
      endpoint,
      guidance: "Quotes and jobs will POST to the configured webhook bridge.",
      quotePushReady: true,
      jobPushReady: true,
      detectedEnvKeys,
      sourceNames: {
        webhookUrl: "SIMPRO_QUOTE_PUSH_URL",
      },
    };
  }

  if (schedulerQuote.configured) {
    return {
      configured: true,
      mode: "scheduler",
      missing: schedulerJob.configured ? [] : schedulerJob.missing,
      endpoint: schedulerQuote.endpoint,
      guidance: schedulerJob.configured
        ? "Quotes and jobs will push through the HUB scheduler bridge into simPRO."
        : `Quotes can push through the scheduler. Jobs still need ${schedulerJob.missing.join(", ")}.`,
      quotePushReady: true,
      jobPushReady: schedulerJob.configured,
      detectedEnvKeys,
      sourceNames: {
        schedulerUrl: schedulerQuote.sourceNames.schedulerUrl,
        schedulerPassword: schedulerQuote.sourceNames.schedulerPassword,
      },
    };
  }

  if (direct.configured) {
    return {
      configured: true,
      mode: "direct",
      missing: [],
      endpoint: `${direct.baseUrl}/companies/${direct.companyId}/quotes/`,
      guidance: "NeXa will create quotes and jobs directly in simPRO using the OAuth connection. Keep Setup on One-way push while simPRO remains the downstream system.",
      quotePushReady: true,
      jobPushReady: true,
      detectedEnvKeys,
      sourceNames: {
        directBaseUrl: direct.sourceNames.baseUrl,
        directToken: direct.sourceNames.token,
        companyId: direct.sourceNames.companyId,
      },
    };
  }

  const missing = [
    ...(schedulerQuote.hasAnyConfig ? schedulerQuote.missing : []),
    ...direct.missing,
  ];
  const uniqueMissing = [...new Set(missing.length
    ? missing
    : [
        "SIMPRO_BASE_URL (or SIMPRO_API_BASE_URL)",
        "SIMPRO_COMPANY_ID",
        "SIMPRO_CLIENT_ID / SIMPRO_CLIENT_SECRET / SIMPRO_REFRESH_TOKEN",
      ])];

  return {
    configured: false,
    mode: "missing",
    missing: uniqueMissing,
    endpoint: schedulerQuote.endpoint ?? direct.baseUrl,
    guidance: "Add the simPRO OAuth variables in Render (preferred), or the scheduler bridge password and base URL, then use Test connection.",
    quotePushReady: false,
    jobPushReady: false,
    detectedEnvKeys,
    sourceNames: {
      schedulerUrl: schedulerQuote.sourceNames.schedulerUrl,
      schedulerPassword: schedulerQuote.sourceNames.schedulerPassword,
      directBaseUrl: direct.sourceNames.baseUrl,
      directToken: direct.sourceNames.token,
      companyId: direct.sourceNames.companyId,
    },
  };
}

export async function testSimproOutboundBridge(): Promise<SimproOutboundTestResult> {
  const status = getSimproBridgeStatus();
  const checkedAt = new Date().toISOString();

  if (!status.configured) {
    return {
      ok: false,
      mode: status.mode,
      message: `simPRO outbound push is not configured. Missing: ${status.missing.join(", ")}.`,
      endpoint: status.endpoint,
      checkedAt,
    };
  }

  if (status.mode === "direct") {
    const config = await resolveSimproDirectConfig();
    const endpoint = `${config.baseUrl}/companies/${config.companyId}/customers/?pageSize=1`;
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as UnknownRecord | null;
    if (!response.ok) {
      throw new Error(
        asString(body?.error) ||
          asString(body?.message) ||
          `simPRO returned HTTP ${response.status} while testing the direct connection.`,
      );
    }
    return {
      ok: true,
      mode: "direct",
      message: `Direct simPRO connection verified for company ${config.companyId}. Quote Send and job push are ready.`,
      endpoint,
      checkedAt,
    };
  }

  if (status.mode === "scheduler") {
    const scheduler = getSchedulerConfig("quote");
    if (!scheduler.configured) {
      return {
        ok: false,
        mode: "scheduler",
        message: `Scheduler bridge incomplete: ${scheduler.missing.join(", ")}.`,
        checkedAt,
      };
    }
    const baseUrl = schedulerBaseFromEndpoint(scheduler.endpoint);
    const loginResponse = await fetch(`${baseUrl}/hub/login?next=/hub/`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: scheduler.password }).toString(),
    });
    const cookieHeader = cookieHeaderFromResponse(loginResponse);
    if (!cookieHeader) {
      throw new Error("Scheduler bridge login failed. Check SIMPRO_SCHEDULER_HUB_PASSWORD.");
    }
    return {
      ok: true,
      mode: "scheduler",
      message: "HUB scheduler bridge login succeeded. Quotes can be pushed through the temporary bridge.",
      endpoint: scheduler.endpoint,
      checkedAt,
    };
  }

  return {
    ok: true,
    mode: status.mode,
    message: `Outbound webhook bridge is configured at ${status.endpoint}.`,
    endpoint: status.endpoint,
    checkedAt,
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

function jobCostCentresFromHubState(jobId: string) {
  const hubState = getHubDetailState();
  const centresByJob = asRecord(hubState.jobCostCentres);
  return centresByJob?.[jobId];
}

function normaliseJobSchedule(input: unknown): SimproJobExportPayload["schedule"] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => asRecord(item))
    .filter((item): item is JobScheduleAssignmentInput => Boolean(item))
    .map((assignment, index) => ({
      id: asString(assignment.id, `schedule-${index + 1}`),
      employeeId: asString(assignment.employeeId) || undefined,
      employeeName: asString(assignment.employeeName, "Engineer to confirm"),
      startDate: asString(assignment.startDate),
      startTime: asString(assignment.startTime),
      endDate: asString(assignment.endDate),
      endTime: asString(assignment.endTime),
      plannedHours: asNumber(assignment.plannedHours, 0),
      notes: asString(assignment.notes) || undefined,
    }))
    .filter((assignment) => Boolean(assignment.startDate && assignment.startTime && assignment.endDate && assignment.endTime));
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

function buildJobPayload(
  job: Job,
  options: {
    costCentres?: unknown;
    schedule?: unknown;
  } = {},
): SimproJobExportPayload {
  const clients = getClients();
  const sites = getClientSites();
  const client = clients.find((item) => item.id === job.clientId || item.name === job.customer);
  const site = sites.find((item) => item.id === job.siteId || item.clientId === client?.id);
  const costCentres = normaliseCostCentres(options.costCentres ?? jobCostCentresFromHubState(job.id));
  const schedule = normaliseJobSchedule(options.schedule);
  const lines = costCentres.flatMap((centre) => centre.lines);
  const cost = Math.round(lines.reduce((sum, line) => sum + line.totalCost, 0) * 100) / 100;
  const sell = Math.round((lines.reduce((sum, line) => sum + line.totalSell, 0) || job.value) * 100) / 100;

  return {
    source: "nexa-pilot",
    createdAt: new Date().toISOString(),
    job: {
      id: job.id,
      ref: job.ref,
      status: job.status,
      description: job.description,
      manager: job.manager,
      value: sell,
      due: job.due,
      sourceQuoteRef: job.sourceQuoteRef,
      simproJobId: job.simproJobId,
    },
    customer: {
      id: client?.id ?? job.clientId,
      name: client?.name ?? job.customer,
      email: client?.email,
      phone: client?.phone,
    },
    site: {
      id: site?.id ?? job.siteId,
      name: site?.name,
      address: site?.address ?? job.site,
    },
    costCentres,
    schedule,
    totals: {
      cost,
      sell,
      profit: Math.round((sell - cost) * 100) / 100,
    },
  };
}

async function postToWebhook(payload: SimproQuoteExportPayload | SimproJobExportPayload, endpoint = getBridgeEndpoint()) {
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
    const message = formatSimproErrorValue(body.error)
      || formatSimproErrorValue(body.message)
      || formatSimproErrorValue(body.errors)
      || `Webhook returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    endpoint,
    simproQuoteId: asString(body.simproQuoteId) || asString(body.quoteId) || asString(body.id) || undefined,
    simproJobId: asString(body.simproJobId) || asString(body.jobId) || asString(body.id) || undefined,
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
  const scheduler = getSchedulerConfig("quote");
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
    const message = formatSimproErrorValue(body.error)
      || formatSimproErrorValue(body.message)
      || formatSimproErrorValue(body.errors)
      || `Scheduler Simpro bridge returned HTTP ${response.status}`;
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

async function postToSchedulerJobBridge(payload: SimproJobExportPayload) {
  const scheduler = getSchedulerConfig("job");
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
    const message = formatSimproErrorValue(body.error)
      || formatSimproErrorValue(body.message)
      || formatSimproErrorValue(body.errors)
      || `Scheduler Simpro job bridge returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    endpoint: scheduler.endpoint,
    simproJobId:
      asString(body.simproJobId) ||
      asString(body.jobId) ||
      asString(body.id) ||
      asString(asRecord(body.job)?.id) ||
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

function buildSimproJobDescription(payload: SimproJobExportPayload) {
  const scheduleLines = payload.schedule.length > 0
    ? payload.schedule.map((assignment) =>
        `- ${assignment.employeeName}: ${assignment.startDate} ${assignment.startTime} to ${assignment.endDate} ${assignment.endTime} (${assignment.plannedHours}h)${
          assignment.notes ? ` · ${assignment.notes}` : ""
        }`,
      )
    : ["- No engineer allocations pushed from NeXa yet"];
  const costCentreLines = payload.costCentres.flatMap((centre) => {
    const heading = [`Cost centre: ${centre.name}`];
    const lines = centre.lines.map((line) =>
      `- ${line.description}: qty ${line.quantity}, cost £${line.unitCost.toFixed(2)}, sell £${line.unitSell.toFixed(2)}`,
    );
    return [...heading, ...lines, ""];
  });

  return [
    `Created from NeXa job ${payload.job.ref}`,
    payload.job.description,
    "",
    `Customer: ${payload.customer.name}`,
    payload.site.address ? `Site: ${payload.site.address}` : null,
    payload.job.sourceQuoteRef ? `Source quote: ${payload.job.sourceQuoteRef}` : null,
    "",
    `Programme manager: ${payload.job.manager || "To confirm"}`,
    "Schedule pushed from NeXa:",
    ...scheduleLines,
    "",
    `Totals: cost £${payload.totals.cost.toFixed(2)} / sell £${payload.totals.sell.toFixed(2)} / profit £${payload.totals.profit.toFixed(2)}`,
    "",
    ...costCentreLines,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildDirectJobBody(payload: SimproJobExportPayload) {
  const customerId =
    numericId(payload.customer.id) ?? numericId(process.env.SIMPRO_DEFAULT_CUSTOMER_ID ?? process.env.SIMPRO_CUSTOMER_ID);
  const siteId = numericId(payload.site.id) ?? numericId(process.env.SIMPRO_DEFAULT_SITE_ID ?? process.env.SIMPRO_SITE_ID);
  const body: UnknownRecord = {
    Name: `${payload.job.ref} - ${payload.job.description}`.slice(0, 120),
    Description: buildSimproJobDescription(payload),
  };

  if (customerId) body.Customer = customerId;
  if (siteId) body.Site = siteId;

  return body;
}

async function postToDirectSimpro(payload: SimproQuoteExportPayload) {
  const direct = await resolveSimproDirectConfig().catch(() => null);
  if (!direct) return null;

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
    const returnedMessage = simproHttpErrorMessage(body, response.status, endpoint);
    const message = response.status === 401
      ? `Simpro rejected the access token or company permission (HTTP 401). Check the configured simPRO token or refresh credentials are authorised for company ${direct.companyId}.`
      : returnedMessage;
    throw new Error(message);
  }

  return {
    endpoint,
    simproQuoteId: asIdentifier(body.ID) ?? asIdentifier(body.id) ?? asIdentifier(body.quoteId) ?? asIdentifier(body.simproQuoteId),
  };
}

async function postToDirectSimproJob(payload: SimproJobExportPayload) {
  const direct = await resolveSimproDirectConfig().catch(() => null);
  if (!direct) return null;

  const hasExistingJob = Boolean(numericId(payload.job.simproJobId));
  const endpoint = hasExistingJob
    ? `${direct.baseUrl}/companies/${direct.companyId}/jobs/${payload.job.simproJobId}/`
    : `${direct.baseUrl}/companies/${direct.companyId}/jobs/`;
  const response = await fetch(endpoint, {
    method: hasExistingJob ? "PATCH" : "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${direct.token}`,
    },
    body: JSON.stringify(buildDirectJobBody(payload)),
  });

  const body = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const returnedMessage = simproHttpErrorMessage(body, response.status, endpoint);
    const message = response.status === 401
      ? `Simpro rejected the access token or company permission (HTTP 401). Check the configured simPRO token or refresh credentials are authorised for company ${direct.companyId}.`
      : returnedMessage;
    throw new Error(message);
  }

  return {
    endpoint,
    simproJobId: asIdentifier(body.ID) ?? asIdentifier(body.id) ?? asIdentifier(body.jobId) ?? payload.job.simproJobId,
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
    entityType: "quote",
    recordId: quote.id,
    recordRef: quote.ref,
    quoteId: quote.id,
    quoteRef: quote.ref,
    createdAt: payload.createdAt,
    actor,
    status: "Queued",
    mode: "manual",
    payload,
  };

  const bridgeStatus = getSimproBridgeStatus();

  if (!bridgeStatus.configured || !bridgeStatus.quotePushReady) {
    exportRecord.setupRequired = bridgeStatus.missing.join(", ") || bridgeStatus.guidance;
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
      } else {
        exportRecord.status = "Failed";
        exportRecord.mode = sendMode;
        exportRecord.error = `simPRO ${sendMode} push returned no result. Check the bridge settings and try Test connection in Setup.`;
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

export async function pushJobToSimpro(
  jobId: string,
  options: {
    actor?: string;
    costCentres?: unknown;
    schedule?: unknown;
  } = {},
): Promise<SimproJobPushResult | null> {
  const job = getJobs().find((item) => item.id === jobId || item.ref === jobId);
  if (!job) return null;

  const actor = options.actor?.trim() || "NeXa user";
  const payload = buildJobPayload(job, {
    costCentres: options.costCentres,
    schedule: options.schedule,
  });
  const exportRecord: SimproQuoteExportRecord = {
    id: `simpro-export-${crypto.randomUUID()}`,
    entityType: "job",
    recordId: job.id,
    recordRef: job.ref,
    quoteId: "",
    quoteRef: "",
    jobId: job.id,
    jobRef: job.ref,
    createdAt: payload.createdAt,
    actor,
    status: "Queued",
    mode: "manual",
    payload,
  };

  const bridgeStatus = getSimproBridgeStatus();

  if (!bridgeStatus.configured || !bridgeStatus.jobPushReady) {
    exportRecord.setupRequired = bridgeStatus.missing.join(", ") || bridgeStatus.guidance;
  } else {
    const sendMode = bridgeStatus.mode === "direct" ? "direct" : bridgeStatus.mode === "scheduler" ? "scheduler" : "webhook";
    try {
      const sendResult =
        sendMode === "direct"
          ? await postToDirectSimproJob(payload)
          : sendMode === "scheduler"
            ? await postToSchedulerJobBridge(payload)
            : await postToWebhook(payload, cleanEndpoint(process.env.SIMPRO_JOB_PUSH_URL) ?? getBridgeEndpoint());

      if (sendResult) {
        exportRecord.status = "Sent";
        exportRecord.mode = sendMode;
        exportRecord.endpoint = sendResult.endpoint;
        exportRecord.simproJobId = sendResult.simproJobId ?? job.simproJobId;
      } else {
        exportRecord.status = "Failed";
        exportRecord.mode = sendMode;
        exportRecord.error = `simPRO ${sendMode} job push returned no result. Check the bridge settings and try Test connection in Setup.`;
      }
    } catch (error) {
      exportRecord.status = "Failed";
      exportRecord.mode = sendMode;
      exportRecord.error = error instanceof Error ? error.message : "Unable to send job to Simpro bridge";
    }
  }

  saveExportRecord(exportRecord);

  const updatedJob = updateJob(job.id, {
    value: payload.totals.sell,
    next: exportRecord.status === "Sent"
      ? `Sent to Simpro${exportRecord.simproJobId ? ` as ${exportRecord.simproJobId}` : ""}`
      : exportRecord.status === "Failed"
        ? "Simpro handoff failed - review bridge settings"
        : "Queued in NeXa - Simpro bridge not configured",
    simproJobId: exportRecord.simproJobId ?? job.simproJobId,
    simproStatus: exportRecord.status,
    simproSentAt: exportRecord.createdAt,
  }) ?? job;

  const auditEvent = appendAuditEvent({
    actor,
    action: exportRecord.status === "Sent" ? "sent" : exportRecord.status === "Failed" ? "failed" : "queued",
    recordType: "job",
    recordId: job.id,
    summary: exportRecord.status === "Sent"
      ? `${job.ref} sent to Simpro ${exportRecord.mode === "direct" ? "API" : "bridge"}${exportRecord.simproJobId ? ` as ${exportRecord.simproJobId}` : ""}.`
      : exportRecord.status === "Failed"
        ? `${job.ref} could not be sent to Simpro bridge: ${exportRecord.error}.`
        : `${job.ref} saved in the NeXa Simpro queue. It has not been sent to Simpro yet because ${exportRecord.setupRequired ?? "Simpro connection settings"} are not configured.`,
    source: "simpro bridge",
    importance: exportRecord.status === "Failed" ? "high" : "normal",
  });

  return {
    job: updatedJob,
    exportRecord,
    auditEvent,
  };
}

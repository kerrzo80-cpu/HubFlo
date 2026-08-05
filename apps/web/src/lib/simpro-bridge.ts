import { appendAuditEvent, getClientSites, getClients, type AuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { getSimproDirectConfigStatus, resolveSimproDirectConfig, type ResolvedSimproDirectConfig } from "@/lib/simpro-auth";
import { findSimproLinkForNexa, upsertSimproLink } from "@/lib/simpro-sync";
import { getSimproSchedulePushStatus } from "@/lib/simpro-schedule-push";
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
    accountReference?: string;
    billingAddress?: string;
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
    accountReference?: string;
    billingAddress?: string;
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
  /** NeXa Schedules → simPRO diary write (managers app). Requires direct API + schedule rate. */
  schedulePushReady: boolean;
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
  const schedulePush = getSimproSchedulePushStatus();

  if (endpoint) {
    return {
      configured: true,
      mode: "webhook",
      missing: [],
      endpoint,
      guidance: "Quotes and jobs will POST to the configured webhook bridge. Schedule diary write needs direct simPRO API + SIMPRO_DEFAULT_SCHEDULE_RATE_ID.",
      quotePushReady: true,
      jobPushReady: true,
      schedulePushReady: schedulePush.configured,
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
        ? schedulePush.configured
          ? "Quotes/jobs push through the HUB scheduler bridge; NeXa Schedules can also write visits directly into simPRO."
          : `Quotes and jobs push through the HUB scheduler bridge. ${schedulePush.guidance}`
        : `Quotes can push through the scheduler. Jobs still need ${schedulerJob.missing.join(", ")}.`,
      quotePushReady: true,
      jobPushReady: schedulerJob.configured,
      schedulePushReady: schedulePush.configured,
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
      missing: schedulePush.configured ? [] : schedulePush.missing,
      endpoint: `${direct.baseUrl}/companies/${direct.companyId}/quotes/`,
      guidance: schedulePush.configured
        ? "NeXa creates quotes/jobs in simPRO and managers diary visits write into simPRO schedules. Keep ewg-hub-scheduler only until schedule write is proven day-to-day."
        : `NeXa creates quotes and jobs directly in simPRO. ${schedulePush.guidance}`,
      quotePushReady: true,
      jobPushReady: true,
      schedulePushReady: schedulePush.configured,
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
    schedulePushReady: false,
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
  const site =
    sites.find((item) => item.id === quote.siteId) ||
    sites.find((item) => item.clientId === client?.id && !item.archived);
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
      accountReference: client?.accountReference,
      billingAddress: client?.billingAddress,
    },
    site: {
      id: site?.id ?? quote.siteId,
      name: site?.name,
      address: site?.address || client?.billingAddress,
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
  const site =
    sites.find((item) => item.id === job.siteId) ||
    sites.find((item) => item.clientId === client?.id && !item.archived);
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
      accountReference: client?.accountReference,
      billingAddress: client?.billingAddress,
    },
    site: {
      id: site?.id ?? job.siteId,
      name: site?.name,
      address: site?.address ?? job.site ?? client?.billingAddress,
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

function extractEmbeddedSimproId(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const direct = numericId(value.trim());
    if (direct) return direct;
    const simproPrefixed = value.match(/(?:^|[^a-z0-9])simpro[-_]?(\d+)/i);
    if (simproPrefixed?.[1]) {
      const parsed = numericId(simproPrefixed[1]);
      if (parsed) return parsed;
    }
    const trailing = value.match(/(\d{3,})$/);
    if (trailing?.[1] && /simpro/i.test(value)) {
      const parsed = numericId(trailing[1]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function defaultQuoteType() {
  const raw = (process.env.SIMPRO_DEFAULT_QUOTE_TYPE || process.env.SIMPRO_QUOTE_TYPE || "Service").trim();
  if (raw === "Project" || raw === "Service" || raw === "Prepaid") return raw;
  return "Service";
}

function defaultJobType() {
  const raw = (process.env.SIMPRO_DEFAULT_JOB_TYPE || process.env.SIMPRO_JOB_TYPE || defaultQuoteType()).trim();
  if (raw === "Project" || raw === "Service" || raw === "Prepaid") return raw;
  return "Service";
}

/** Service/Prepaid only support one section — multi-centre pushes use Project for distinct names. */
function quoteTypeForPush(centreCount: number) {
  const configured = defaultQuoteType();
  if (centreCount > 1 && (configured === "Service" || configured === "Prepaid")) return "Project";
  return configured;
}

function jobTypeForPush(centreCount: number) {
  const configured = defaultJobType();
  if (centreCount > 1 && (configured === "Service" || configured === "Prepaid")) return "Project";
  return configured;
}

function buildCostCentreDescription(centre: SimproQuoteExportCostCentre) {
  return [centre.name, centre.clientDescription, centre.engineerDescription]
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n\n")
    .slice(0, 500);
}

function normaliseMatchText(value?: string) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isPlaceholderAddress(value?: string) {
  const text = normaliseMatchText(value);
  if (!text) return true;
  return /^(site to confirm|address to confirm|to confirm|to be confirmed|tbc|n\/?a|unknown)$/i.test(text);
}

function looksLikeCompanyName(name: string) {
  return /\b(ltd|limited|plc|llc|inc|corp|company|co\.|group|properties|services|care|trust|association|council)\b/i.test(name);
}

function splitPersonName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "Customer", familyName: "Unknown" };
  if (parts.length === 1) return { givenName: parts[0]!, familyName: "Customer" };
  return { givenName: parts[0]!, familyName: parts.slice(1).join(" ") };
}

function parseUkStyleAddress(raw?: string) {
  const fallback = (!isPlaceholderAddress(raw) && raw?.trim()) || "Address to confirm";
  const parts = fallback.split(",").map((part) => part.trim()).filter(Boolean);
  const postcodeMatch = fallback.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  const postalCode = postcodeMatch?.[1]?.toUpperCase().replace(/\s+/, " ") || "";
  const addressLine = parts[0] || fallback;
  let city = "";
  if (parts.length >= 2) {
    const last = parts[parts.length - 1] || "";
    const lastIsPostcode = Boolean(postalCode && last.toUpperCase().replace(/\s+/g, "").includes(postalCode.replace(/\s+/g, "")));
    city = (lastIsPostcode ? parts[parts.length - 2] : parts[parts.length - 1]) || "";
  }
  return {
    Address: addressLine,
    City: city || "Aberdeen",
    State: "",
    PostalCode: postalCode,
    Country: "United Kingdom",
  };
}

function customerDisplayName(record: UnknownRecord) {
  return (
    asString(record.CompanyName) ||
    asString(record.Name) ||
    asString(record.CustomerName) ||
    asString(record.DisplayName) ||
    [asString(record.GivenName), asString(record.FamilyName)].filter(Boolean).join(" ") ||
    ""
  );
}

function extractRecords(body: unknown) {
  if (Array.isArray(body)) return body.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  const record = asRecord(body);
  if (!record) return [];
  for (const key of ["data", "items", "results", "Results", "Records", "records"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.map(asRecord).filter((item): item is UnknownRecord => Boolean(item));
  }
  return [];
}

async function simproApiFetch(direct: ResolvedSimproDirectConfig, path: string, init?: RequestInit) {
  const endpoint = `${direct.baseUrl}/companies/${direct.companyId}${path}`;
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${direct.token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as UnknownRecord | UnknownRecord[];
  return { endpoint, response, body };
}

function rememberSimproLink(input: {
  nexaType: "clients" | "sites";
  nexaId?: string;
  nexaRef?: string;
  nexaName: string;
  simproId: number;
  simproName: string;
}) {
  if (!input.nexaId) return;
  upsertSimproLink({
    nexaType: input.nexaType,
    nexaId: input.nexaId,
    nexaRef: input.nexaRef,
    nexaName: input.nexaName,
    simproType: input.nexaType,
    simproId: String(input.simproId),
    simproName: input.simproName,
    lastDirection: "nexa-to-simpro",
  });
}

function resolveKnownCustomerId(customer: SimproQuoteExportPayload["customer"]) {
  return (
    numericId(customer.id) ||
    numericId(findSimproLinkForNexa("clients", customer.id)?.simproId) ||
    extractEmbeddedSimproId(customer.id, customer.accountReference) ||
    numericId(process.env.SIMPRO_DEFAULT_CUSTOMER_ID || process.env.SIMPRO_CUSTOMER_ID)
  );
}

function resolveKnownSiteId(site: SimproQuoteExportPayload["site"]) {
  return (
    numericId(site.id) ||
    numericId(findSimproLinkForNexa("sites", site.id)?.simproId) ||
    extractEmbeddedSimproId(site.id) ||
    numericId(process.env.SIMPRO_DEFAULT_SITE_ID || process.env.SIMPRO_SITE_ID)
  );
}

async function searchSimproCustomerId(direct: ResolvedSimproDirectConfig, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const queries = [
    `?pageSize=25&Search=${encodeURIComponent(trimmed)}`,
    `?pageSize=25&CompanyName=${encodeURIComponent(trimmed)}`,
  ];
  const target = normaliseMatchText(trimmed);
  for (const query of queries) {
    const { response, body } = await simproApiFetch(direct, `/customers/${query}`);
    if (!response.ok) continue;
    const matches = extractRecords(body)
      .map((record) => ({ id: numericId(asIdentifier(record.ID) ?? asIdentifier(record.id)), name: customerDisplayName(record) }))
      .filter((item): item is { id: number; name: string } => Boolean(item.id));
    const exact = matches.find((item) => normaliseMatchText(item.name) === target);
    if (exact) return exact.id;
    if (matches.length === 1 && matches[0]) return matches[0].id;
  }
  return undefined;
}

function pickSiteId(records: UnknownRecord[], preferredAddress?: string) {
  const preferred = normaliseMatchText(preferredAddress);
  const sites = records
    .map((record) => ({
      id: numericId(asIdentifier(record.ID) ?? asIdentifier(record.id)),
      name: asString(record.Name),
      address: asString(asRecord(record.Address)?.Address) || asString(record.Address) || asString(record.Name),
    }))
    .filter((item): item is { id: number; name: string; address: string } => Boolean(item.id));
  if (preferred) {
    const match = sites.find((item) =>
      normaliseMatchText(item.address).includes(preferred) ||
      preferred.includes(normaliseMatchText(item.address)) ||
      normaliseMatchText(item.name) === preferred,
    );
    if (match) return match.id;
  }
  return sites[0]?.id;
}

async function firstCustomerSiteId(direct: ResolvedSimproDirectConfig, customerId: number, preferredAddress?: string) {
  const { response, body } = await simproApiFetch(direct, `/customers/${customerId}/sites/?pageSize=50`);
  if (!response.ok) {
    const fallback = await simproApiFetch(direct, `/sites/?pageSize=50&Customer=${customerId}`);
    if (!fallback.response.ok) return undefined;
    return pickSiteId(extractRecords(fallback.body), preferredAddress);
  }
  return pickSiteId(extractRecords(body), preferredAddress);
}

async function createSimproCustomerWithSite(
  direct: ResolvedSimproDirectConfig,
  customer: SimproQuoteExportPayload["customer"],
  site: SimproQuoteExportPayload["site"],
) {
  const addressSource = !isPlaceholderAddress(site.address)
    ? site.address
    : !isPlaceholderAddress(customer.billingAddress)
      ? customer.billingAddress
      : site.name && !isPlaceholderAddress(site.name)
        ? site.name
        : customer.name;
  const address = parseUkStyleAddress(addressSource);
  const companyLike = looksLikeCompanyName(customer.name);
  const path = companyLike
    ? `/customers/companies/?createSite=true`
    : `/customers/individuals/?createSite=true`;
  const body: UnknownRecord = companyLike
    ? {
        CompanyName: customer.name.slice(0, 100),
        Email: customer.email && !isPlaceholderAddress(customer.email) ? customer.email : undefined,
        Phone: customer.phone && !isPlaceholderAddress(customer.phone) ? customer.phone : undefined,
        CustomerType: "Customer",
        Address: address,
      }
    : {
        ...(() => {
          const person = splitPersonName(customer.name);
          return { GivenName: person.givenName, FamilyName: person.familyName };
        })(),
        Email: customer.email && !isPlaceholderAddress(customer.email) ? customer.email : undefined,
        Phone: customer.phone && !isPlaceholderAddress(customer.phone) ? customer.phone : undefined,
        CustomerType: "Customer",
        Address: address,
      };

  const { endpoint, response, body: result } = await simproApiFetch(direct, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const record = asRecord(result) ?? {};
  if (!response.ok) {
    throw new Error(simproHttpErrorMessage(record, response.status, endpoint));
  }

  const customerId =
    numericId(asIdentifier(record.ID) ?? asIdentifier(record.id) ?? asIdentifier(record.CustomerID));
  if (!customerId) {
    throw new Error(`Simpro created a customer for ${customer.name} but did not return an ID.`);
  }

  rememberSimproLink({
    nexaType: "clients",
    nexaId: customer.id,
    nexaRef: customer.accountReference,
    nexaName: customer.name,
    simproId: customerId,
    simproName: customer.name,
  });

  const siteFromResponse =
    numericId(asIdentifier(asRecord(record.Site)?.ID)) ||
    numericId(asIdentifier(asRecord(record.PrimarySite)?.ID)) ||
    pickSiteId(
      Array.isArray(record.Sites)
        ? record.Sites.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
        : [],
      site.address,
    );

  const siteId = siteFromResponse || (await firstCustomerSiteId(direct, customerId, site.address || address.Address));
  if (siteId) {
    rememberSimproLink({
      nexaType: "sites",
      nexaId: site.id,
      nexaName: site.name || site.address || customer.name,
      simproId: siteId,
      simproName: site.name || site.address || customer.name,
    });
  }

  return { customerId, siteId };
}

async function createSimproSite(
  direct: ResolvedSimproDirectConfig,
  customerId: number,
  customer: SimproQuoteExportPayload["customer"],
  site: SimproQuoteExportPayload["site"],
) {
  const addressSource = !isPlaceholderAddress(site.address)
    ? site.address
    : !isPlaceholderAddress(customer.billingAddress)
      ? customer.billingAddress
      : customer.name;
  const address = parseUkStyleAddress(addressSource);
  const name = (site.name && !isPlaceholderAddress(site.name) ? site.name : address.Address).slice(0, 100);
  const { endpoint, response, body } = await simproApiFetch(direct, "/sites/", {
    method: "POST",
    body: JSON.stringify({
      Name: name,
      Customers: [customerId],
      Address: address,
    }),
  });
  const record = asRecord(body) ?? {};
  if (!response.ok) {
    throw new Error(simproHttpErrorMessage(record, response.status, endpoint));
  }
  const siteId = numericId(asIdentifier(record.ID) ?? asIdentifier(record.id));
  if (!siteId) {
    throw new Error(`Simpro created a site for ${name} but did not return an ID.`);
  }
  rememberSimproLink({
    nexaType: "sites",
    nexaId: site.id,
    nexaName: name,
    simproId: siteId,
    simproName: name,
  });
  return siteId;
}

async function ensureSimproCustomerAndSite(
  direct: ResolvedSimproDirectConfig,
  payload: Pick<SimproQuoteExportPayload, "customer" | "site">,
) {
  let customerId = resolveKnownCustomerId(payload.customer);
  let siteId = resolveKnownSiteId(payload.site);

  if (!customerId && payload.customer.name?.trim()) {
    customerId = await searchSimproCustomerId(direct, payload.customer.name);
    if (customerId) {
      rememberSimproLink({
        nexaType: "clients",
        nexaId: payload.customer.id,
        nexaRef: payload.customer.accountReference,
        nexaName: payload.customer.name,
        simproId: customerId,
        simproName: payload.customer.name,
      });
    }
  }

  if (customerId && !siteId) {
    siteId = await firstCustomerSiteId(
      direct,
      customerId,
      payload.site.address || payload.site.name || payload.customer.billingAddress,
    );
    if (siteId) {
      rememberSimproLink({
        nexaType: "sites",
        nexaId: payload.site.id,
        nexaName: payload.site.name || payload.site.address || payload.customer.name,
        simproId: siteId,
        simproName: payload.site.name || payload.site.address || payload.customer.name,
      });
    }
  }

  if (!customerId) {
    const created = await createSimproCustomerWithSite(direct, payload.customer, payload.site);
    customerId = created.customerId;
    siteId = created.siteId ?? siteId;
  }

  if (customerId && !siteId) {
    siteId = await createSimproSite(direct, customerId, payload.customer, payload.site);
  }

  if (!customerId || !siteId) {
    const missing = [!customerId ? "Customer" : null, !siteId ? "Site" : null].filter(Boolean).join(" and ");
    throw new Error(
      `Cannot send to Simpro: ${missing} could not be resolved. Link this quote to a Simpro customer/site, or set SIMPRO_DEFAULT_CUSTOMER_ID / SIMPRO_DEFAULT_SITE_ID.`,
    );
  }

  return { customerId, siteId };
}

function lineLooksLikeLabour(line: SimproQuoteExportLine) {
  const catalogId = (line.catalogItemId || "").toLowerCase();
  if (catalogId.startsWith("labour-") || catalogId.startsWith("labor-")) return true;
  return /\b(labour|labor|engineer hours?|plumber hours?|fitter hours?)\b/i.test(line.description);
}

function buildSimproOneOff(line: SimproQuoteExportLine) {
  const isLabour = lineLooksLikeLabour(line);
  const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
  const unitCost = Number.isFinite(line.unitCost) ? line.unitCost : 0;
  const unitSell = Number.isFinite(line.unitSell) ? line.unitSell : 0;
  // Simpro rejects payloads that include both Markup and SellPrice.
  const body: UnknownRecord = {
    Type: isLabour ? "Labor" : "Material",
    BillableStatus: "Billable",
    Description: line.description.slice(0, 250) || (isLabour ? "Labour" : "Material"),
    EstimatedCost: unitCost,
    SellPrice: unitSell,
    Total: { Qty: quantity },
  };
  if (isLabour) body.EstimatedTime = quantity;
  return body;
}

async function listSetupCostCenters(direct: ResolvedSimproDirectConfig) {
  const fromEnv = (process.env.SIMPRO_COST_CENTER_IDS || process.env.SIMPRO_DEFAULT_COST_CENTER_IDS || "")
    .split(/[,\s]+/)
    .map((value) => numericId(value))
    .filter((value): value is number => Boolean(value));
  if (fromEnv.length) {
    return fromEnv.map((id) => ({ id, name: `Cost centre ${id}` }));
  }

  const candidates = [
    "/setup/costCenters/?pageSize=250",
    "/setup/accounts/costCenters/?pageSize=250",
    "/costCenters/?pageSize=250",
    "/quoteCostCenters/?pageSize=250",
    "/jobCostCenters/?pageSize=250",
  ];
  const errors: string[] = [];
  const discovered = new Map<number, string>();

  for (const path of candidates) {
    const { response, body, endpoint } = await simproApiFetch(direct, path);
    if (!response.ok) {
      errors.push(`${path}: ${simproHttpErrorMessage(asRecord(body) ?? {}, response.status, endpoint)}`);
      continue;
    }

    for (const record of extractRecords(body)) {
      const directId = numericId(asIdentifier(record.ID) ?? asIdentifier(record.id));
      const nested = asRecord(record.CostCenter);
      const nestedId = numericId(asIdentifier(nested?.ID) ?? asIdentifier(nested?.id));
      const fromQuoteOrJobList = path.includes("quoteCostCenters") || path.includes("jobCostCenters");
      const id = fromQuoteOrJobList ? nestedId : directId ?? nestedId;
      const name =
        (!fromQuoteOrJobList ? asString(record.Name) || asString(record.name) : "") ||
        asString(nested?.Name) ||
        asString(nested?.name) ||
        asString(record.Name) ||
        asString(record.name) ||
        (id ? `Cost centre ${id}` : "");
      if (id) discovered.set(id, name || `Cost centre ${id}`);
    }

    if (discovered.size && (path.includes("setup/") || path === "/costCenters/?pageSize=250")) {
      break;
    }
  }

  if (discovered.size) {
    return [...discovered.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => {
        const aNum = Number((a.name.match(/\d+/) || [])[0] || a.id);
        const bNum = Number((b.name.match(/\d+/) || [])[0] || b.id);
        return aNum - bNum || a.id - b.id;
      });
  }

  const defaultId = numericId(process.env.SIMPRO_DEFAULT_COST_CENTER_ID || process.env.SIMPRO_COST_CENTER_ID);
  if (defaultId) {
    return [{ id: defaultId, name: "Default cost centre" }];
  }

  throw new Error(
    `Cannot load Simpro setup cost centres (${errors[0] || "no usable route"}). Set SIMPRO_COST_CENTER_IDS=1,2,3 (your Simpro setup cost centre IDs) and retry.`,
  );
}

function pickSetupCostCenterId(
  setupCentres: Array<{ id: number; name: string }>,
  preferredName: string | undefined,
  index: number,
  usedSetupIds: Set<number>,
) {
  const preferred = normaliseMatchText(preferredName);
  if (preferred) {
    const exact = setupCentres.find((item) => !usedSetupIds.has(item.id) && normaliseMatchText(item.name) === preferred);
    if (exact) return exact.id;
    const partial = setupCentres.find((item) => {
      if (usedSetupIds.has(item.id)) return false;
      const name = normaliseMatchText(item.name);
      return name.includes(preferred) || preferred.includes(name);
    });
    if (partial) return partial.id;
  }

  // Prefer a distinct setup cost centre per NeXa centre so Simpro labels are not all "Cost centre 2".
  const byIndex = setupCentres[index % setupCentres.length];
  if (byIndex && !usedSetupIds.has(byIndex.id)) return byIndex.id;

  const unused = setupCentres.find((item) => !usedSetupIds.has(item.id));
  if (unused) return unused.id;

  throw new Error(
    `Need ${usedSetupIds.size + 1} distinct Simpro setup cost centres but only ${setupCentres.length} are available (${setupCentres.map((item) => `${item.name || "Unnamed"}#${item.id}`).join(", ")}). Add more setup cost centres in Simpro or set SIMPRO_COST_CENTER_IDS=1,2,3.`,
  );
}

function buildSimproSections(
  centres: SimproQuoteExportPayload["costCentres"],
  setupCentres: Array<{ id: number; name: string }>,
  quoteType: "Project" | "Service" | "Prepaid",
) {
  const usable = centres.filter((centre) => centre.lines.length > 0);
  if (!usable.length) return undefined;

  const usedSetupIds = new Set<number>();
  const buildCostCenter = (centre: SimproQuoteExportCostCentre, index: number) => {
    const costCenterId = pickSetupCostCenterId(
      setupCentres,
      centre.templateName || centre.name,
      index,
      usedSetupIds,
    );
    if (!costCenterId) {
      throw new Error(
        "Cannot send cost centres to Simpro: no setup cost centres were found. Create one in Simpro or set SIMPRO_COST_CENTER_IDS.",
      );
    }
    usedSetupIds.add(costCenterId);
    return {
      CostCenter: costCenterId,
      Name: centre.name.slice(0, 100),
      DisplayOrder: index + 1,
      Description: buildCostCentreDescription(centre),
    };
  };

  // Service quotes are limited to one section; put each NeXa centre as its own cost centre under that section.
  if (quoteType === "Service" || quoteType === "Prepaid") {
    return [
      {
        Name: "",
        CostCenters: usable.map((centre, index) => buildCostCenter(centre, index)),
      },
    ];
  }

  return usable.map((centre, index) => ({
    Name: centre.name.slice(0, 100),
    DisplayOrder: index + 1,
    CostCenters: [buildCostCenter(centre, index)],
  }));
}

function buildSimproQuoteDescription(payload: SimproQuoteExportPayload) {
  return (payload.quote.description || `NeXa quote ${payload.quote.ref}`).trim();
}

function buildDirectQuoteBody(
  payload: SimproQuoteExportPayload,
  ids: { customerId: number; siteId: number },
  sections?: UnknownRecord[],
  quoteType: "Project" | "Service" | "Prepaid" = defaultQuoteType(),
) {
  const body: UnknownRecord = {
    Type: quoteType,
    Name: `${payload.quote.ref} - ${payload.quote.description}`.slice(0, 120),
    Description: buildSimproQuoteDescription(payload),
    Customer: ids.customerId,
    Site: ids.siteId,
  };
  if (sections?.length) body.Sections = sections;
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

  return [
    `Created from NeXa job ${payload.job.ref}`,
    payload.job.description,
    payload.job.sourceQuoteRef ? `Source quote: ${payload.job.sourceQuoteRef}` : null,
    `Programme manager: ${payload.job.manager || "To confirm"}`,
    "Schedule pushed from NeXa:",
    ...scheduleLines,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildDirectJobBody(
  payload: SimproJobExportPayload,
  ids: { customerId: number; siteId: number },
  sections?: UnknownRecord[],
  jobType: "Project" | "Service" | "Prepaid" = defaultJobType(),
) {
  const body: UnknownRecord = {
    Type: jobType,
    Name: `${payload.job.ref} - ${payload.job.description}`.slice(0, 120),
    Description: buildSimproJobDescription(payload),
    Customer: ids.customerId,
    Site: ids.siteId,
  };
  if (sections?.length) body.Sections = sections;
  return body;
}

function stripSectionItems(sections?: UnknownRecord[]) {
  if (!sections?.length) return undefined;
  return sections.map((section) => {
    const costCenters = Array.isArray(section.CostCenters)
      ? section.CostCenters.map((centre) => {
          const record = asRecord(centre) ?? {};
          const { Items: _items, ...rest } = record;
          return rest;
        })
      : [];
    return { ...section, CostCenters: costCenters };
  });
}

async function loadRecordSectionsWithCostCenters(
  direct: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  recordId: string,
) {
  const detailed = await simproApiFetch(direct, `/${entity}/${recordId}/?display=all`);
  if (detailed.response.ok) {
    const record = asRecord(detailed.body) ?? {};
    const nested = Array.isArray(record.Sections)
      ? record.Sections.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
      : [];
    if (nested.length) return nested;
  }

  const listed = await simproApiFetch(direct, `/${entity}/${recordId}/sections/?pageSize=50`);
  if (!listed.response.ok) {
    throw new Error(simproHttpErrorMessage(asRecord(listed.body) ?? {}, listed.response.status, listed.endpoint));
  }
  return extractRecords(listed.body);
}

async function collectCostCenterSlots(
  direct: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  recordId: string,
) {
  const sections = await loadRecordSectionsWithCostCenters(direct, entity, recordId);
  const slots: Array<{ sectionId: number; costCenterId: number; name: string; description: string }> = [];

  for (const section of sections) {
    const sectionId = numericId(asIdentifier(section.ID) ?? asIdentifier(section.id));
    if (!sectionId) continue;

    let costCenters = Array.isArray(section.CostCenters)
      ? section.CostCenters.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
      : [];

    if (!costCenters.length) {
      const listed = await simproApiFetch(
        direct,
        `/${entity}/${recordId}/sections/${sectionId}/costCenters/?pageSize=50`,
      );
      if (listed.response.ok) costCenters = extractRecords(listed.body);
    }

    for (const costCenter of costCenters) {
      const costCenterId = numericId(asIdentifier(costCenter.ID) ?? asIdentifier(costCenter.id));
      if (!costCenterId) continue;
      slots.push({
        sectionId,
        costCenterId,
        name: asString(costCenter.Name) || asString(asRecord(costCenter.CostCenter)?.Name),
        description: asString(costCenter.Description),
      });
    }
  }

  return slots;
}

async function ensureCostCenterSlotsForCentres(
  direct: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  recordId: string,
  centres: SimproQuoteExportPayload["costCentres"],
  setupCentres: Array<{ id: number; name: string }>,
  recordType: "Project" | "Service" | "Prepaid",
) {
  const usable = centres.filter((centre) => centre.lines.length > 0);
  const slots = await collectCostCenterSlots(direct, entity, recordId);
  const useNamedSections = recordType === "Project";
  const existing = slots.filter((slot) => slot.costCenterId > 0);
  const usedSetup = new Set<number>();

  while (existing.length < usable.length) {
    const centre = usable[existing.length]!;
    const setupId = pickSetupCostCenterId(
      setupCentres,
      centre.templateName || centre.name,
      existing.length,
      usedSetup,
    );
    usedSetup.add(setupId);

    let sectionId = useNamedSections ? undefined : existing[0]?.sectionId;
    if (!sectionId) {
      const sectionCreate = await simproApiFetch(direct, `/${entity}/${recordId}/sections/`, {
        method: "POST",
        body: JSON.stringify({
          Name: useNamedSections ? centre.name.slice(0, 100) : "",
          DisplayOrder: existing.length + 1,
        }),
      });
      if (!sectionCreate.response.ok) {
        throw new Error(
          simproHttpErrorMessage(asRecord(sectionCreate.body) ?? {}, sectionCreate.response.status, sectionCreate.endpoint),
        );
      }
      sectionId =
        numericId(asIdentifier(asRecord(sectionCreate.body)?.ID) ?? asIdentifier(asRecord(sectionCreate.body)?.id)) ||
        undefined;
    }
    if (!sectionId) {
      throw new Error(`Cannot create Simpro cost centre for "${centre.name}" — no section ID.`);
    }

    const created = await simproApiFetch(direct, `/${entity}/${recordId}/sections/${sectionId}/costCenters/`, {
      method: "POST",
      body: JSON.stringify({
        CostCenter: setupId,
        Name: centre.name.slice(0, 100),
        Description: buildCostCentreDescription(centre),
        DisplayOrder: existing.length + 1,
      }),
    });
    if (!created.response.ok) {
      throw new Error(simproHttpErrorMessage(asRecord(created.body) ?? {}, created.response.status, created.endpoint));
    }
    const costCenterId =
      numericId(asIdentifier(asRecord(created.body)?.ID) ?? asIdentifier(asRecord(created.body)?.id));
    if (!costCenterId) {
      throw new Error(`Simpro created a cost centre for "${centre.name}" but returned no ID.`);
    }
    existing.push({
      sectionId,
      costCenterId,
      name: centre.name,
      description: buildCostCentreDescription(centre),
    });
  }

  return existing;
}

async function labelCostCenterSlot(
  direct: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  recordId: string,
  sectionId: number,
  costCenterId: number,
  centre: SimproQuoteExportCostCentre,
  recordType: "Project" | "Service" | "Prepaid",
) {
  const description = buildCostCentreDescription(centre);
  const patchBody: UnknownRecord = {
    Name: centre.name.slice(0, 100),
    Description: description,
  };
  const patched = await simproApiFetch(
    direct,
    `/${entity}/${recordId}/sections/${sectionId}/costCenters/${costCenterId}/`,
    {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    },
  );
  // Name is ignored on some Simpro builds; Description is what users see when they open the centre.
  if (!patched.response.ok && patched.response.status !== 204) {
    const descriptionOnly = await simproApiFetch(
      direct,
      `/${entity}/${recordId}/sections/${sectionId}/costCenters/${costCenterId}/`,
      {
        method: "PATCH",
        body: JSON.stringify({ Description: description }),
      },
    );
    if (!descriptionOnly.response.ok && descriptionOnly.response.status !== 204) {
      // Non-fatal — lines can still attach; surface nothing here.
    }
  }

  if (recordType === "Project") {
    await simproApiFetch(direct, `/${entity}/${recordId}/sections/${sectionId}/`, {
      method: "PATCH",
      body: JSON.stringify({ Name: centre.name.slice(0, 100) }),
    });
  }
}

async function postOneOffLine(
  direct: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  recordId: string,
  sectionId: number,
  costCenterId: number,
  line: SimproQuoteExportLine,
) {
  const oneOff = buildSimproOneOff(line);
  const base = `/${entity}/${recordId}/sections/${sectionId}/costCenters/${costCenterId}`;
  const candidates: Array<{ path: string; method: "POST" | "PATCH"; body: UnknownRecord }> = [
    { path: `${base}/oneOffs/`, method: "POST", body: oneOff },
    { path: `${base}/oneoffs/`, method: "POST", body: oneOff },
  ];

  const errors: string[] = [];
  for (const candidate of candidates) {
    const posted = await simproApiFetch(direct, candidate.path, {
      method: candidate.method,
      body: JSON.stringify(candidate.body),
    });
    if (posted.response.ok || posted.response.status === 204) return;
    errors.push(`${posted.endpoint}: ${simproHttpErrorMessage(asRecord(posted.body) ?? {}, posted.response.status, posted.endpoint)}`);
  }

  // Last resort: patch the cost centre with a single OneOff item.
  const patched = await simproApiFetch(direct, `${base}/`, {
    method: "PATCH",
    body: JSON.stringify({ Items: { OneOffs: [oneOff] } }),
  });
  if (patched.response.ok || patched.response.status === 204) return;
  errors.push(`${patched.endpoint}: ${simproHttpErrorMessage(asRecord(patched.body) ?? {}, patched.response.status, patched.endpoint)}`);

  throw new Error(
    `Could not add "${line.description}" to Simpro ${entity.slice(0, -1)} ${recordId}. ${errors[0] || "Unknown error"}`,
  );
}

async function attachOneOffsToCreatedRecord(
  direct: ResolvedSimproDirectConfig,
  entity: "quotes" | "jobs",
  recordId: string,
  centres: SimproQuoteExportPayload["costCentres"],
  setupCentres: Array<{ id: number; name: string }>,
  recordType: "Project" | "Service" | "Prepaid",
) {
  const usable = centres.filter((centre) => centre.lines.length > 0);
  if (!usable.length) return;

  const slots = await ensureCostCenterSlotsForCentres(
    direct,
    entity,
    recordId,
    usable,
    setupCentres,
    recordType,
  );
  const targets: Array<{ sectionId: number; costCenterId: number; centre: SimproQuoteExportCostCentre }> = [];

  // Match by order — Simpro often labels every slot with the same setup name ("Cost centre 2"),
  // so fuzzy name matching wrongly piles descriptions onto one centre.
  for (let index = 0; index < usable.length; index += 1) {
    const centre = usable[index]!;
    const matched = slots[index];
    if (!matched?.costCenterId) {
      throw new Error(
        `Simpro ${entity.slice(0, -1)} ${recordId} was created, but no cost centre slot was available for "${centre.name}".`,
      );
    }
    targets.push({ sectionId: matched.sectionId, costCenterId: matched.costCenterId, centre });
  }

  for (const target of targets) {
    await labelCostCenterSlot(
      direct,
      entity,
      recordId,
      target.sectionId,
      target.costCenterId,
      target.centre,
      recordType,
    );
  }

  let attached = 0;
  for (const target of targets) {
    for (const line of target.centre.lines) {
      await postOneOffLine(direct, entity, recordId, target.sectionId, target.costCenterId, line);
      attached += 1;
    }
  }

  if (attached === 0) {
    throw new Error(`Simpro ${entity.slice(0, -1)} ${recordId} had cost centres but no labour/material lines were attached.`);
  }
}

async function postToDirectSimpro(payload: SimproQuoteExportPayload) {
  const direct = await resolveSimproDirectConfig().catch(() => null);
  if (!direct) return null;

  const ids = await ensureSimproCustomerAndSite(direct, payload);
  const setupCentres = await listSetupCostCenters(direct);
  const usableCentres = payload.costCentres.filter((centre) => centre.lines.length > 0);
  if (usableCentres.length > 1 && setupCentres.length < usableCentres.length) {
    throw new Error(
      `NeXa has ${usableCentres.length} cost centres but only ${setupCentres.length} Simpro setup cost centre(s) were found (${setupCentres.map((item) => item.name || item.id).join(", ")}). In Render set SIMPRO_COST_CENTER_IDS to your Simpro setup IDs in order, e.g. 1,2,3, then redeploy.`,
    );
  }
  const quoteType = quoteTypeForPush(usableCentres.length);
  const sections = stripSectionItems(
    buildSimproSections(payload.costCentres, setupCentres, quoteType) as UnknownRecord[] | undefined,
  );
  const endpoint = `${direct.baseUrl}/companies/${direct.companyId}/quotes/`;

  // Always create the quote shell first. Nested Items are unreliable on Service quotes.
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${direct.token}`,
    },
    body: JSON.stringify(buildDirectQuoteBody(payload, ids, sections, quoteType)),
  });
  const body = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const returnedMessage = simproHttpErrorMessage(body, response.status, endpoint);
    const message = response.status === 401
      ? `Simpro rejected the access token or company permission (HTTP 401). Check the configured simPRO token or refresh credentials are authorised for company ${direct.companyId}.`
      : returnedMessage;
    throw new Error(message);
  }

  const quoteId = asIdentifier(body.ID) ?? asIdentifier(body.id) ?? asIdentifier(body.quoteId) ?? asIdentifier(body.simproQuoteId);
  if (!quoteId) throw new Error("Simpro created a quote but did not return an ID.");

  await attachOneOffsToCreatedRecord(direct, "quotes", quoteId, payload.costCentres, setupCentres, quoteType);
  return { endpoint, simproQuoteId: quoteId };
}

async function postToDirectSimproJob(payload: SimproJobExportPayload) {
  const direct = await resolveSimproDirectConfig().catch(() => null);
  if (!direct) return null;

  const ids = await ensureSimproCustomerAndSite(direct, payload);
  const setupCentres = await listSetupCostCenters(direct);
  const usableCentres = payload.costCentres.filter((centre) => centre.lines.length > 0);
  if (usableCentres.length > 1 && setupCentres.length < usableCentres.length) {
    throw new Error(
      `NeXa has ${usableCentres.length} cost centres but only ${setupCentres.length} Simpro setup cost centre(s) were found (${setupCentres.map((item) => item.name || item.id).join(", ")}). In Render set SIMPRO_COST_CENTER_IDS to your Simpro setup IDs in order, e.g. 1,2,3, then redeploy.`,
    );
  }
  const jobType = jobTypeForPush(usableCentres.length);
  const sections = stripSectionItems(
    buildSimproSections(payload.costCentres, setupCentres, jobType) as UnknownRecord[] | undefined,
  );
  const hasExistingJob = Boolean(numericId(payload.job.simproJobId));
  const endpoint = hasExistingJob
    ? `${direct.baseUrl}/companies/${direct.companyId}/jobs/${payload.job.simproJobId}/`
    : `${direct.baseUrl}/companies/${direct.companyId}/jobs/`;

  if (hasExistingJob) {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${direct.token}`,
      },
      body: JSON.stringify(buildDirectJobBody(payload, ids, undefined, jobType)),
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

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${direct.token}`,
    },
    body: JSON.stringify(buildDirectJobBody(payload, ids, sections, jobType)),
  });
  const body = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    const returnedMessage = simproHttpErrorMessage(body, response.status, endpoint);
    const message = response.status === 401
      ? `Simpro rejected the access token or company permission (HTTP 401). Check the configured simPRO token or refresh credentials are authorised for company ${direct.companyId}.`
      : returnedMessage;
    throw new Error(message);
  }

  const jobId = asIdentifier(body.ID) ?? asIdentifier(body.id) ?? asIdentifier(body.jobId) ?? asIdentifier(body.simproJobId);
  if (!jobId) throw new Error("Simpro created a job but did not return an ID.");
  await attachOneOffsToCreatedRecord(direct, "jobs", jobId, payload.costCentres, setupCentres, jobType);
  return { endpoint, simproJobId: jobId };
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

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
  mode: "manual" | "webhook";
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

function asBoolean(value: unknown) {
  return value === true;
}

function cleanEndpoint(value?: string) {
  return value?.trim().replace(/\/+$/, "");
}

function getBridgeEndpoint() {
  return cleanEndpoint(process.env.SIMPRO_QUOTE_PUSH_URL);
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

  if (!getBridgeEndpoint()) {
    exportRecord.setupRequired = "SIMPRO_QUOTE_PUSH_URL";
  } else {
    try {
      const webhookResult = await postToWebhook(payload);
      if (webhookResult) {
        exportRecord.status = "Sent";
        exportRecord.mode = "webhook";
        exportRecord.endpoint = webhookResult.endpoint;
        exportRecord.simproQuoteId = webhookResult.simproQuoteId;
      }
    } catch (error) {
      exportRecord.status = "Failed";
      exportRecord.mode = "webhook";
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
      ? `${quote.ref} sent to Simpro bridge${exportRecord.simproQuoteId ? ` as ${exportRecord.simproQuoteId}` : ""}.`
      : exportRecord.status === "Failed"
        ? `${quote.ref} could not be sent to Simpro bridge: ${exportRecord.error}.`
        : `${quote.ref} saved in the NeXa Simpro queue. It has not been sent to Simpro yet because the live bridge URL is not configured.`,
    source: "simpro bridge",
    importance: exportRecord.status === "Failed" ? "high" : "normal",
  });

  return {
    quote: updatedQuote,
    exportRecord,
    auditEvent,
  };
}

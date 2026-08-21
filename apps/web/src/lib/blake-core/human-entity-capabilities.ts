import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { getClientSites, getClients } from "@/lib/people-data";
import { getJobs, getQuotes } from "@/lib/workflow-data";

import { bestEntityFieldScore, entityMatchScore, normaliseEntityText } from "./entity-resolution";
import type { BlakeCapability } from "./types";

type RecordType = "client" | "site" | "lead" | "quote" | "job" | "invoice";
type SearchRow = { type: RecordType; id: string; ref?: string; title: string; detail: string; status?: string; score: number };

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 2 };
}

function objectInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Capability input must be an object.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function scoreRow(query: string, values: unknown[]) {
  return bestEntityFieldScore(query, values);
}

export const humanSearchNexaRecordsCapability: BlakeCapability = {
  definition: definition({
    name: "search_nexa_records",
    description: "Search authorised NeXa records using normal human wording. IMPORTANT: use this yourself when the user gives a customer/person name, site, address, job description or partial name; do not ask the user for an internal job/reference number first. Handles surname-first imports such as 'Ball, Helen' when the user says 'Helen Ball', punctuation differences and partial names. If several plausible jobs are returned, show the small set and ask which one they mean.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        types: { type: "array", items: { enum: ["client", "site", "lead", "quote", "job", "invoice"] } },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["query"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const allowed: RecordType[] = ["client", "site", "lead", "quote", "job", "invoice"];
    const requested = Array.isArray(raw.types)
      ? raw.types.filter((item): item is RecordType => allowed.includes(item as RecordType))
      : allowed;
    return {
      query: requiredString(raw.query, "Search query"),
      types: requested.length ? requested : allowed,
      limit: Math.max(1, Math.min(25, Number(raw.limit) || 12)),
    };
  },
  execute(input, context) {
    const rows: SearchRow[] = [];
    const add = (type: RecordType, values: SearchRow[]) => {
      if (input.types.includes(type)) rows.push(...values.filter((item) => item.score >= 58));
    };

    if (context.access.showCustomers) {
      add("client", getClients().map((item) => ({
        type: "client" as const,
        id: item.id,
        title: item.name,
        detail: item.billingAddress || item.email || item.phone,
        status: item.status,
        score: scoreRow(input.query, [item.name, item.billingAddress, item.email, item.phone]),
      })));
      add("site", getClientSites().map((item) => ({
        type: "site" as const,
        id: item.id,
        title: item.address,
        detail: item.name || item.address,
        status: item.archived ? "Archived" : "Active",
        score: scoreRow(input.query, [item.name, item.address, item.primaryContact]),
      })));
    }

    if (context.access.canCreateLead || context.access.showJobs || context.access.showQuotes) {
      add("lead", getLeads().map((item) => ({
        type: "lead" as const,
        id: item.id,
        ref: item.ref,
        title: item.customerName,
        detail: `${item.address} · ${item.description}`,
        status: item.status,
        score: scoreRow(input.query, [item.ref, item.customerName, item.address, item.description, `${item.customerName} ${item.address}`]),
      })));
    }

    if (context.access.showQuotes) {
      add("quote", getQuotes().map((item) => ({
        type: "quote" as const,
        id: item.id,
        ref: item.ref,
        title: item.customer,
        detail: item.description,
        status: item.status,
        score: scoreRow(input.query, [item.ref, item.customer, item.description]),
      })));
    }

    if (context.access.showJobs) {
      add("job", getJobs().map((item) => ({
        type: "job" as const,
        id: item.id,
        ref: item.ref,
        title: item.customer,
        detail: `${item.site} · ${item.description}`,
        status: item.status,
        score: Math.max(
          entityMatchScore(input.query, item.ref) + 20,
          entityMatchScore(input.query, item.customer) + 8,
          entityMatchScore(input.query, item.site) + 4,
          entityMatchScore(input.query, item.description),
          entityMatchScore(input.query, `${item.customer} ${item.site}`),
        ),
      })));
    }

    if (context.access.showFinance) {
      const invoices = (getHubDetailState().invoices ?? []) as Array<Record<string, unknown>>;
      add("invoice", invoices.map((item) => ({
        type: "invoice" as const,
        id: String(item.id || ""),
        ref: String(item.ref || ""),
        title: String(item.customer || item.title || "Invoice"),
        detail: String(item.title || item.sourceRef || ""),
        status: String(item.status || ""),
        score: scoreRow(input.query, [item.ref, item.customer, item.title, item.sourceRef]),
      })));
    }

    const matches = rows
      .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.title.localeCompare(b.title))
      .slice(0, input.limit)
      .map(({ score: _score, ...item }) => item);
    return { query: input.query, normalisedQuery: normaliseEntityText(input.query), matches };
  },
};

function uniqueBest<T extends Record<string, unknown>>(query: string, records: T[], values: (record: T) => unknown[]) {
  const ranked = records
    .map((record) => ({ record, score: scoreRow(query, values(record)) }))
    .filter((item) => item.score >= 58)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  const best = ranked[0]!;
  if (ranked.filter((item) => item.score === best.score).length > 1) return undefined;
  return best.record;
}

export const humanGetNexaRecordCapability: BlakeCapability = {
  definition: definition({
    name: "get_nexa_record",
    description: "Read one authorised NeXa record from a human identifier, including natural customer names, reversed imported names, site addresses or references. Use search_nexa_records first if the wording could match more than one record. Never ask the user to find an internal reference merely because a natural name was supplied.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { type: { enum: ["client", "site", "lead", "quote", "job", "invoice"] }, identifier: { type: "string" } },
      required: ["type", "identifier"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const allowed: RecordType[] = ["client", "site", "lead", "quote", "job", "invoice"];
    if (!allowed.includes(raw.type as RecordType)) throw new TypeError("Record type is not supported.");
    return { type: raw.type as RecordType, identifier: requiredString(raw.identifier, "Record identifier") };
  },
  execute(input, context) {
    let record: Record<string, unknown> | null | undefined;
    if (input.type === "client") {
      if (!context.access.showCustomers) throw new Error("Your NeXa role cannot read customers.");
      record = uniqueBest(input.identifier, getClients() as unknown as Array<Record<string, unknown>>, (item) => [item.id, item.name, item.billingAddress, item.email, item.phone]);
    } else if (input.type === "site") {
      if (!context.access.showCustomers) throw new Error("Your NeXa role cannot read sites.");
      record = uniqueBest(input.identifier, getClientSites() as unknown as Array<Record<string, unknown>>, (item) => [item.id, item.name, item.address, item.primaryContact]);
    } else if (input.type === "lead") {
      record = uniqueBest(input.identifier, getLeads() as unknown as Array<Record<string, unknown>>, (item) => [item.id, item.ref, item.customerName, item.address, item.description]);
    } else if (input.type === "quote") {
      if (!context.access.showQuotes) throw new Error("Your NeXa role cannot read quotes.");
      record = uniqueBest(input.identifier, getQuotes() as unknown as Array<Record<string, unknown>>, (item) => [item.id, item.ref, item.customer, item.description]);
    } else if (input.type === "job") {
      if (!context.access.showJobs) throw new Error("Your NeXa role cannot read jobs.");
      const jobs = getJobs();
      const exact = jobs.find((item) => normaliseEntityText(item.id) === normaliseEntityText(input.identifier) || normaliseEntityText(item.ref) === normaliseEntityText(input.identifier));
      record = exact as unknown as Record<string, unknown> | undefined
        ?? uniqueBest(input.identifier, jobs as unknown as Array<Record<string, unknown>>, (item) => [item.customer, item.site, item.description, `${item.customer} ${item.site}`]);
    } else {
      if (!context.access.showFinance) throw new Error("Your NeXa role cannot read invoices.");
      record = uniqueBest(input.identifier, (getHubDetailState().invoices ?? []) as Array<Record<string, unknown>>, (item) => [item.id, item.ref, item.customer, item.title, item.sourceRef]);
    }

    if (record === undefined) throw new Error(`More than one ${input.type} matches “${input.identifier}”. Use search_nexa_records and ask the user only which of the returned real records they mean.`);
    if (!record) throw new Error(`No ${input.type} matching “${input.identifier}” was found. Use search_nexa_records with the user's natural wording before asking them for an internal reference.`);
    return { type: input.type, record };
  },
};

export const humanEntityCapabilities: BlakeCapability[] = [
  humanSearchNexaRecordsCapability,
  humanGetNexaRecordCapability,
];

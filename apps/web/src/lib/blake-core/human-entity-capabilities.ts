import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import type { Employee, Weekday } from "@/lib/access";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { getClientSites, getClients } from "@/lib/people-data";
import { getJobs, getQuotes } from "@/lib/workflow-data";

import {
  bestEntityFieldScore,
  entityMatchScore,
  normaliseEntityText,
  requireClientFromHumanReference,
  requireEmployeeFromHumanReference,
  requireInvoiceFromHumanReference,
  requireJobFromHumanReference,
  requireLeadFromHumanReference,
  requireQuoteFromHumanReference,
  requireSiteFromHumanReference,
} from "./entity-resolution";
import type { BlakeCapability } from "./types";

type RecordType = "client" | "site" | "lead" | "quote" | "job" | "invoice" | "employee";
type SearchRow = { type: RecordType; id: string; ref?: string; title: string; detail: string; status?: string; score: number };
type ScheduleAssignment = { employeeId?: string; employeeName?: string; startDate?: string; startTime?: string; endTime?: string; jobId?: string; costCentreName?: string };
type InvoiceRow = {
  id?: string; ref?: string; status?: string; paymentStatus?: string; customer?: string; title?: string;
  sourceRef?: string; issuedDate?: string; dueDate?: string; chargeTotal?: number; vatRate?: number;
  paidAmount?: number; claimType?: string;
};

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 3 };
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

function isoDate(value: unknown, label: string) {
  const text = requiredString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) {
    throw new TypeError(`${label} must be YYYY-MM-DD.`);
  }
  return text;
}

function scoreRow(query: string, values: unknown[]) {
  return bestEntityFieldScore(query, values);
}

function employeePublicRecord(employee: Employee) {
  return {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    archived: Boolean(employee.archived),
    profile: employee.profile ? {
      email: employee.profile.email,
      phone: employee.profile.phone,
      roleLabel: employee.profile.roleLabel,
      availability: employee.profile.availability,
    } : undefined,
  };
}

export const humanSearchNexaRecordsCapability: BlakeCapability = {
  definition: definition({
    name: "search_nexa_records",
    description: "Search authorised NeXa jobs, customers, sites, leads, quotes, invoices and employees using normal human wording. Use this yourself for names, reversed imported names, partial names, addresses, descriptions and conversational details; never make the user look up an internal J/Q/L/id first. If several real records plausibly match, return the small set so Blake can disambiguate naturally.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        types: { type: "array", items: { enum: ["client", "site", "lead", "quote", "job", "invoice", "employee"] } },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["query"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const allowed: RecordType[] = ["client", "site", "lead", "quote", "job", "invoice", "employee"];
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
    const clients = getClients();
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));

    if (context.access.showCustomers) {
      add("client", clients.map((item) => ({
        type: "client" as const,
        id: item.id,
        ref: item.accountReference,
        title: item.name,
        detail: item.billingAddress || item.email || item.phone,
        status: item.status,
        score: scoreRow(input.query, [item.id, item.accountReference, item.name, item.primaryContact, item.billingAddress, item.email, item.phone, `${item.name} ${item.primaryContact}`]),
      })));
      add("site", getClientSites().map((item) => ({
        type: "site" as const,
        id: item.id,
        title: item.name || item.address,
        detail: item.address,
        status: item.archived ? "Archived" : "Active",
        score: scoreRow(input.query, [item.id, item.name, item.address, item.primaryContact, item.serviceLine, clientNames.get(item.clientId), `${clientNames.get(item.clientId) || ""} ${item.address}`]),
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
        score: scoreRow(input.query, [item.id, item.ref, item.customerName, item.address, item.description, item.phone, item.email, `${item.customerName} ${item.address}`, `${item.customerName} ${item.description}`]),
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
        score: Math.max(
          entityMatchScore(input.query, item.ref) + 20,
          entityMatchScore(input.query, item.customer) + 8,
          entityMatchScore(input.query, item.description),
          entityMatchScore(input.query, `${item.customer} ${item.description}`),
        ),
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
          entityMatchScore(input.query, `${item.customer} ${item.description}`),
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
        score: scoreRow(input.query, [item.id, item.ref, item.customer, item.title, item.sourceRef, `${item.customer || ""} ${item.title || ""}`]),
      })));
    }

    if (context.access.showSchedule) {
      const employees = ((getHubDetailState().employees ?? []) as Employee[]).filter((item) => !item.archived);
      add("employee", employees.map((item) => ({
        type: "employee" as const,
        id: item.id,
        title: item.name,
        detail: item.profile?.roleLabel || item.role,
        status: item.archived ? "Archived" : "Active",
        score: Math.max(
          entityMatchScore(input.query, item.name) + 10,
          scoreRow(input.query, [item.id, item.profile?.email, item.profile?.phone, item.profile?.roleLabel, item.role]),
        ),
      })));
    }

    const matches = rows
      .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type) || a.title.localeCompare(b.title))
      .slice(0, input.limit)
      .map(({ score: _score, ...item }) => item);
    return { query: input.query, normalisedQuery: normaliseEntityText(input.query), matches };
  },
};

export const humanGetNexaRecordCapability: BlakeCapability = {
  definition: definition({
    name: "get_nexa_record",
    description: "Read one authorised NeXa job, customer, site, lead, quote, invoice or employee using a human identifier: normal or reversed name, partial name, address, description, known reference or id. Never require an internal reference merely because the user spoke naturally; only ask which record when the shared resolver finds genuine ambiguity.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { type: { enum: ["client", "site", "lead", "quote", "job", "invoice", "employee"] }, identifier: { type: "string" } },
      required: ["type", "identifier"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const allowed: RecordType[] = ["client", "site", "lead", "quote", "job", "invoice", "employee"];
    if (!allowed.includes(raw.type as RecordType)) throw new TypeError("Record type is not supported.");
    return { type: raw.type as RecordType, identifier: requiredString(raw.identifier, "Record identifier") };
  },
  execute(input, context) {
    let record: unknown;
    if (input.type === "client") {
      if (!context.access.showCustomers) throw new Error("Your NeXa role cannot read customers.");
      record = requireClientFromHumanReference(input.identifier);
    } else if (input.type === "site") {
      if (!context.access.showCustomers) throw new Error("Your NeXa role cannot read sites.");
      record = requireSiteFromHumanReference(input.identifier);
    } else if (input.type === "lead") {
      if (!(context.access.canCreateLead || context.access.showJobs || context.access.showQuotes)) throw new Error("Your NeXa role cannot read leads.");
      record = requireLeadFromHumanReference(input.identifier);
    } else if (input.type === "quote") {
      if (!context.access.showQuotes) throw new Error("Your NeXa role cannot read quotes.");
      record = requireQuoteFromHumanReference(input.identifier);
    } else if (input.type === "job") {
      if (!context.access.showJobs) throw new Error("Your NeXa role cannot read jobs.");
      record = requireJobFromHumanReference(input.identifier);
    } else if (input.type === "invoice") {
      if (!context.access.showFinance) throw new Error("Your NeXa role cannot read invoices.");
      record = requireInvoiceFromHumanReference(input.identifier);
    } else {
      if (!context.access.showSchedule) throw new Error("Your NeXa role cannot read employees.");
      record = employeePublicRecord(requireEmployeeFromHumanReference(input.identifier));
    }
    return { type: input.type, record };
  },
};

function employeeBookings(employee: Employee, date: string) {
  const hub = getHubDetailState();
  const plans = (hub.jobSchedulePlans ?? {}) as Record<string, ScheduleAssignment[]>;
  const jobs = getJobs();
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const bookings = Object.values(plans).flat()
    .filter((item) => (item.employeeId === employee.id || item.employeeName === employee.name) && item.startDate === date)
    .map((item) => ({
      startTime: String(item.startTime || ""),
      endTime: String(item.endTime || ""),
      label: `${jobById.get(String(item.jobId))?.ref ?? "Job"} · ${item.costCentreName || "work"}`,
    }));
  for (const job of jobs.filter((item) => item.manager === employee.name && item.scheduledDate === date && item.scheduledTime)) {
    if (!bookings.some((item) => item.label.startsWith(job.ref))) {
      bookings.push({ startTime: job.scheduledTime || "", endTime: job.scheduledTime || "", label: `${job.ref} · ${job.description}` });
    }
  }
  for (const lead of getLeads().filter((item) => item.surveyor === employee.name && item.surveyDate === date && item.surveyTime && item.status !== "Lost")) {
    bookings.push({ startTime: lead.surveyTime, endTime: lead.surveyTime, label: `${lead.ref} · survey for ${lead.customerName}` });
  }
  return bookings.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export const humanCheckAvailabilityCapability: BlakeCapability = {
  definition: definition({
    name: "check_schedule_availability",
    description: "Check one employee's working hours and NeXa bookings using a normal human employee reference. Accept first-name/surname, reversed names, partial unique names, role detail or the internal id; never make the user look up the employee id.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showSchedule"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { employee: { type: "string" }, date: { type: "string", format: "date" } },
      required: ["employee", "date"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { employee: requiredString(raw.employee, "Employee"), date: isoDate(raw.date, "Date") };
  },
  execute(input) {
    const employee = requireEmployeeFromHumanReference(input.employee);
    const dayNames: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const working = employee.profile?.availability?.[dayNames[new Date(`${input.date}T12:00:00Z`).getUTCDay()]!];
    const bookings = employeeBookings(employee, input.date);
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      date: input.date,
      workingHours: working?.active ? `${working.from}-${working.to}` : null,
      available: Boolean(working?.active && !bookings.length),
      bookings,
    };
  },
};

function invoiceTotal(invoice: InvoiceRow) {
  const net = Number(invoice.chargeTotal) || 0;
  return net + net * ((Number(invoice.vatRate) || 0) / 100);
}

function invoiceOwed(invoice: InvoiceRow) {
  if (invoice.status === "Cancelled" || invoice.claimType === "valuation" || invoice.claimType === "credit-note") return 0;
  if (invoice.status === "Paid" || invoice.paymentStatus === "Paid") return 0;
  return Math.max(0, invoiceTotal(invoice) - (Number(invoice.paidAmount) || 0));
}

export const humanListInvoicesCapability: BlakeCapability = {
  definition: definition({
    name: "list_invoices",
    description: "List and total authorised NeXa invoices. The optional customer filter accepts normal/reversed/partial customer names, descriptions or source references rather than requiring an exact stored string.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showFinance"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { enum: ["all", "unpaid", "overdue", "paid"] },
        customer: { type: "string" },
        from: { type: "string", format: "date" },
        to: { type: "string", format: "date" },
        asAt: { type: "string", format: "date" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["status"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const statuses = ["all", "unpaid", "overdue", "paid"] as const;
    const status = statuses.includes(raw.status as typeof statuses[number]) ? raw.status as typeof statuses[number] : "all";
    const from = raw.from ? isoDate(raw.from, "From date") : undefined;
    const to = raw.to ? isoDate(raw.to, "To date") : undefined;
    if (from && to && from > to) throw new TypeError("From date must be before or equal to the to date.");
    return {
      status,
      customer: typeof raw.customer === "string" && raw.customer.trim() ? raw.customer.trim() : undefined,
      from,
      to,
      asAt: raw.asAt ? isoDate(raw.asAt, "As-at date") : new Date().toISOString().slice(0, 10),
      limit: Math.max(1, Math.min(50, Number(raw.limit) || 20)),
    };
  },
  execute(input) {
    let rows = (getHubDetailState().invoices ?? []) as InvoiceRow[];
    rows = rows.filter((item) => item.status !== "Cancelled" && item.claimType !== "valuation" && item.claimType !== "credit-note");
    if (input.customer) {
      rows = rows.filter((item) => bestEntityFieldScore(input.customer, [item.customer, item.title, item.sourceRef, `${item.customer || ""} ${item.title || ""}`]) >= 58);
    }
    if (input.from) rows = rows.filter((item) => String(item.issuedDate || "").slice(0, 10) >= input.from!);
    if (input.to) rows = rows.filter((item) => String(item.issuedDate || "").slice(0, 10) <= input.to!);
    if (input.status === "paid") rows = rows.filter((item) => item.status === "Paid" || item.paymentStatus === "Paid");
    if (input.status === "unpaid") rows = rows.filter((item) => invoiceOwed(item) > 0);
    if (input.status === "overdue") rows = rows.filter((item) => invoiceOwed(item) > 0 && Boolean(item.dueDate && item.dueDate < input.asAt));
    rows.sort((a, b) => String(b.issuedDate || "").localeCompare(String(a.issuedDate || "")));
    const allMatching = rows;
    return {
      filters: { status: input.status, customer: input.customer, from: input.from, to: input.to, asAt: input.asAt },
      count: allMatching.length,
      total: allMatching.reduce((sum, item) => sum + invoiceTotal(item), 0),
      owed: allMatching.reduce((sum, item) => sum + invoiceOwed(item), 0),
      rows: allMatching.slice(0, input.limit).map((item) => ({
        id: String(item.id || ""),
        ref: String(item.ref || "Invoice"),
        customer: String(item.customer || "Customer not set"),
        title: String(item.title || item.sourceRef || "Invoice"),
        status: String(item.paymentStatus || item.status || "Draft"),
        issuedDate: String(item.issuedDate || ""),
        dueDate: String(item.dueDate || ""),
        total: invoiceTotal(item),
        owed: invoiceOwed(item),
      })),
    };
  },
};

export const humanEntityCapabilities: BlakeCapability[] = [
  humanSearchNexaRecordsCapability,
  humanGetNexaRecordCapability,
  humanCheckAvailabilityCapability,
  humanListInvoicesCapability,
];

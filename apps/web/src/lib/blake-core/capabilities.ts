import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import type { Employee, Weekday } from "@/lib/access";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { createLead, getLeads, type LeadDraftFromClient } from "@/lib/lead-store";
import { getClients, getClientSites } from "@/lib/people-data";
import { getJobs, getQuotes } from "@/lib/workflow-data";

import type { BlakeCapability } from "./types";

type SearchRecordType = "client" | "site" | "lead" | "quote" | "job" | "invoice";

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

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 1 };
}

function searchable(...values: unknown[]) {
  return values.map((value) => String(value ?? "")).join(" ").toLowerCase();
}

export const searchNexaRecordsCapability: BlakeCapability<
  { query: string; types: SearchRecordType[]; limit: number },
  { query: string; matches: Array<{ type: SearchRecordType; id: string; ref?: string; title: string; detail: string; status?: string }> }
> = {
  definition: definition({
    name: "search_nexa_records",
    description: "Search authorised NeXa clients, sites, leads, quotes, jobs and invoices by reference, name, address or description.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { query: { type: "string" }, types: { type: "array", items: { enum: ["client", "site", "lead", "quote", "job", "invoice"] } }, limit: { type: "integer", minimum: 1, maximum: 25 } },
      required: ["query"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const allowed: SearchRecordType[] = ["client", "site", "lead", "quote", "job", "invoice"];
    const requested = Array.isArray(raw.types) ? raw.types.filter((item): item is SearchRecordType => allowed.includes(item as SearchRecordType)) : allowed;
    const limit = Math.max(1, Math.min(25, Number(raw.limit) || 12));
    return { query: requiredString(raw.query, "Search query"), types: requested.length ? requested : allowed, limit };
  },
  execute(input, context) {
    const query = input.query.toLowerCase();
    const matches: Array<{ type: SearchRecordType; id: string; ref?: string; title: string; detail: string; status?: string }> = [];
    const add = (type: SearchRecordType, rows: Array<{ id: string; ref?: string; title: string; detail: string; status?: string; haystack: string }>) => {
      if (!input.types.includes(type)) return;
      for (const row of rows) if (row.haystack.includes(query)) matches.push({ type, id: row.id, ref: row.ref, title: row.title, detail: row.detail, status: row.status });
    };
    if (context.access.showCustomers) {
      add("client", getClients().map((item) => ({ id: item.id, title: item.name, detail: item.billingAddress || item.email || item.phone, status: item.status, haystack: searchable(item.name, item.billingAddress, item.email, item.phone) })));
      add("site", getClientSites().map((item) => ({ id: item.id, title: item.address, detail: item.name || item.address, status: item.archived ? "Archived" : "Active", haystack: searchable(item.name, item.address, item.primaryContact) })));
    }
    if (context.access.canCreateLead || context.access.showJobs || context.access.showQuotes) {
      add("lead", getLeads().map((item) => ({ id: item.id, ref: item.ref, title: item.customerName, detail: `${item.address} · ${item.description}`, status: item.status, haystack: searchable(item.ref, item.customerName, item.address, item.description) })));
    }
    if (context.access.showQuotes) {
      add("quote", getQuotes().map((item) => ({ id: item.id, ref: item.ref, title: item.customer, detail: item.description, status: item.status, haystack: searchable(item.ref, item.customer, item.description) })));
    }
    if (context.access.showJobs) {
      add("job", getJobs().map((item) => ({ id: item.id, ref: item.ref, title: item.customer, detail: `${item.site} · ${item.description}`, status: item.status, haystack: searchable(item.ref, item.customer, item.site, item.description) })));
    }
    if (context.access.showFinance) {
      const invoices = (getHubDetailState().invoices ?? []) as Array<Record<string, unknown>>;
      add("invoice", invoices.map((item) => ({ id: String(item.id), ref: String(item.ref || ""), title: String(item.customer || item.title || "Invoice"), detail: String(item.title || item.sourceRef || ""), status: String(item.status || ""), haystack: searchable(item.ref, item.customer, item.title, item.sourceRef) })));
    }
    return { query: input.query, matches: matches.slice(0, input.limit) };
  },
};

type ScheduleAssignment = { employeeId?: string; employeeName?: string; startDate?: string; startTime?: string; endTime?: string; jobId?: string; costCentreName?: string };

export const checkAvailabilityCapability: BlakeCapability<
  { employee: string; date: string },
  { employeeId: string; employeeName: string; date: string; workingHours: string | null; available: boolean; bookings: Array<{ startTime: string; endTime: string; label: string }> }
> = {
  definition: definition({
    name: "check_schedule_availability",
    description: "Check an employee's working hours and all NeXa job, work-package and survey bookings for one date.",
    mode: "read", risk: "low", requiredPermissions: ["showSchedule"], requiresConfirmation: false,
    inputSchema: { type: "object", additionalProperties: false, properties: { employee: { type: "string" }, date: { type: "string", format: "date" } }, required: ["employee", "date"] },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { employee: requiredString(raw.employee, "Employee"), date: isoDate(raw.date, "Date") };
  },
  execute(input) {
    const hub = getHubDetailState();
    const employees = (hub.employees ?? []) as Employee[];
    const target = input.employee.toLowerCase();
    const employee = employees.find((item) => item.id === input.employee || item.name.toLowerCase() === target)
      ?? employees.find((item) => item.name.toLowerCase().includes(target) || target.includes(item.name.toLowerCase()));
    if (!employee) throw new Error(`No employee matching ${input.employee} was found.`);
    const dayNames: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const working = employee.profile?.availability?.[dayNames[new Date(`${input.date}T12:00:00Z`).getUTCDay()]!];
    const plans = (hub.jobSchedulePlans ?? {}) as Record<string, ScheduleAssignment[]>;
    const jobs = getJobs();
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const bookings = Object.values(plans).flat()
      .filter((item) => (item.employeeId === employee.id || item.employeeName === employee.name) && item.startDate === input.date)
      .map((item) => ({ startTime: String(item.startTime || ""), endTime: String(item.endTime || ""), label: `${jobById.get(String(item.jobId))?.ref ?? "Job"} · ${item.costCentreName || "work"}` }));
    for (const job of jobs.filter((item) => item.manager === employee.name && item.scheduledDate === input.date && item.scheduledTime)) {
      if (!bookings.some((item) => item.label.startsWith(job.ref))) bookings.push({ startTime: job.scheduledTime!, endTime: job.scheduledTime!, label: `${job.ref} · ${job.description}` });
    }
    for (const lead of getLeads().filter((item) => item.surveyor === employee.name && item.surveyDate === input.date && item.surveyTime && item.status !== "Lost")) {
      bookings.push({ startTime: lead.surveyTime, endTime: lead.surveyTime, label: `${lead.ref} · survey for ${lead.customerName}` });
    }
    bookings.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return { employeeId: employee.id, employeeName: employee.name, date: input.date, workingHours: working?.active ? `${working.from}-${working.to}` : null, available: Boolean(working?.active && !bookings.length), bookings };
  },
};

export const managementReportCapability: BlakeCapability<
  { from: string; to: string },
  { period: { from: string; to: string }; revenue: number; directCost: number; grossProfit: number; grossMarginPercent: number; acceptedQuoteValue: number; invoicesIssued: number; jobsCompleted: number; basis: string }
> = {
  definition: definition({
    name: "build_management_report",
    description: "Build a management summary for an exact inclusive date range from NeXa invoices, jobs and accepted quotes.",
    mode: "read", risk: "low", requiredPermissions: ["showFinance"], requiresConfirmation: false,
    inputSchema: { type: "object", additionalProperties: false, properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } }, required: ["from", "to"] },
  }),
  parse(input) {
    const raw = objectInput(input);
    const from = isoDate(raw.from, "From date");
    const to = isoDate(raw.to, "To date");
    if (from > to) throw new TypeError("From date must be before or equal to the to date.");
    return { from, to };
  },
  execute(input) {
    const inPeriod = (value: unknown) => {
      const date = String(value || "").slice(0, 10);
      return Boolean(date && date >= input.from && date <= input.to);
    };
    const invoices = ((getHubDetailState().invoices ?? []) as Array<Record<string, unknown>>)
      .filter((item) => item.status !== "Cancelled" && item.claimType !== "valuation" && item.claimType !== "credit-note" && inPeriod(item.issuedDate));
    const revenue = invoices.reduce((sum, item) => sum + (Number(item.chargeTotal) || 0), 0);
    const directCost = invoices.reduce((sum, item) => sum + (Number(item.costTotal) || 0), 0);
    const grossProfit = revenue - directCost;
    const acceptedQuoteValue = getQuotes().filter((item) => ["Accepted", "Converted"].includes(item.status) && inPeriod(item.respondedAt || item.sentAt || item.due)).reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const jobsCompleted = getJobs().filter((item) => ["Complete", "Completed", "Invoiced", "Closed"].includes(item.status) && inPeriod(item.due)).length;
    return {
      period: input,
      revenue,
      directCost,
      grossProfit,
      grossMarginPercent: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
      acceptedQuoteValue,
      invoicesIssued: invoices.length,
      jobsCompleted,
      basis: "Revenue and direct cost use non-cancelled invoices issued in the selected period, excluding valuations and credit notes. This is a management view, not a statutory P&L.",
    };
  },
};

type InvoiceRow = {
  id?: string; ref?: string; status?: string; paymentStatus?: string; customer?: string; title?: string;
  sourceRef?: string; issuedDate?: string; dueDate?: string; chargeTotal?: number; vatRate?: number;
  paidAmount?: number; claimType?: string;
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

export const listInvoicesCapability: BlakeCapability<
  { status: "all" | "unpaid" | "overdue" | "paid"; customer?: string; from?: string; to?: string; asAt: string; limit: number },
  { filters: Record<string, string | undefined>; count: number; total: number; owed: number; rows: Array<{ id: string; ref: string; customer: string; title: string; status: string; issuedDate: string; dueDate: string; total: number; owed: number }> }
> = {
  definition: definition({
    name: "list_invoices",
    description: "List and total authorised NeXa invoices, including unpaid, overdue or paid invoices and optional customer/date filters.",
    mode: "read", risk: "low", requiredPermissions: ["showFinance"], requiresConfirmation: false,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        status: { enum: ["all", "unpaid", "overdue", "paid"] }, customer: { type: "string" },
        from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
        asAt: { type: "string", format: "date" }, limit: { type: "integer", minimum: 1, maximum: 50 },
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
      from, to,
      asAt: raw.asAt ? isoDate(raw.asAt, "As-at date") : new Date().toISOString().slice(0, 10),
      limit: Math.max(1, Math.min(50, Number(raw.limit) || 20)),
    };
  },
  execute(input) {
    let rows = (getHubDetailState().invoices ?? []) as InvoiceRow[];
    rows = rows.filter((item) => item.status !== "Cancelled" && item.claimType !== "valuation" && item.claimType !== "credit-note");
    if (input.customer) {
      const customer = input.customer.toLowerCase();
      rows = rows.filter((item) => searchable(item.customer, item.title, item.sourceRef).includes(customer));
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
        id: String(item.id || ""), ref: String(item.ref || "Invoice"), customer: String(item.customer || "Customer not set"),
        title: String(item.title || item.sourceRef || "Invoice"), status: String(item.paymentStatus || item.status || "Draft"),
        issuedDate: String(item.issuedDate || ""), dueDate: String(item.dueDate || ""), total: invoiceTotal(item), owed: invoiceOwed(item),
      })),
    };
  },
};

export const createLeadCapability: BlakeCapability<LeadDraftFromClient, ReturnType<typeof createLead>> = {
  definition: definition({
    name: "create_lead",
    description: "Create a NeXa lead from a completed, reviewed CREATE_LEAD_V1 workflow.",
    mode: "write", risk: "medium", requiredPermissions: ["canCreateLead"], requiresConfirmation: true,
    inputSchema: { type: "object", additionalProperties: true, required: ["customerName", "address", "description", "source"] },
  }),
  parse(input) {
    const raw = objectInput(input) as unknown as LeadDraftFromClient;
    requiredString(raw.customerName, "Customer name"); requiredString(raw.address, "Address"); requiredString(raw.description, "Description"); requiredString(raw.source, "Source");
    return raw;
  },
  execute(input, context) {
    return createLead(input, `${context.actor.name} via Blake Core`);
  },
};

export const coreCapabilities: BlakeCapability[] = [
  searchNexaRecordsCapability,
  checkAvailabilityCapability,
  managementReportCapability,
  listInvoicesCapability,
  createLeadCapability,
];

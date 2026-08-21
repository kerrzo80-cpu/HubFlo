import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import type { Employee, Weekday } from "@/lib/access";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { getClientSites, getClients } from "@/lib/people-data";
import { getJobs, getQuotes } from "@/lib/workflow-data";

import type { BlakeCapability } from "./types";

type RecordType = "client" | "site" | "lead" | "quote" | "job" | "invoice";
type ScheduleAssignment = {
  employeeId?: string;
  employeeName?: string;
  startDate?: string;
  startTime?: string;
  endTime?: string;
  jobId?: string;
  costCentreName?: string;
};

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 1 };
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

function normal(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesIdentifier(item: Record<string, unknown>, identifier: string) {
  const target = normal(identifier);
  return [item.id, item.ref, item.name, item.address, item.customer, item.customerName]
    .some((value) => normal(value) === target);
}

function isoDate(value: unknown) {
  const text = requiredString(value, "Date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) {
    throw new TypeError("Date must be YYYY-MM-DD.");
  }
  return text;
}

export const getNexaRecordCapability: BlakeCapability = {
  definition: definition({
    name: "get_nexa_record",
    description: "Read one authorised NeXa client, site, lead, quote, job or invoice by exact internal id/reference/name/address. Use this after search results or when the conversation refers to a specific record.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { enum: ["client", "site", "lead", "quote", "job", "invoice"] },
        identifier: { type: "string" },
      },
      required: ["type", "identifier"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const types: RecordType[] = ["client", "site", "lead", "quote", "job", "invoice"];
    if (!types.includes(raw.type as RecordType)) throw new TypeError("Record type is not supported.");
    return { type: raw.type as RecordType, identifier: requiredString(raw.identifier, "Record identifier") };
  },
  execute(input, context) {
    let record: Record<string, unknown> | undefined;
    if (input.type === "client") {
      if (!context.access.showCustomers) throw new Error("Your NeXa role cannot read customers.");
      record = getClients().find((item) => matchesIdentifier(item as unknown as Record<string, unknown>, input.identifier)) as unknown as Record<string, unknown> | undefined;
    } else if (input.type === "site") {
      if (!context.access.showCustomers) throw new Error("Your NeXa role cannot read sites.");
      record = getClientSites().find((item) => matchesIdentifier(item as unknown as Record<string, unknown>, input.identifier)) as unknown as Record<string, unknown> | undefined;
    } else if (input.type === "lead") {
      if (!(context.access.canCreateLead || context.access.showJobs || context.access.showQuotes)) throw new Error("Your NeXa role cannot read leads.");
      record = getLeads().find((item) => matchesIdentifier(item as unknown as Record<string, unknown>, input.identifier)) as unknown as Record<string, unknown> | undefined;
    } else if (input.type === "quote") {
      if (!context.access.showQuotes) throw new Error("Your NeXa role cannot read quotes.");
      record = getQuotes().find((item) => matchesIdentifier(item as unknown as Record<string, unknown>, input.identifier)) as unknown as Record<string, unknown> | undefined;
    } else if (input.type === "job") {
      if (!context.access.showJobs) throw new Error("Your NeXa role cannot read jobs.");
      record = getJobs().find((item) => matchesIdentifier(item as unknown as Record<string, unknown>, input.identifier)) as unknown as Record<string, unknown> | undefined;
    } else {
      if (!context.access.showFinance) throw new Error("Your NeXa role cannot read invoices.");
      const invoices = (getHubDetailState().invoices ?? []) as Array<Record<string, unknown>>;
      record = invoices.find((item) => matchesIdentifier(item, input.identifier));
    }
    if (!record) throw new Error(`No ${input.type} matching ${input.identifier} was found in NeXa.`);
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
    .map((item) => {
      const job = jobById.get(String(item.jobId));
      return {
        type: "job_work_package",
        startTime: String(item.startTime || ""),
        endTime: String(item.endTime || ""),
        ref: job?.ref || "",
        customer: job?.customer || "",
        site: job?.site || "",
        description: item.costCentreName || job?.description || "Work",
      };
    });
  for (const job of jobs.filter((item) => item.manager === employee.name && item.scheduledDate === date && item.scheduledTime)) {
    if (!bookings.some((item) => item.ref === job.ref)) {
      bookings.push({
        type: "job",
        startTime: job.scheduledTime || "",
        endTime: job.scheduledTime || "",
        ref: job.ref,
        customer: job.customer,
        site: job.site,
        description: job.description,
      });
    }
  }
  for (const lead of getLeads().filter((item) => item.surveyor === employee.name && item.surveyDate === date && item.surveyTime && item.status !== "Lost")) {
    bookings.push({
      type: "lead_survey",
      startTime: lead.surveyTime,
      endTime: lead.surveyTime,
      ref: lead.ref,
      customer: lead.customerName,
      site: lead.address,
      description: lead.description,
    });
  }
  return bookings.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export const listTeamAvailabilityCapability: BlakeCapability = {
  definition: definition({
    name: "list_team_availability",
    description: "List every authorised NeXa employee's availability and bookings for one date. Use this for questions like who is free, who can attend, who is working, or compare engineers on a date.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showSchedule"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { date: { type: "string", format: "date" } },
      required: ["date"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { date: isoDate(raw.date) };
  },
  execute(input) {
    const hub = getHubDetailState();
    const employees = (hub.employees ?? []) as Employee[];
    const dayNames: Weekday[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weekday = dayNames[new Date(`${input.date}T12:00:00Z`).getUTCDay()]!;
    return {
      date: input.date,
      employees: employees.map((employee) => {
        const working = employee.profile?.availability?.[weekday];
        const bookings = employeeBookings(employee, input.date);
        return {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          working: Boolean(working?.active),
          workingHours: working?.active ? `${working.from}-${working.to}` : null,
          freeAllDay: Boolean(working?.active && !bookings.length),
          bookings,
        };
      }),
    };
  },
};

export const assistantReadCapabilities: BlakeCapability[] = [
  getNexaRecordCapability,
  listTeamAvailabilityCapability,
];

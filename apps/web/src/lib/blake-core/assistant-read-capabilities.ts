import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import type { Employee, Weekday } from "@/lib/access";
import { getHubDetailState } from "@/lib/hub-detail-store";
import { getLeads } from "@/lib/lead-store";
import { getJobs } from "@/lib/workflow-data";

import type { BlakeCapability } from "./types";

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

function isoDate(value: unknown) {
  const text = requiredString(value, "Date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) {
    throw new TypeError("Date must be YYYY-MM-DD.");
  }
  return text;
}

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

// Human record lookup/search lives in human-entity-capabilities.ts and is registered later.
// Keeping this module focused on team-wide reads removes the old exact-string lookup path.
export const assistantReadCapabilities: BlakeCapability[] = [
  listTeamAvailabilityCapability,
];

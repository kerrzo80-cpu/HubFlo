import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import {
  assertQuoteStatusTransition,
  createJob,
  createQuote,
  getJobs,
  getQuotes,
  updateJob,
  updateQuote,
  type Job,
  type Quote,
  type QuoteStatus,
} from "@/lib/workflow-data";

import type { BlakeCapability } from "./types";

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 1 };
}

function objectInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Capability input must be an object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function optionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function optionalNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number"
    ? value
    : Number(String(value).replace(/[£,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`${label} must be a positive number or zero.`);
  return parsed;
}

function normaliseRef(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "-");
}

const quoteStatuses: QuoteStatus[] = ["Draft", "Sent", "Accepted", "Declined", "Converted", "Lost"];

type CreateQuoteInput = {
  customer: string;
  description: string;
  owner?: string;
  status?: QuoteStatus;
  value?: number;
  next?: string;
  due?: string;
};

export const createQuoteCapability: BlakeCapability<CreateQuoteInput, Quote> = {
  definition: definition({
    name: "create_quote",
    description: "Create a real NeXa quote after the user has reviewed the customer, description and any supplied value.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        customer: { type: "string" },
        description: { type: "string" },
        owner: { type: "string" },
        status: { enum: quoteStatuses },
        value: { type: "number", minimum: 0 },
        next: { type: "string" },
        due: { type: "string" },
      },
      required: ["customer", "description"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const statusText = optionalString(raw.status);
    const status = statusText
      ? quoteStatuses.find((item) => item.toLowerCase() === statusText.toLowerCase())
      : undefined;
    if (statusText && !status) throw new TypeError(`Quote status must be one of: ${quoteStatuses.join(", ")}.`);
    return {
      customer: requiredString(raw.customer, "Customer"),
      description: requiredString(raw.description, "Quote description"),
      owner: optionalString(raw.owner),
      status,
      value: optionalNumber(raw.value, "Quote value"),
      next: optionalString(raw.next),
      due: optionalString(raw.due),
    };
  },
  execute(input, context) {
    return createQuote({
      customer: input.customer,
      description: input.description,
      owner: input.owner ?? context.actor.name,
      status: input.status ?? "Draft",
      value: input.value ?? 0,
      next: input.next ?? "Build scope and pricing.",
      due: input.due ?? "Unscheduled",
    });
  },
};

type UpdateQuoteInput = {
  ref: string;
  description?: string;
  owner?: string;
  status?: QuoteStatus;
  value?: number;
  next?: string;
  due?: string;
};

export const updateQuoteCapability: BlakeCapability<UpdateQuoteInput, Quote> = {
  definition: definition({
    name: "update_quote",
    description: "Update an existing NeXa quote by Q-reference. Supports description, owner, status, value, next action and due date.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ref: { type: "string" },
        description: { type: "string" },
        owner: { type: "string" },
        status: { enum: quoteStatuses },
        value: { type: "number", minimum: 0 },
        next: { type: "string" },
        due: { type: "string" },
      },
      required: ["ref"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const statusText = optionalString(raw.status);
    const status = statusText
      ? quoteStatuses.find((item) => item.toLowerCase() === statusText.toLowerCase())
      : undefined;
    if (statusText && !status) throw new TypeError(`Quote status must be one of: ${quoteStatuses.join(", ")}.`);
    const parsed: UpdateQuoteInput = {
      ref: normaliseRef(requiredString(raw.ref, "Quote reference")),
      description: optionalString(raw.description),
      owner: optionalString(raw.owner),
      status,
      value: optionalNumber(raw.value, "Quote value"),
      next: optionalString(raw.next),
      due: optionalString(raw.due),
    };
    if ([parsed.description, parsed.owner, parsed.status, parsed.value, parsed.next, parsed.due].every((value) => value === undefined)) {
      throw new TypeError("At least one quote field must be changed.");
    }
    return parsed;
  },
  execute(input) {
    const quote = getQuotes().find((item) => normaliseRef(item.ref) === input.ref);
    if (!quote) throw new Error(`I cannot find ${input.ref} in NeXa quotes.`);
    if (input.status) {
      const transitionError = assertQuoteStatusTransition(quote.status, input.status);
      if (transitionError) throw new Error(transitionError);
    }
    const patch: Partial<Quote> = {};
    if (input.description !== undefined) patch.description = input.description;
    if (input.owner !== undefined) patch.owner = input.owner;
    if (input.status !== undefined) patch.status = input.status;
    if (input.value !== undefined) patch.value = input.value;
    if (input.next !== undefined) patch.next = input.next;
    if (input.due !== undefined) patch.due = input.due;
    const updated = updateQuote(quote.id, patch);
    if (!updated) throw new Error(`${input.ref} could not be updated.`);
    return updated;
  },
};

type CreateJobInput = {
  customer: string;
  site: string;
  description: string;
  manager?: string;
  status?: string;
  value?: number;
  next?: string;
  due?: string;
};

export const createJobCapability: BlakeCapability<CreateJobInput, Job> = {
  definition: definition({
    name: "create_job",
    description: "Create a real NeXa job for a customer and site after the user has reviewed the details.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateJob"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        customer: { type: "string" },
        site: { type: "string" },
        description: { type: "string" },
        manager: { type: "string" },
        status: { type: "string" },
        value: { type: "number", minimum: 0 },
        next: { type: "string" },
        due: { type: "string" },
      },
      required: ["customer", "site", "description"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      customer: requiredString(raw.customer, "Customer"),
      site: requiredString(raw.site, "Site"),
      description: requiredString(raw.description, "Job description"),
      manager: optionalString(raw.manager),
      status: optionalString(raw.status),
      value: optionalNumber(raw.value, "Job value"),
      next: optionalString(raw.next),
      due: optionalString(raw.due),
    };
  },
  execute(input, context) {
    return createJob({
      customer: input.customer,
      site: input.site,
      description: input.description,
      manager: input.manager ?? context.actor.name,
      status: input.status ?? "Pending",
      value: input.value ?? 0,
      next: input.next ?? "Review and schedule work.",
      due: input.due ?? "Unscheduled",
    });
  },
};

type UpdateJobInput = {
  ref: string;
  site?: string;
  description?: string;
  manager?: string;
  status?: string;
  value?: number;
  next?: string;
  due?: string;
};

export const updateJobCapability: BlakeCapability<UpdateJobInput, Job> = {
  definition: definition({
    name: "update_job",
    description: "Update an existing NeXa job by J-reference. Supports site, description, manager, status, value, next action and due date. Job health remains derived by NeXa.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canEditJobs"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ref: { type: "string" },
        site: { type: "string" },
        description: { type: "string" },
        manager: { type: "string" },
        status: { type: "string" },
        value: { type: "number", minimum: 0 },
        next: { type: "string" },
        due: { type: "string" },
      },
      required: ["ref"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const parsed: UpdateJobInput = {
      ref: normaliseRef(requiredString(raw.ref, "Job reference")),
      site: optionalString(raw.site),
      description: optionalString(raw.description),
      manager: optionalString(raw.manager),
      status: optionalString(raw.status),
      value: optionalNumber(raw.value, "Job value"),
      next: optionalString(raw.next),
      due: optionalString(raw.due),
    };
    if ([parsed.site, parsed.description, parsed.manager, parsed.status, parsed.value, parsed.next, parsed.due].every((value) => value === undefined)) {
      throw new TypeError("At least one job field must be changed.");
    }
    return parsed;
  },
  execute(input) {
    const job = getJobs().find((item) => normaliseRef(item.ref) === input.ref);
    if (!job) throw new Error(`I cannot find ${input.ref} in NeXa jobs.`);
    const patch: Partial<Job> = {};
    if (input.site !== undefined) patch.site = input.site;
    if (input.description !== undefined) patch.description = input.description;
    if (input.manager !== undefined) patch.manager = input.manager;
    if (input.status !== undefined) patch.status = input.status;
    if (input.value !== undefined) patch.value = input.value;
    if (input.next !== undefined) patch.next = input.next;
    if (input.due !== undefined) patch.due = input.due;
    const updated = updateJob(job.id, patch);
    if (!updated) throw new Error(`${input.ref} could not be updated.`);
    return updated;
  },
};

export const operatorCapabilities: BlakeCapability[] = [
  createQuoteCapability,
  updateQuoteCapability,
  createJobCapability,
  updateJobCapability,
];

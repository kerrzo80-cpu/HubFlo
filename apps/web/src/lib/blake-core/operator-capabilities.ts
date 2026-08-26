import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import {
  assertQuoteStatusTransition,
  createJob,
  createQuote,
  updateJob,
  updateQuote,
  type Job,
  type Quote,
  type QuoteStatus,
} from "@/lib/workflow-data";

import {
  requireEmployeeFromHumanReference,
  requireJobFromHumanReference,
  requireQuoteFromHumanReference,
  resolveClientFromHumanReference,
  resolveEmployeeFromHumanReference,
  resolveSiteFromHumanReference,
  requireClientFromHumanReference,
  requireSiteFromHumanReference,
} from "./entity-resolution";
import type { BlakeCapability } from "./types";

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 3 };
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

function canonicalCustomer(value: string) {
  const result = resolveClientFromHumanReference(value);
  if (result.kind === "resolved") return result.record.name;
  if (result.kind === "ambiguous") return requireClientFromHumanReference(value).name;
  return value;
}

function canonicalSite(value: string) {
  const result = resolveSiteFromHumanReference(value);
  if (result.kind === "resolved") return result.record.address || result.record.name;
  if (result.kind === "ambiguous") {
    const site = requireSiteFromHumanReference(value);
    return site.address || site.name;
  }
  return value;
}

function canonicalEmployee(value: string | undefined) {
  if (!value) return undefined;
  const result = resolveEmployeeFromHumanReference(value);
  if (result.kind === "resolved") return result.record.name;
  if (result.kind === "ambiguous") return requireEmployeeFromHumanReference(value).name;
  return value;
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
    description: "Create a real NeXa quote after the user has reviewed the customer, description and any supplied value. Customer and owner may be normal names, reversed names or unique partial names; Blake canonicalises existing records without requiring internal ids.",
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
      customer: canonicalCustomer(input.customer),
      description: input.description,
      owner: canonicalEmployee(input.owner) ?? context.actor.name,
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
    description: "Update an existing NeXa quote. The `ref` input is a human reference, not necessarily a Q-number: it may be the customer name, description, prior conversational reference, id or Q-reference. Owner changes accept normal employee names too. Resolve it yourself and only ask the user to choose when several real records genuinely match.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateQuote"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ref: { type: "string", description: "Natural quote reference: customer, description, id or Q-reference." },
        description: { type: "string" },
        owner: { type: "string", description: "Natural employee reference; internal employee id is not required." },
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
      ref: requiredString(raw.ref, "Quote"),
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
    const quote = requireQuoteFromHumanReference(input.ref);
    if (input.status) {
      const transitionError = assertQuoteStatusTransition(quote.status, input.status);
      if (transitionError) throw new Error(transitionError);
    }
    const patch: Partial<Quote> = {};
    if (input.description !== undefined) patch.description = input.description;
    if (input.owner !== undefined) patch.owner = canonicalEmployee(input.owner);
    if (input.status !== undefined) patch.status = input.status;
    if (input.value !== undefined) patch.value = input.value;
    if (input.next !== undefined) patch.next = input.next;
    if (input.due !== undefined) patch.due = input.due;
    const updated = updateQuote(quote.id, patch);
    if (!updated) throw new Error(`${quote.ref} could not be updated.`);
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
    description: "Create a real NeXa job for a customer and site after the user has reviewed the details. Use natural customer/site wording and normal employee names; existing records are resolved to their canonical NeXa values without internal ids.",
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
      customer: canonicalCustomer(input.customer),
      site: canonicalSite(input.site),
      description: input.description,
      manager: canonicalEmployee(input.manager) ?? context.actor.name,
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
    description: "Update an existing NeXa job. The `ref` input is a human reference and may be a customer/person name, reversed imported name, site/address, description, prior conversational reference, id or J-reference. Site and manager changes also accept normal human references. Resolve it yourself; only ask the user to choose if several real records genuinely match. Job health remains derived by NeXa.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canEditJobs"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ref: { type: "string", description: "Natural job reference: customer/person name, site/address, description, id or J-reference." },
        site: { type: "string", description: "Natural site name/address or free-text site for a genuinely new location." },
        description: { type: "string" },
        manager: { type: "string", description: "Natural employee reference; internal employee id is not required." },
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
      ref: requiredString(raw.ref, "Job"),
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
    const job = requireJobFromHumanReference(input.ref);
    const patch: Partial<Job> = {};
    if (input.site !== undefined) patch.site = canonicalSite(input.site);
    if (input.description !== undefined) patch.description = input.description;
    if (input.manager !== undefined) patch.manager = canonicalEmployee(input.manager);
    if (input.status !== undefined) patch.status = input.status;
    if (input.value !== undefined) patch.value = input.value;
    if (input.next !== undefined) patch.next = input.next;
    if (input.due !== undefined) patch.due = input.due;
    const updated = updateJob(job.id, patch);
    if (!updated) throw new Error(`${job.ref} could not be updated.`);
    return updated;
  },
};

export const operatorCapabilities: BlakeCapability[] = [
  createQuoteCapability,
  updateQuoteCapability,
  createJobCapability,
  updateJobCapability,
];

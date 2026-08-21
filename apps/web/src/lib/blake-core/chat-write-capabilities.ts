import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import {
  createLead,
  updateLead,
  type LeadSource,
  type LeadStatus,
} from "@/lib/lead-store";

import {
  requireClientFromHumanReference,
  requireEmployeeFromHumanReference,
  requireLeadFromHumanReference,
  requireSiteFromHumanReference,
} from "./entity-resolution";
import type { BlakeCapability } from "./types";

const leadSources: LeadSource[] = ["Phone call", "Checkatrade", "Email", "Website", "Referral"];
const leadStatuses: LeadStatus[] = ["New enquiry", "Needs scheduling", "Survey booked", "Quoted", "Lost"];

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 4 };
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

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function leadSource(value: unknown) {
  const source = leadSources.find((item) => item.toLowerCase() === optionalString(value).toLowerCase());
  if (!source) throw new TypeError(`Lead source must be one of: ${leadSources.join(", ")}.`);
  return source;
}

function leadStatus(value: unknown) {
  const text = optionalString(value);
  if (!text) return undefined;
  const status = leadStatuses.find((item) => item.toLowerCase() === text.toLowerCase());
  if (!status) throw new TypeError(`Lead status must be one of: ${leadStatuses.join(", ")}.`);
  return status;
}

export const createLeadChatCapability: BlakeCapability = {
  definition: definition({
    name: "create_lead",
    description: "Create a real NeXa lead. Use the customer/site details already established in normal conversation. Only customer name, address, description and source are mandatory; unknown contact or scheduling fields can remain blank. Existing customer/site references and surveyor names may be natural names, reversed names, partial unique names or addresses; Blake resolves them without asking for internal ids.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateLead"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        customerName: { type: "string" },
        address: { type: "string" },
        description: { type: "string" },
        source: { enum: leadSources },
        phone: { type: "string" },
        email: { type: "string" },
        status: { enum: leadStatuses },
        surveyor: { type: "string", description: "Natural employee reference such as name, reversed name or unique partial name." },
        surveyDate: { type: "string" },
        surveyTime: { type: "string" },
        clientId: { type: "string", description: "Optional existing customer reference. Natural customer name/address/account reference or id is accepted." },
        siteId: { type: "string", description: "Optional existing site reference. Natural site name/address or id is accepted." },
        siteName: { type: "string" },
        next: { type: "string" },
      },
      required: ["customerName", "address", "description", "source"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      customerName: requiredString(raw.customerName, "Customer name"),
      address: requiredString(raw.address, "Address"),
      description: requiredString(raw.description, "Description"),
      source: leadSource(raw.source),
      phone: optionalString(raw.phone),
      email: optionalString(raw.email),
      status: leadStatus(raw.status) ?? "Needs scheduling",
      surveyor: optionalString(raw.surveyor),
      surveyDate: optionalString(raw.surveyDate),
      surveyTime: optionalString(raw.surveyTime),
      clientId: optionalString(raw.clientId) || undefined,
      siteId: optionalString(raw.siteId) || undefined,
      siteName: optionalString(raw.siteName) || undefined,
      next: optionalString(raw.next) || undefined,
    };
  },
  execute(input, context) {
    const clientId = input.clientId ? requireClientFromHumanReference(input.clientId).id : undefined;
    const siteId = input.siteId ? requireSiteFromHumanReference(input.siteId).id : undefined;
    const surveyor = input.surveyor ? requireEmployeeFromHumanReference(input.surveyor).name : "";
    const result = createLead({
      ...input,
      clientId,
      siteId,
      surveyor,
      createdBy: context.actor.name,
    }, `${context.actor.name} via Blake`);
    return result.lead;
  },
};

export const updateLeadChatCapability: BlakeCapability = {
  definition: definition({
    name: "update_lead",
    description: "Update an existing NeXa lead. The `ref` input may be a natural customer/person name, reversed imported name, address, description, id or L-reference. Surveyor and site changes also accept natural human references. Resolve them yourself and only ask which one when several real records genuinely match.",
    mode: "write",
    risk: "medium",
    requiredPermissions: ["canCreateLead"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ref: { type: "string", description: "Natural lead reference: customer/person name, address, description, id or L-reference." },
        status: { enum: leadStatuses },
        lostReason: { type: "string" },
        surveyor: { type: "string", description: "Natural employee reference; internal employee id is not required." },
        surveyDate: { type: "string" },
        surveyTime: { type: "string" },
        siteId: { type: "string", description: "Natural site name/address or id." },
        next: { type: "string" },
      },
      required: ["ref"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const parsed = {
      ref: requiredString(raw.ref, "Lead"),
      status: leadStatus(raw.status),
      lostReason: optionalString(raw.lostReason) || undefined,
      surveyor: optionalString(raw.surveyor) || undefined,
      surveyDate: optionalString(raw.surveyDate) || undefined,
      surveyTime: optionalString(raw.surveyTime) || undefined,
      siteId: optionalString(raw.siteId) || undefined,
      next: optionalString(raw.next) || undefined,
    };
    if ([parsed.status, parsed.lostReason, parsed.surveyor, parsed.surveyDate, parsed.surveyTime, parsed.siteId, parsed.next].every((value) => value === undefined)) {
      throw new TypeError("At least one lead field must be changed.");
    }
    return parsed;
  },
  execute(input, context) {
    const lead = requireLeadFromHumanReference(input.ref);
    const surveyor = input.surveyor ? requireEmployeeFromHumanReference(input.surveyor).name : undefined;
    const siteId = input.siteId ? requireSiteFromHumanReference(input.siteId).id : undefined;
    const updated = updateLead(lead.id, {
      status: input.status,
      lostReason: input.lostReason,
      surveyor,
      surveyDate: input.surveyDate,
      surveyTime: input.surveyTime,
      siteId,
      next: input.next,
    }, `${context.actor.name} via Blake`);
    if (!updated) throw new Error(`${lead.ref} could not be updated.`);
    return updated;
  },
};

export const chatWriteCapabilities: BlakeCapability[] = [
  createLeadChatCapability,
  updateLeadChatCapability,
];

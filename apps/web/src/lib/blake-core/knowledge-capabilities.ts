import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import {
  archiveBlakeKnowledge,
  listBlakeKnowledge,
  saveBlakeKnowledge,
  updateBlakeKnowledge,
  type BlakeKnowledgeCategory,
  type BlakeKnowledgeScope,
} from "@/lib/blake-knowledge";

import {
  requireClientFromHumanReference,
  requireEmployeeFromHumanReference,
  requireJobFromHumanReference,
  requireLeadFromHumanReference,
  requireQuoteFromHumanReference,
  requireSiteFromHumanReference,
} from "./entity-resolution";
import type { BlakeCapability, BlakeExecutionContext } from "./types";

const categories: BlakeKnowledgeCategory[] = [
  "business_rule",
  "terminology",
  "pricing_rule",
  "process",
  "reporting_preference",
  "tender_rule",
  "customer_site",
  "site_instruction",
  "preference",
  "company_context",
  "other",
];

const entityScopes: BlakeKnowledgeScope[] = ["customer", "site", "lead", "quote", "job", "employee"];

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

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function category(value: unknown): BlakeKnowledgeCategory {
  return categories.includes(value as BlakeKnowledgeCategory) ? value as BlakeKnowledgeCategory : "other";
}

function entityScope(value: unknown): BlakeKnowledgeScope {
  if (!entityScopes.includes(value as BlakeKnowledgeScope)) throw new TypeError("That record type is not supported for Blake memory yet.");
  return value as BlakeKnowledgeScope;
}

function requireEntityPermission(scope: BlakeKnowledgeScope, context: BlakeExecutionContext, write: boolean) {
  if (scope === "customer" || scope === "site") {
    if (!context.access.showCustomers || (write && !context.access.canCustomize)) throw new Error("Your NeXa role cannot manage memory for that customer/site.");
  } else if (scope === "job") {
    if (!context.access.showJobs || (write && !context.access.canEditJobs)) throw new Error("Your NeXa role cannot manage memory for that job.");
  } else if (scope === "quote") {
    if (!context.access.showQuotes || (write && !context.access.canCreateQuote)) throw new Error("Your NeXa role cannot manage memory for that quote.");
  } else if (scope === "lead") {
    if (!(context.access.canCreateLead || context.access.showJobs || context.access.showQuotes) || (write && !context.access.canCreateLead)) throw new Error("Your NeXa role cannot manage memory for that lead.");
  } else if (scope === "employee") {
    if (!context.access.showSchedule || (write && !context.access.canCustomize)) throw new Error("Your NeXa role cannot manage memory for that employee.");
  }
}

function resolveEntity(scope: BlakeKnowledgeScope, reference: string, context: BlakeExecutionContext, write: boolean) {
  requireEntityPermission(scope, context, write);
  if (scope === "customer") {
    const record = requireClientFromHumanReference(reference);
    return { id: record.id, label: record.name };
  }
  if (scope === "site") {
    const record = requireSiteFromHumanReference(reference);
    return { id: record.id, label: record.name || record.address };
  }
  if (scope === "lead") {
    const record = requireLeadFromHumanReference(reference);
    return { id: record.id, label: `${record.ref} · ${record.customerName}` };
  }
  if (scope === "quote") {
    const record = requireQuoteFromHumanReference(reference);
    return { id: record.id, label: `${record.ref} · ${record.customer}` };
  }
  if (scope === "job") {
    const record = requireJobFromHumanReference(reference);
    return { id: record.id, label: `${record.ref} · ${record.customer}` };
  }
  if (scope === "employee") {
    const record = requireEmployeeFromHumanReference(reference);
    return { id: record.id, label: record.name };
  }
  throw new TypeError("That record type is not supported for Blake memory yet.");
}

export const findBlakeKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "find_blake_knowledge",
    description: "Find active persistent company knowledge and the current user's preferences. To retrieve record-linked knowledge, provide the record type and a natural reference such as a customer name, address, job description or job reference.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        scope: { enum: ["company", "user", ...entityScopes] },
        reference: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["query"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const scope = optionalString(raw.scope) as BlakeKnowledgeScope | undefined;
    return {
      query: requiredString(raw.query, "Knowledge query"),
      scope,
      reference: optionalString(raw.reference),
      limit: Math.max(1, Math.min(30, Number(raw.limit) || 12)),
    };
  },
  execute(input, context) {
    let scopeId: string | undefined;
    let label: string | undefined;
    if (input.scope && entityScopes.includes(input.scope)) {
      if (!input.reference) throw new TypeError("A natural record reference is required for record-linked knowledge.");
      const resolved = resolveEntity(input.scope, input.reference, context, false);
      scopeId = resolved.id;
      label = resolved.label;
    }
    return {
      query: input.query,
      record: label,
      items: listBlakeKnowledge({
        tenantId: context.actor.tenantId,
        actorId: context.actor.id,
        query: input.query,
        scopes: input.scope ? [input.scope] : undefined,
        scopeId,
        includeEntityScopes: Boolean(scopeId),
        limit: input.limit,
      }),
    };
  },
};

export const rememberCompanyKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "remember_company_knowledge",
    description: "Persist an explicit company-wide instruction, correction, rule, term, pricing rule or process. Use a stable key for the underlying rule so corrections update/version the same active knowledge rather than creating conflicts. Never use this for brainstorming or tentative ideas.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCustomize"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        category: { enum: categories },
        key: { type: "string", description: "Stable semantic key, e.g. sanitaryware-markup or work-area-structure." },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["category", "key", "title", "content"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      category: category(raw.category),
      key: requiredString(raw.key, "Knowledge key"),
      title: requiredString(raw.title, "Knowledge title"),
      content: requiredString(raw.content, "Knowledge content"),
    };
  },
  execute(input, context) {
    return saveBlakeKnowledge({
      tenantId: context.actor.tenantId,
      actorId: context.actor.id,
      actorName: context.actor.name,
      scope: "company",
      category: input.category,
      key: input.key,
      title: input.title,
      content: input.content,
      sourceConversationId: context.conversationId,
    });
  },
};

export const rememberUserPreferenceCapability: BlakeCapability = {
  definition: definition({
    name: "remember_user_preference",
    description: "Persist an explicit preference for the current user only. Use a stable key so later corrections update the same preference.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { key: { type: "string" }, title: { type: "string" }, content: { type: "string" } },
      required: ["key", "title", "content"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      key: requiredString(raw.key, "Preference key"),
      title: requiredString(raw.title, "Preference title"),
      content: requiredString(raw.content, "Preference content"),
    };
  },
  execute(input, context) {
    return saveBlakeKnowledge({
      tenantId: context.actor.tenantId,
      actorId: context.actor.id,
      actorName: context.actor.name,
      scope: "user",
      category: "preference",
      key: input.key,
      title: input.title,
      content: input.content,
      sourceConversationId: context.conversationId,
    });
  },
};

export const rememberEntityKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "remember_entity_knowledge",
    description: "Persist an explicit durable fact or preference against a specific authorised NeXa customer, site, lead, quote, job or employee. Resolve the natural record reference server-side. Prefer existing authoritative NeXa fields/notes when another capability already owns that fact.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { enum: entityScopes },
        reference: { type: "string" },
        category: { enum: categories },
        key: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["scope", "reference", "category", "key", "title", "content"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      scope: entityScope(raw.scope),
      reference: requiredString(raw.reference, "Record reference"),
      category: category(raw.category),
      key: requiredString(raw.key, "Knowledge key"),
      title: requiredString(raw.title, "Knowledge title"),
      content: requiredString(raw.content, "Knowledge content"),
    };
  },
  execute(input, context) {
    const entity = resolveEntity(input.scope, input.reference, context, true);
    return saveBlakeKnowledge({
      tenantId: context.actor.tenantId,
      actorId: context.actor.id,
      actorName: context.actor.name,
      scope: input.scope,
      scopeId: entity.id,
      category: input.category,
      key: input.key,
      title: input.title,
      content: input.content,
      sourceConversationId: context.conversationId,
      sourceEntityType: input.scope,
      sourceEntityId: entity.id,
    });
  },
};

export const updateKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "update_blake_knowledge",
    description: "Update/version one existing Blake knowledge item by id after finding it. This preserves revision history.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" }, title: { type: "string" }, content: { type: "string" }, category: { enum: categories } },
      required: ["id"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { id: requiredString(raw.id, "Knowledge id"), title: optionalString(raw.title), content: optionalString(raw.content), category: raw.category ? category(raw.category) : undefined };
  },
  execute(input, context) {
    const existing = listBlakeKnowledge({ tenantId: context.actor.tenantId, actorId: context.actor.id, includeInactive: true, includeEntityScopes: true, limit: 50 }).find((item) => item.id === input.id);
    if (!existing) throw new Error("That Blake knowledge item could not be found.");
    if (existing.scope === "company" && !context.access.canCustomize) throw new Error("Your NeXa role cannot change company knowledge.");
    if (entityScopes.includes(existing.scope)) requireEntityPermission(existing.scope, context, true);
    const updated = updateBlakeKnowledge({ ...input, tenantId: context.actor.tenantId, actorId: context.actor.id, actorName: context.actor.name, sourceConversationId: context.conversationId });
    if (!updated) throw new Error("That Blake knowledge item could not be updated.");
    return updated;
  },
};

export const forgetKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "forget_blake_knowledge",
    description: "Archive one persistent Blake knowledge item by id after finding the intended rule/preference. Archived knowledge stops being retrieved but provenance is retained.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: true,
    inputSchema: { type: "object", additionalProperties: false, properties: { id: { type: "string" } }, required: ["id"] },
  }),
  parse(input) {
    return { id: requiredString(objectInput(input).id, "Knowledge id") };
  },
  execute(input, context) {
    const existing = listBlakeKnowledge({ tenantId: context.actor.tenantId, actorId: context.actor.id, includeInactive: true, includeEntityScopes: true, limit: 50 }).find((item) => item.id === input.id);
    if (!existing) throw new Error("That Blake knowledge item could not be found.");
    if (existing.scope === "company" && !context.access.canCustomize) throw new Error("Your NeXa role cannot forget company knowledge.");
    if (entityScopes.includes(existing.scope)) requireEntityPermission(existing.scope, context, true);
    const archived = archiveBlakeKnowledge({ id: input.id, tenantId: context.actor.tenantId, actorId: context.actor.id });
    if (!archived) throw new Error("That Blake knowledge item could not be found.");
    return archived;
  },
};

// Keep the legacy tool name available for conversations/cards created before this change.
export const forgetCompanyKnowledgeCapability: BlakeCapability = {
  ...forgetKnowledgeCapability,
  definition: definition({
    ...forgetKnowledgeCapability.definition,
    name: "forget_company_knowledge",
    description: "Legacy alias for forgetting a Blake knowledge item. Prefer forget_blake_knowledge for new turns.",
    requiredPermissions: ["canCustomize"],
  }),
};

export const knowledgeCapabilities: BlakeCapability[] = [
  findBlakeKnowledgeCapability,
  rememberCompanyKnowledgeCapability,
  rememberUserPreferenceCapability,
  rememberEntityKnowledgeCapability,
  updateKnowledgeCapability,
  forgetKnowledgeCapability,
  forgetCompanyKnowledgeCapability,
];

import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import {
  deleteBlakeKnowledge,
  listBlakeKnowledge,
  saveBlakeKnowledge,
  type BlakeKnowledgeCategory,
} from "@/lib/blake-knowledge";

import type { BlakeCapability } from "./types";

const categories: BlakeKnowledgeCategory[] = [
  "business_rule",
  "terminology",
  "pricing_rule",
  "process",
  "reporting_preference",
  "customer_site",
  "preference",
  "other",
];

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

function category(value: unknown): BlakeKnowledgeCategory {
  return categories.includes(value as BlakeKnowledgeCategory) ? value as BlakeKnowledgeCategory : "other";
}

export const findBlakeKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "find_blake_knowledge",
    description: "Find persistent company knowledge and the current user's saved preferences. Use this for business rules, terminology, pricing rules, processes, reporting preferences and remembered instructions.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["query"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      query: requiredString(raw.query, "Knowledge query"),
      limit: Math.max(1, Math.min(30, Number(raw.limit) || 12)),
    };
  },
  execute(input, context) {
    return {
      query: input.query,
      items: listBlakeKnowledge({
        tenantId: context.actor.tenantId,
        actorId: context.actor.id,
        query: input.query,
        limit: input.limit,
      }),
    };
  },
};

export const rememberCompanyKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "remember_company_knowledge",
    description: "Persist an explicit company-wide instruction, correction, rule, term, pricing rule or process so Blake can use it in future conversations for this NeXa company only. This does not override authoritative NeXa configuration fields.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCustomize"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        category: { enum: categories },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["category", "title", "content"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
      category: category(raw.category),
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
      title: input.title,
      content: input.content,
      sourceConversationId: context.conversationId,
    });
  },
};

export const rememberUserPreferenceCapability: BlakeCapability = {
  definition: definition({
    name: "remember_user_preference",
    description: "Persist an explicit preference for the current user only, such as how they want reports presented or terminology they personally prefer.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["showCore"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["title", "content"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return {
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
      title: input.title,
      content: input.content,
      sourceConversationId: context.conversationId,
    });
  },
};

export const forgetCompanyKnowledgeCapability: BlakeCapability = {
  definition: definition({
    name: "forget_company_knowledge",
    description: "Delete one company-wide Blake knowledge item by its knowledge id when the user explicitly asks Blake to forget or remove it.",
    mode: "write",
    risk: "low",
    requiredPermissions: ["canCustomize"],
    requiresConfirmation: true,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    return { id: requiredString(raw.id, "Knowledge id") };
  },
  execute(input, context) {
    const deleted = deleteBlakeKnowledge({ id: input.id, tenantId: context.actor.tenantId, actorId: context.actor.id });
    if (!deleted) throw new Error("That Blake knowledge item could not be found.");
    return deleted;
  },
};

export const knowledgeCapabilities: BlakeCapability[] = [
  findBlakeKnowledgeCapability,
  rememberCompanyKnowledgeCapability,
  rememberUserPreferenceCapability,
  forgetCompanyKnowledgeCapability,
];

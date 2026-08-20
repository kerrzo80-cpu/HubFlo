import { createLead, type LeadDraftFromClient, type LeadCreationResult } from "@/lib/lead-store";

export type BlakeActionName = "create_lead";

export type BlakeActionContext = {
  actorId: string;
  actorName: string;
  tenantId: string;
  canCreateLead: boolean;
  workflowRunId: string;
};

export type BlakeActionRegistryEntry<Input, Output> = {
  name: BlakeActionName;
  description: string;
  execute: (input: Input, context: BlakeActionContext) => Output;
};

const createLeadAction: BlakeActionRegistryEntry<LeadDraftFromClient, LeadCreationResult> = {
  name: "create_lead",
  description: "Create a NeXa lead after CREATE_LEAD_V1 is complete and confirmed.",
  execute(input, context) {
    if (!context.canCreateLead) throw new Error("You don't have permission to create leads.");
    return createLead(input, `${context.actorName} via Blake (${context.workflowRunId})`);
  },
};

export const blakeActionRegistry = {
  create_lead: createLeadAction,
} as const;

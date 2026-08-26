import type { LeadDraftFromClient, LeadCreationResult } from "@/lib/lead-store";
import { getAccessProfile } from "@/lib/access";
import { blakeCore } from "@/lib/blake-core";

export type BlakeActionName = "create_lead";

export type BlakeActionContext = {
  actorId: string;
  actorName: string;
  tenantId: string;
  canCreateLead: boolean;
  workflowRunId: string;
  conversationId?: string;
};

export type BlakeActionRegistryEntry<Input, Output> = {
  name: BlakeActionName;
  description: string;
  execute: (input: Input, context: BlakeActionContext) => Promise<Output>;
};

const createLeadAction: BlakeActionRegistryEntry<LeadDraftFromClient, LeadCreationResult> = {
  name: "create_lead",
  description: "Create a NeXa lead after CREATE_LEAD_V1 is complete and confirmed.",
  async execute(input, context) {
    const result = await blakeCore.execute<LeadCreationResult>("create_lead", input, {
      actor: {
        id: context.actorId,
        name: context.actorName,
        tenantId: context.tenantId,
        channel: "web_text",
      },
      access: getAccessProfile("Read-only", { canCreateLead: context.canCreateLead }),
      confirmed: true,
    });
    if (!result.ok || !result.data) throw new Error(result.error?.message || "NeXa could not create the lead.");
    return result.data;
  },
};

export const blakeActionRegistry = {
  create_lead: createLeadAction,
} as const;

export const BLAKE_CORE_VERSION = 3 as const;

export type BlakeChannel = "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
export type BlakeCapabilityMode = "read" | "write";
export type BlakeRisk = "low" | "medium" | "high";

export type BlakeActor = {
  id: string;
  name: string;
  tenantId: string;
  channel: BlakeChannel;
};

export type BlakeCapabilityDefinition = {
  name: string;
  version: number;
  description: string;
  mode: BlakeCapabilityMode;
  risk: BlakeRisk;
  requiredPermissions: string[];
  inputSchema: Record<string, unknown>;
  requiresConfirmation: boolean;
};

export type BlakeCapabilityResult<T = unknown> = {
  ok: boolean;
  capability: string;
  executionId: string;
  data?: T;
  error?: {
    code: "INVALID_INPUT" | "FORBIDDEN" | "TENANT_MISMATCH" | "NOT_FOUND" | "EXECUTION_FAILED";
    message: string;
  };
};

export type BlakeConversationContext = {
  id: string;
  tenantId: string;
  actorId: string;
  channel: BlakeChannel;
  activeRecord?: { type: string; id: string; ref?: string };
  entities: Array<{ type: string; id: string; label: string }>;
  activeWorkflow?: { id: string; version: number; runId: string; status: string };
  lastCapability?: { name: string; executionId: string; completedAt: string };
  updatedAt: string;
};

export function previousCalendarMonth(now: Date) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

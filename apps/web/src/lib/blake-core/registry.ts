import type { BlakeCapabilityResult } from "@hubflo/domain";

import { appendAuditEvent } from "@/lib/people-data";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

import { patchBlakeContext } from "./context-store";
import type { BlakeCapability, BlakeExecutionContext, BlakeRegistry } from "./types";

type ExecutionLog = {
  id: string;
  capability: string;
  tenantId: string;
  actorId: string;
  channel: string;
  mode: string;
  ok: boolean;
  errorCode?: string;
  createdAt: string;
};

const executionStore = loadServerStore<{ executions: ExecutionLog[] }>("blake-capability-executions-v1", { executions: [] });

function hasPermission(context: BlakeExecutionContext, permission: string) {
  return context.access[permission as keyof typeof context.access] === true;
}

export function createBlakeCapabilityRegistry(capabilities: BlakeCapability[]): BlakeRegistry {
  // Later registrations intentionally override earlier implementations of the same
  // business capability. This lets Blake Core evolve without exposing duplicate tool names.
  const byName = new Map(capabilities.map((capability) => [capability.definition.name, capability]));
  return {
    definitions: () => [...byName.values()].map((capability) => structuredClone(capability.definition)),
    async execute<Output>(name: string, input: unknown, context: BlakeExecutionContext) {
      const executionId = `blake-execution-${crypto.randomUUID()}`;
      const capability = byName.get(name);
      let result: BlakeCapabilityResult<Output>;
      if (!context.actor.tenantId.trim()) {
        result = { ok: false, capability: name, executionId, error: { code: "TENANT_MISMATCH", message: "A trusted NeXa workspace is required." } };
      } else if (!capability) {
        result = { ok: false, capability: name, executionId, error: { code: "NOT_FOUND", message: `Blake capability ${name} is not registered.` } };
      } else if (capability.definition.requiredPermissions.some((permission) => !hasPermission(context, permission))) {
        result = { ok: false, capability: name, executionId, error: { code: "FORBIDDEN", message: "Your NeXa access does not allow that action." } };
      } else if (capability.definition.mode === "write" && capability.definition.requiresConfirmation && !context.confirmed) {
        result = { ok: false, capability: name, executionId, error: { code: "FORBIDDEN", message: "Please review and confirm this action before Blake writes to NeXa." } };
      } else {
        try {
          const parsed = capability.parse(input);
          const data = await capability.execute(parsed, context) as Output;
          result = { ok: true, capability: name, executionId, data };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Blake could not complete that capability.";
          const invalid = error instanceof TypeError;
          result = { ok: false, capability: name, executionId, error: { code: invalid ? "INVALID_INPUT" : "EXECUTION_FAILED", message } };
        }
      }

      const now = new Date().toISOString();
      executionStore.executions = [{
        id: executionId,
        capability: name,
        tenantId: context.actor.tenantId,
        actorId: context.actor.id,
        channel: context.actor.channel,
        mode: capability?.definition.mode ?? "unknown",
        ok: result.ok,
        errorCode: result.error?.code,
        createdAt: now,
      }, ...executionStore.executions].slice(0, 5000);
      writeServerStore("blake-capability-executions-v1", executionStore);
      if (context.conversationId) {
        patchBlakeContext(context.conversationId, context.actor.tenantId, context.actor.id, {
          lastCapability: { name, executionId, completedAt: now },
        });
      }
      if (capability?.definition.mode === "write") {
        appendAuditEvent({
          actor: context.actor.name,
          action: result.ok ? "Blake capability completed" : "Blake capability failed",
          recordType: "Blake",
          recordId: executionId,
          summary: `${name} via ${context.actor.channel}${result.error ? `: ${result.error.message}` : ""}`,
          source: "Blake",
          importance: result.ok ? "high" : "normal",
        });
      }
      return result;
    },
  };
}

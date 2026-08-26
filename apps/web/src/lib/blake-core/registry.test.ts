import assert from "node:assert/strict";
import test from "node:test";

import { getAccessProfile } from "../access";
import { createBlakeCapabilityRegistry } from "./registry";
import type { BlakeCapability } from "./types";

const readCapability: BlakeCapability<{ value: string }, { value: string }> = {
  definition: {
    name: "test_read", version: 1, description: "Test read", mode: "read", risk: "low",
    requiredPermissions: ["showJobs"], requiresConfirmation: false,
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
  },
  parse(input) {
    if (!input || typeof input !== "object" || typeof (input as { value?: unknown }).value !== "string") throw new TypeError("value is required");
    return { value: (input as { value: string }).value };
  },
  execute(input) { return input; },
};

const writeCapability: BlakeCapability<Record<string, never>, { written: true }> = {
  definition: {
    name: "test_write", version: 1, description: "Test write", mode: "write", risk: "medium",
    requiredPermissions: ["canEditJobs"], requiresConfirmation: true,
    inputSchema: { type: "object", additionalProperties: false },
  },
  parse() { return {}; },
  execute() { return { written: true }; },
};

function context(overrides?: { tenantId?: string; showJobs?: boolean; canEditJobs?: boolean; confirmed?: boolean }) {
  return {
    actor: { id: "user-1", name: "Brian", tenantId: overrides?.tenantId ?? "tenant-1", channel: "web_text" as const },
    access: getAccessProfile("Read-only", { showJobs: overrides?.showJobs, canEditJobs: overrides?.canEditJobs }),
    confirmed: overrides?.confirmed,
  };
}

test("registry denies capabilities when the user lacks the required permission", async () => {
  const registry = createBlakeCapabilityRegistry([readCapability]);
  const result = await registry.execute("test_read", { value: "safe" }, context({ showJobs: false }));
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "FORBIDDEN");
});

test("registry rejects execution without a trusted tenant", async () => {
  const registry = createBlakeCapabilityRegistry([readCapability]);
  const result = await registry.execute("test_read", { value: "safe" }, context({ tenantId: "", showJobs: true }));
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "TENANT_MISMATCH");
});

test("registry requires confirmation for writes and executes after confirmation", async () => {
  const registry = createBlakeCapabilityRegistry([writeCapability]);
  const blocked = await registry.execute("test_write", {}, context({ canEditJobs: true }));
  assert.equal(blocked.ok, false);
  assert.match(blocked.error?.message ?? "", /confirm/i);
  const completed = await registry.execute<{ written: true }>("test_write", {}, context({ canEditJobs: true, confirmed: true }));
  assert.equal(completed.ok, true);
  assert.deepEqual(completed.data, { written: true });
});

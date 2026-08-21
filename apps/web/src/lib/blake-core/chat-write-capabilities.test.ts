import assert from "node:assert/strict";
import test from "node:test";

import { roleAccess } from "@/lib/access";
import { removeLead } from "@/lib/lead-store";

import { createLeadCapability } from "./capabilities";
import { createLeadChatCapability } from "./chat-write-capabilities";
import { createBlakeCapabilityRegistry } from "./registry";

const registry = createBlakeCapabilityRegistry([createLeadCapability, createLeadChatCapability]);
const context = {
  actor: { id: "owner-test", name: "Owner Test", tenantId: "tenant-test", channel: "web_text" as const },
  access: roleAccess["Owner/Admin"],
};

test("capability registry exposes only the latest implementation for duplicate business capability names", () => {
  const definitions = registry.definitions().filter((item) => item.name === "create_lead");
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0]?.version, 4);
});

test("chat lead creation is confirmation gated and safely defaults optional contact/scheduling fields", async () => {
  const input = {
    customerName: `Blake Test ${Date.now()}`,
    address: "1 Test Street, Aberdeen",
    description: "Test leak",
    source: "Phone call",
  };

  const blocked = await registry.execute("create_lead", input, context);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error?.code, "FORBIDDEN");

  const created = await registry.execute<Record<string, unknown>>("create_lead", input, { ...context, confirmed: true });
  assert.equal(created.ok, true);
  assert.equal(created.data?.phone, "");
  assert.equal(created.data?.email, "");
  assert.equal(created.data?.status, "Needs scheduling");
  assert.equal(typeof created.data?.ref, "string");

  if (typeof created.data?.id === "string") removeLead(created.data.id);
});

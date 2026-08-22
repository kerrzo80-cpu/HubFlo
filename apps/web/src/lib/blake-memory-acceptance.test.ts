import assert from "node:assert/strict";
import test from "node:test";

import { roleAccess } from "@/lib/access";
import { saveBlakeKnowledge } from "@/lib/blake-knowledge";

import { blakeCore } from "./blake-core";

test("issue 208: personal preference is not visible to another user", async () => {
  const token = String(Date.now());
  const tenantId = `memory-user-${token}`;
  saveBlakeKnowledge({
    tenantId,
    actorId: "user-a",
    actorName: "User A",
    scope: "user",
    category: "preference",
    key: "profitability-layout",
    title: "Profitability layout",
    content: "Always show gross margin percentage.",
  });

  const owner = await blakeCore.execute<{ items: Array<{ content: string }> }>("find_blake_knowledge", { query: "gross margin" }, {
    actor: { id: "user-a", name: "User A", tenantId, channel: "web_text" },
    access: roleAccess["Owner/Admin"],
  });
  const colleague = await blakeCore.execute<{ items: Array<{ content: string }> }>("find_blake_knowledge", { query: "gross margin" }, {
    actor: { id: "user-b", name: "User B", tenantId, channel: "mobile_text" },
    access: roleAccess["Owner/Admin"],
  });

  assert.equal(owner.ok, true);
  assert.equal(owner.data?.items.some((item) => item.content.includes("gross margin")), true);
  assert.equal(colleague.ok, true);
  assert.equal(colleague.data?.items.some((item) => item.content.includes("gross margin")), false);
});

test("issue 208: company knowledge is shared across web and mobile channels", async () => {
  const token = String(Date.now());
  const tenantId = `memory-cross-device-${token}`;
  const write = await blakeCore.execute("remember_company_knowledge", {
    category: "terminology",
    key: "work-area-structure",
    title: "Work Areas and Cost Centres",
    content: "Work Areas are broad work categories and Cost Centres sit underneath them for specific work.",
  }, {
    actor: { id: "owner", name: "Owner", tenantId, channel: "web_text" },
    access: roleAccess["Owner/Admin"],
  });
  assert.equal(write.ok, true);

  const mobile = await blakeCore.execute<{ items: Array<{ content: string }> }>("find_blake_knowledge", { query: "work areas cost centres" }, {
    actor: { id: "owner", name: "Owner", tenantId, channel: "mobile_voice" },
    access: roleAccess["Owner/Admin"],
  });
  assert.equal(mobile.ok, true);
  assert.equal(mobile.data?.items.some((item) => item.content.includes("Cost Centres")), true);
});

test("issue 208: brainstorming is not a persistence capability side effect", () => {
  const names = blakeCore.definitions().map((item) => item.name);
  assert.equal(names.includes("remember_company_knowledge"), true);
  assert.equal(names.includes("remember_user_preference"), true);
  assert.equal(names.includes("remember_entity_knowledge"), true);
  assert.equal(names.includes("update_blake_knowledge"), true);
  assert.equal(names.includes("forget_blake_knowledge"), true);
  // Persistence remains an explicit tool call. Merely discussing a rate cannot mutate knowledge.
});

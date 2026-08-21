import assert from "node:assert/strict";
import test from "node:test";

import { deleteBlakeKnowledge, listBlakeKnowledge, saveBlakeKnowledge } from "./blake-knowledge";

test("Blake company knowledge is tenant scoped and user preferences remain private to that user", () => {
  const token = String(Date.now());
  const company = saveBlakeKnowledge({
    tenantId: `tenant-a-${token}`,
    actorId: "user-a",
    actorName: "User A",
    scope: "company",
    category: "pricing_rule",
    title: `Test labour rule ${token}`,
    content: "Standard labour selling rate is £70/hour.",
  });
  const personal = saveBlakeKnowledge({
    tenantId: `tenant-a-${token}`,
    actorId: "user-a",
    actorName: "User A",
    scope: "user",
    category: "preference",
    title: `Test reporting preference ${token}`,
    content: "Show margin percentage first.",
  });

  const ownerView = listBlakeKnowledge({ tenantId: `tenant-a-${token}`, actorId: "user-a", query: "labour margin", limit: 20 });
  assert.equal(ownerView.some((item) => item.id === company.id), true);
  assert.equal(ownerView.some((item) => item.id === personal.id), true);

  const colleagueView = listBlakeKnowledge({ tenantId: `tenant-a-${token}`, actorId: "user-b", query: "labour margin", limit: 20 });
  assert.equal(colleagueView.some((item) => item.id === company.id), true);
  assert.equal(colleagueView.some((item) => item.id === personal.id), false);

  const otherTenant = listBlakeKnowledge({ tenantId: `tenant-b-${token}`, actorId: "user-a", query: "labour", limit: 20 });
  assert.equal(otherTenant.some((item) => item.id === company.id), false);

  deleteBlakeKnowledge({ id: company.id, tenantId: `tenant-a-${token}`, actorId: "user-a" });
  deleteBlakeKnowledge({ id: personal.id, tenantId: `tenant-a-${token}`, actorId: "user-a" });
});

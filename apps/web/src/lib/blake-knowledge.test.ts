import assert from "node:assert/strict";
import test from "node:test";

import { archiveBlakeKnowledge, listBlakeKnowledge, saveBlakeKnowledge } from "./blake-knowledge";

test("Blake company knowledge is tenant scoped and user preferences remain private to that user", () => {
  const token = String(Date.now());
  const company = saveBlakeKnowledge({
    tenantId: `tenant-a-${token}`,
    actorId: "user-a",
    actorName: "User A",
    scope: "company",
    category: "pricing_rule",
    key: `labour-rate-${token}`,
    title: `Test labour rule ${token}`,
    content: "Standard labour selling rate is £70/hour.",
  });
  const personal = saveBlakeKnowledge({
    tenantId: `tenant-a-${token}`,
    actorId: "user-a",
    actorName: "User A",
    scope: "user",
    category: "preference",
    key: `report-layout-${token}`,
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

  archiveBlakeKnowledge({ id: company.id, tenantId: `tenant-a-${token}`, actorId: "user-a" });
  archiveBlakeKnowledge({ id: personal.id, tenantId: `tenant-a-${token}`, actorId: "user-a" });
});

test("a stable knowledge key versions a correction instead of keeping two conflicting active rules", () => {
  const token = String(Date.now());
  const tenantId = `tenant-correction-${token}`;
  const first = saveBlakeKnowledge({
    tenantId,
    actorId: "owner",
    actorName: "Owner",
    scope: "company",
    category: "pricing_rule",
    key: "sanitaryware-markup",
    title: "Sanitaryware markup",
    content: "Sanitaryware markup is 30%.",
  });
  const corrected = saveBlakeKnowledge({
    tenantId,
    actorId: "owner",
    actorName: "Owner",
    scope: "company",
    category: "pricing_rule",
    key: "sanitaryware markup",
    title: "Sanitaryware pricing",
    content: "Sanitaryware markup is 20%.",
  });

  assert.equal(corrected.id, first.id);
  assert.equal(corrected.version, 2);
  assert.equal(corrected.content, "Sanitaryware markup is 20%.");
  assert.equal(corrected.revisions.at(-1)?.content, "Sanitaryware markup is 30%.");
  const active = listBlakeKnowledge({ tenantId, actorId: "owner", query: "sanitaryware markup", limit: 20 });
  assert.equal(active.filter((item) => item.key === "sanitaryware-markup").length, 1);
  assert.equal(active.find((item) => item.key === "sanitaryware-markup")?.content, "Sanitaryware markup is 20%.");
});

test("record-linked knowledge is not exposed by generic company retrieval and can be targeted by resolved scope id", () => {
  const token = String(Date.now());
  const tenantId = `tenant-record-${token}`;
  const item = saveBlakeKnowledge({
    tenantId,
    actorId: "owner",
    actorName: "Owner",
    scope: "site",
    scopeId: "site-smith",
    category: "site_instruction",
    key: "appointment-time",
    title: "Preferred appointment time",
    content: "Customer only wants appointments after 2pm.",
    sourceEntityType: "site",
    sourceEntityId: "site-smith",
  });

  assert.equal(listBlakeKnowledge({ tenantId, actorId: "owner", query: "appointments" }).some((row) => row.id === item.id), false);
  assert.equal(listBlakeKnowledge({ tenantId, actorId: "owner", query: "appointments", scopes: ["site"], scopeId: "site-smith", includeEntityScopes: true }).some((row) => row.id === item.id), true);
});

test("irrelevant query returns no arbitrary recent memories and archived knowledge stops retrieval", () => {
  const token = String(Date.now());
  const tenantId = `tenant-relevance-${token}`;
  const item = saveBlakeKnowledge({
    tenantId,
    actorId: "owner",
    actorName: "Owner",
    scope: "company",
    category: "terminology",
    key: "work-area-structure",
    title: "Work Areas and Cost Centres",
    content: "Work Areas are broad categories and Cost Centres sit underneath them.",
  });

  assert.equal(listBlakeKnowledge({ tenantId, actorId: "owner", query: "completely unrelated bananas" }).length, 0);
  assert.equal(listBlakeKnowledge({ tenantId, actorId: "owner", query: "work areas cost centres" }).some((row) => row.id === item.id), true);
  archiveBlakeKnowledge({ id: item.id, tenantId, actorId: "owner" });
  assert.equal(listBlakeKnowledge({ tenantId, actorId: "owner", query: "work areas cost centres" }).some((row) => row.id === item.id), false);
});

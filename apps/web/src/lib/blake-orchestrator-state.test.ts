import assert from "node:assert/strict";
import test from "node:test";

import {
  getBlakeOrchestratorConversation,
  getBlakePendingAction,
  rememberBlakeTool,
  removeBlakePendingAction,
  saveBlakePendingAction,
} from "./blake-orchestrator-state";

test("orchestrator retains recent tool results for conversational follow-ups", () => {
  const token = String(Date.now());
  const conversationId = `conversation-${token}`;
  rememberBlakeTool({
    conversationId,
    tenantId: `tenant-${token}`,
    actorId: `actor-${token}`,
    memory: {
      capability: "list_jobs",
      input: { bucket: "pending" },
      output: { count: 29, rows: [{ ref: "J-1001", customer: "Test Customer" }] },
      createdAt: new Date().toISOString(),
    },
  });

  const conversation = getBlakeOrchestratorConversation({
    id: conversationId,
    tenantId: `tenant-${token}`,
    actorId: `actor-${token}`,
  });
  assert.equal(conversation?.recentTools[0]?.capability, "list_jobs");
  assert.equal((conversation?.recentTools[0]?.output as { count?: number })?.count, 29);
});

test("pending write confirmation is isolated by tenant and actor", () => {
  const token = String(Date.now());
  const action = saveBlakePendingAction({
    id: `blake-orchestrator-${token}`,
    tenantId: `tenant-${token}`,
    actorId: `actor-${token}`,
    actorName: "Test Actor",
    conversationId: `conversation-${token}`,
    channel: "web_text",
    capability: "create_quote",
    input: { customer: "Test", description: "Test quote" },
    title: "Create Quote",
    detail: "Customer: Test",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });

  assert.equal(getBlakePendingAction({ id: action.id, tenantId: action.tenantId, actorId: action.actorId })?.id, action.id);
  assert.equal(getBlakePendingAction({ id: action.id, tenantId: "other-tenant", actorId: action.actorId }), null);
  assert.equal(getBlakePendingAction({ id: action.id, tenantId: action.tenantId, actorId: "other-actor" }), null);

  removeBlakePendingAction(action.id);
});

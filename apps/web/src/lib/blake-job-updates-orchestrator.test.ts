import assert from "node:assert/strict";
import test from "node:test";

import { roleAccess } from "@/lib/access";
import { getJobAttentionAlerts, getJobOfficeUpdates, resetJobOfficeUpdatesForTests } from "@/lib/job-office-updates";
import { resetWorkflowStore, saveJob } from "@/lib/workflow-data";

import { handleBlakeOrchestratedMessage } from "./blake-orchestrator";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const actor = {
  id: "blake-job-update-test-owner",
  name: "Blake Job Update Test Owner",
  tenantId: "blake-job-update-test-tenant",
  channel: "mobile_voice" as const,
};

function resetJobUpdateFixture() {
  resetWorkflowStore();
  saveJob({
    id: "job-1052",
    ref: "J-1052",
    customer: "Morrison & Co.",
    site: "42 Queen's Road, Aberdeen",
    description: "Office heating upgrade",
    manager: "Blake Test Manager",
    status: "In progress",
    health: "green",
    value: 18_900,
    next: "Engineer visit",
    due: "Tomorrow",
  });
  resetJobOfficeUpdatesForTests();
}

async function withMockOpenAi(
  responder: (body: Record<string, unknown>, call: number) => Response | Promise<Response>,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  let calls = 0;
  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return responder(body, calls);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
}

test("Blake can capture an actionable job note immediately from a voice-style turn", async () => {
  resetJobUpdateFixture();

  await withMockOpenAi((_body, call) => {
    if (call === 1) {
      return jsonResponse({
        id: "resp-job-note-1",
        output: [{
          type: "function_call",
          name: "add_job_note",
          call_id: "call-job-note",
          arguments: JSON.stringify({
            job: "J-1052",
            text: "Customer wants the controls moved to the opposite wall.",
            noteType: "Customer request",
            priority: "High",
            followUpRequired: true,
          }),
        }],
      });
    }
    return jsonResponse({
      id: "resp-job-note-2",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "Done — I added that to J-1052 and put it in Attention for the office." }],
      }],
    });
  }, async () => {
    const result = await handleBlakeOrchestratedMessage({
      message: "Add a note to that job saying the customer wants the controls moved to the opposite wall and make sure the office sees it.",
      actor,
      access: roleAccess["Owner/Admin"],
      history: [
        { role: "user", text: "Tell me about J-1052." },
        { role: "assistant", text: "J-1052 is Morrison & Co. at Queen's Road." },
      ],
      conversationId: `job-note-${Date.now()}`,
      timeZone: "Europe/London",
    });

    assert.match(result?.reply || "", /added that to J-1052/i);
    assert.equal(result?.action, undefined, "low-risk note capture should not require a second confirmation tap while driving");
    const updates = getJobOfficeUpdates(actor.tenantId, "J-1052");
    assert.equal(updates.notes.length, 1);
    assert.equal(updates.notes[0]?.attentionStatus, "Open");
    assert.equal(getJobAttentionAlerts(actor.tenantId).filter((item) => item.type === "Job note").length, 1);
  });
});

test("Blake prepares a draft variation but does not create it before confirmation", async () => {
  resetJobUpdateFixture();

  await withMockOpenAi(() => jsonResponse({
    id: "resp-job-var-1",
    output: [{
      type: "function_call",
      name: "create_job_variation",
      call_id: "call-job-var",
      arguments: JSON.stringify({
        job: "J-1052",
        description: "Extra pipe boxing requested after opening the wall.",
        priority: "Medium",
      }),
    }],
  }), async () => {
    const result = await handleBlakeOrchestratedMessage({
      message: "Add a variation to that job for extra pipe boxing after opening the wall.",
      actor,
      access: roleAccess["Owner/Admin"],
      history: [
        { role: "user", text: "Tell me about J-1052." },
        { role: "assistant", text: "J-1052 is Morrison & Co. at Queen's Road." },
      ],
      conversationId: `job-variation-${Date.now()}`,
      timeZone: "Europe/London",
    });

    assert.equal(result?.action?.kind, "confirm_blake_orchestrator_action");
    assert.match(result?.action?.title || "", /Create Job Variation/i);
    assert.match(result?.action?.detail || "", /extra pipe boxing/i);
    assert.equal(getJobOfficeUpdates(actor.tenantId, "J-1052").variations.length, 0, "no draft variation should exist before confirmation");
    assert.equal(getJobAttentionAlerts(actor.tenantId).length, 0);
  });
});

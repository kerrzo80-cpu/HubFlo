import assert from "node:assert/strict";
import test from "node:test";

import { roleAccess } from "@/lib/access";

import { handleBlakeOrchestratedMessage } from "./blake-orchestrator";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const actor = {
  id: "blake-orchestrator-test-owner",
  name: "Blake Test Owner",
  tenantId: "blake-orchestrator-test-tenant",
  channel: "web_text" as const,
};

async function withMockOpenAi(
  responder: (body: Record<string, unknown>, call: number) => Response | Promise<Response>,
  run: (bodies: Record<string, unknown>[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const bodies: Record<string, unknown>[] = [];
  let calls = 0;
  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    bodies.push(body);
    return responder(body, calls);
  }) as typeof fetch;
  try {
    await run(bodies);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
}

test("Blake uses a NeXa capability and feeds the result back into the same AI turn", async () => {
  await withMockOpenAi((_body, call) => {
    if (call === 1) {
      return jsonResponse({
        id: "resp-tool-1",
        output: [{
          type: "function_call",
          name: "list_jobs",
          call_id: "call-list-jobs",
          arguments: JSON.stringify({ bucket: "pending", limit: 5 }),
        }],
      });
    }
    return jsonResponse({
      id: "resp-tool-2",
      output: [{ type: "message", content: [{ type: "output_text", text: "I checked NeXa and found the pending jobs." }] }],
    });
  }, async (bodies) => {
    const result = await handleBlakeOrchestratedMessage({
      message: "Which jobs are waiting to start?",
      actor,
      access: roleAccess["Owner/Admin"],
      history: [],
      conversationId: `tool-loop-${Date.now()}`,
      timeZone: "Europe/London",
    });

    assert.equal(result?.reply, "I checked NeXa and found the pending jobs.");
    assert.equal(bodies.length, 2);
    const secondInput = bodies[1]?.input as Array<Record<string, unknown>>;
    assert.equal(secondInput?.[0]?.type, "function_call_output");
    assert.equal(secondInput?.[0]?.call_id, "call-list-jobs");
  });
});

test("recent tool results are carried into the next conversational turn", async () => {
  const conversationId = `follow-up-${Date.now()}`;
  await withMockOpenAi((_body, call) => call === 1
    ? jsonResponse({
      id: "resp-follow-1",
      output: [{ type: "function_call", name: "list_jobs", call_id: "call-follow-list", arguments: JSON.stringify({ bucket: "pending", limit: 5 }) }],
    })
    : jsonResponse({ id: "resp-follow-2", output: [{ type: "message", content: [{ type: "output_text", text: "Here are the pending jobs." }] }] }), async () => {
    await handleBlakeOrchestratedMessage({
      message: "Show me the pending jobs",
      actor,
      access: roleAccess["Owner/Admin"],
      conversationId,
      timeZone: "Europe/London",
    });
  });

  await withMockOpenAi((body) => {
    assert.match(String(body.instructions || ""), /Recent NeXa tool results from this conversation/);
    assert.match(String(body.instructions || ""), /list_jobs/);
    return jsonResponse({ id: "resp-follow-3", output: [{ type: "message", content: [{ type: "output_text", text: "Yes — I’m still referring to those pending jobs." }] }] });
  }, async () => {
    const result = await handleBlakeOrchestratedMessage({
      message: "Are they booked in?",
      actor,
      access: roleAccess["Owner/Admin"],
      history: [
        { role: "user", text: "Show me the pending jobs" },
        { role: "assistant", text: "Here are the pending jobs." },
      ],
      conversationId,
      timeZone: "Europe/London",
    });
    assert.match(result?.reply || "", /those pending jobs/i);
  });
});

test("consequential write calls become a confirmation instead of executing immediately", async () => {
  await withMockOpenAi(() => jsonResponse({
    id: "resp-write-1",
    output: [{
      type: "function_call",
      name: "create_quote",
      call_id: "call-create-quote",
      arguments: JSON.stringify({ customer: "Test Test", description: "Test Quote", value: 1500 }),
    }],
  }), async () => {
    const result = await handleBlakeOrchestratedMessage({
      message: "Create a quote for Test Test called Test Quote for £1,500",
      actor,
      access: roleAccess["Owner/Admin"],
      conversationId: `write-${Date.now()}`,
      timeZone: "Europe/London",
    });
    assert.equal(result?.action?.kind, "confirm_blake_orchestrator_action");
    assert.match(result?.action?.detail || "", /Test Test/);
    assert.match(result?.action?.detail || "", /1,500/);
  });
});

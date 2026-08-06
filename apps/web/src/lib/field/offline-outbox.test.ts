import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

const listeners: Record<string, Array<(event: { key?: string }) => void>> = {};

function installBrowserMocks() {
  (globalThis as { window?: unknown }).window = {
    localStorage: localStorageMock,
    addEventListener: (type: string, listener: (event: { key?: string }) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
}

test("enqueueOutboxItem stores workflow kinds and flushOutbox clears on success", async () => {
  installBrowserMocks();
  storage.clear();

  const fetchCalls: Array<{ path: string; body?: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ path, body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const { enqueueOutboxItem, listOutbox, flushOutbox } = await import("./offline-outbox");

  enqueueOutboxItem({
    kind: "outcome",
    jobId: "job-1",
    path: "/api/field/jobs/sch-1/workflow",
    method: "POST",
    body: { action: "set_outcome", payload: { status: "Complete" } },
  });
  enqueueOutboxItem({
    kind: "note",
    jobId: "job-1",
    path: "/api/field/jobs/sch-1/workflow",
    method: "POST",
    body: { action: "add_note", payload: { text: "Left keys with concierge" } },
  });
  enqueueOutboxItem({
    kind: "hours",
    jobId: "eng-1",
    path: "/api/field/time-check",
    method: "POST",
    body: { action: "submit", payload: {} },
  });

  assert.equal(listOutbox().length, 3);
  assert.deepEqual(listOutbox().map((item) => item.kind), ["outcome", "note", "hours"]);

  const remaining = await flushOutbox();
  assert.equal(remaining.length, 0);
  assert.equal(fetchCalls.length, 3);
  assert.equal(fetchCalls[0].path, "/api/field/jobs/sch-1/workflow");
  assert.equal(fetchCalls[0].body?.action, "set_outcome");
  assert.equal(fetchCalls[2].path, "/api/field/time-check");

  globalThis.fetch = originalFetch;
});

test("enqueueOutboxItem rejects invalid kinds", async () => {
  installBrowserMocks();
  storage.clear();
  const { enqueueOutboxItem } = await import("./offline-outbox");
  assert.throws(
    () =>
      enqueueOutboxItem({
        kind: "unknown" as "photo",
        jobId: "job-1",
        path: "/api/test",
        method: "POST",
      }),
    /invalid outbox item/i,
  );
});

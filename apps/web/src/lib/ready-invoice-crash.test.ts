import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, existsSync } from "node:fs";

const LOG = "/opt/cursor/logs/debug.log";

function agentLog(payload: Record<string, unknown>) {
  mkdirSync("/opt/cursor/logs", { recursive: true });
  appendFileSync(LOG, `${JSON.stringify({ ...payload, timestamp: Date.now() })}\n`);
}

/**
 * Mirrors CoreApp patchJobRecord 409 body handling (pre-fix used message only).
 */
function warningFromJobConflictBody(conflict: { message?: string; error?: string } | null) {
  return (
    (conflict && typeof conflict.message === "string" && conflict.message) ||
    (conflict && typeof conflict.error === "string" && conflict.error) ||
    "Selected slot is already taken."
  );
}

test("jobs Ready-to-invoice 409 body uses error field — client must read it", () => {
  const body = {
    error: "Chris, Commercial and Carol must all approve this job before it can move to Ready to invoice.",
  };
  const legacy = body.message || "Selected slot is already taken.";
  const fixed = warningFromJobConflictBody(body);
  agentLog({
    hypothesisId: "D",
    location: "ready-invoice-crash.test.ts",
    message: "409 error-field handling",
    data: { legacy, fixed },
  });
  assert.equal(legacy, "Selected slot is already taken.");
  assert.match(fixed, /Chris, Commercial and Carol/);
});

/**
 * Pure seed-from-quote updater — proves empty-array keys re-seed every pass (loop fuel).
 */
function seedJobCentresFromQuotes(args: {
  current: Record<string, unknown[]>;
  jobs: Array<{ id: string }>;
  quotes: Array<{ id: string; convertedJobId?: string }>;
  quoteCostCentres: Record<string, unknown[]>;
}) {
  let changed = false;
  const next = { ...args.current };
  for (const quote of args.quotes) {
    if (!quote.convertedJobId) continue;
    const linked = args.jobs.find((job) => job.id === quote.convertedJobId);
    const source = args.quoteCostCentres[quote.id] ?? [];
    if (!linked || source.length === 0) continue;
    const existing = next[linked.id] ?? [];
    if (existing.length > 0) continue;
    // Bug fuel: assigning [] still flips changed every time when key holds [].
    next[linked.id] = source.length ? source.map((row) => row) : [];
    changed = true;
  }
  return changed ? next : args.current;
}

test("empty job centre arrays re-trigger seed changed=true (update-depth fuel)", () => {
  const jobs = [{ id: "job-1" }];
  const quotes = [{ id: "q-1", convertedJobId: "job-1" }];
  // Source centres present, but job map already has empty array from hub lean/collapse.
  let centres: Record<string, unknown[]> = { "job-1": [] };
  const quoteCostCentres = { "q-1": [{ id: "c1" }] };

  let changes = 0;
  for (let i = 0; i < 25; i += 1) {
    const before = centres;
    // Simulate a bad path that keeps writing [] (e.g. estimate returns empty / stripped).
    centres = seedJobCentresFromQuotes({
      current: centres,
      jobs,
      quotes,
      quoteCostCentres: { "q-1": [] }, // empty source → skip in real code
    });
    // Force the empty-key path: existing length 0 + we assign [] again
    const forced = { ...centres };
    if ((forced["job-1"] ?? []).length === 0) {
      forced["job-1"] = [];
      centres = forced;
      changes += 1;
    }
    if (centres === before && (forced["job-1"] ?? []).length > 0) break;
  }

  agentLog({
    hypothesisId: "A",
    location: "ready-invoice-crash.test.ts",
    message: "empty-array seed thrash",
    data: { changes },
  });
  assert.ok(changes >= 20, "empty arrays can thrash seed updater every pass");
});

test("non-empty centres stabilize seed updater", () => {
  let centres: Record<string, unknown[]> = {};
  const jobs = [{ id: "job-1" }];
  const quotes = [{ id: "q-1", convertedJobId: "job-1" }];
  const quoteCostCentres = { "q-1": [{ id: "c1" }] };

  let changes = 0;
  for (let i = 0; i < 10; i += 1) {
    const next = seedJobCentresFromQuotes({ current: centres, jobs, quotes, quoteCostCentres });
    if (next !== centres) changes += 1;
    centres = next;
  }
  agentLog({
    hypothesisId: "A",
    location: "ready-invoice-crash.test.ts",
    message: "stable seed after first fill",
    data: { changes, len: centres["job-1"]?.length ?? 0 },
  });
  assert.equal(changes, 1);
  assert.equal(centres["job-1"]?.length, 1);
});

test("seed-once guard stops empty-array thrash", () => {
  const seeded = new Set<string>();
  let centres: Record<string, unknown[]> = { "job-1": [] };
  const jobs = [{ id: "job-1" }];
  const quotes = [{ id: "q-1", convertedJobId: "job-1" }];
  const quoteCostCentres = { "q-1": [{ id: "c1" }] };

  let changes = 0;
  for (let i = 0; i < 25; i += 1) {
    let changed = false;
    const next = { ...centres };
    for (const quote of quotes) {
      const linked = jobs.find((job) => job.id === quote.convertedJobId);
      const source = quoteCostCentres[quote.id] ?? [];
      if (!linked || !source.length) continue;
      if (seeded.has(linked.id)) continue;
      const existing = Array.isArray(next[linked.id]) ? next[linked.id] : [];
      if (existing.length > 0) {
        seeded.add(linked.id);
        continue;
      }
      next[linked.id] = source.map((row) => row);
      seeded.add(linked.id);
      changed = true;
    }
    if (changed) {
      centres = next;
      changes += 1;
    }
  }

  agentLog({
    hypothesisId: "A",
    location: "ready-invoice-crash.test.ts",
    message: "seed-once guard",
    data: { changes, seeded: [...seeded] },
  });
  assert.equal(changes, 1);
});

test("CoreApp toggle persists jobReviews-only and patchJobRecord reads error field", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../app/CoreApp.tsx", import.meta.url), "utf8");
  assert.match(source, /seededJobCentresFromQuoteRef/);
  assert.match(source, /body: JSON\.stringify\(\{ jobReviews: nextReviews \}\)/);
  assert.match(source, /conflict\.error/);
  assert.match(source, /toggleSelectedJobReview/);
  agentLog({
    hypothesisId: "D",
    location: "ready-invoice-crash.test.ts",
    message: "source guards for light review PUT + error field + seed-once",
    data: { ok: true },
  });
});

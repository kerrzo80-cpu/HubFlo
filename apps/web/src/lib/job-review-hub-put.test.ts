import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import test from "node:test";

import { mergeHubDetailState } from "@/lib/hub-state-merge";
import {
  assertNoHubScheduleClashes,
  type HubScheduleAssignment,
} from "@/lib/schedule-clash";

const LOG = "/opt/cursor/logs/debug.log";

function agentLog(message: string, hypothesisId: string, data: Record<string, unknown>) {
  mkdirSync("/opt/cursor/logs", { recursive: true });
  appendFileSync(
    LOG,
    `${JSON.stringify({ location: "job-review-hub-put.test.ts", message, hypothesisId, data, timestamp: Date.now() })}\n`,
  );
}

/**
 * Mirrors hub-state PUT clash gating: only when payload includes jobSchedulePlans
 * AND JSON.stringify(before) !== JSON.stringify(after).
 */
function wouldBlockReviewSave(args: {
  serverPlans: Record<string, HubScheduleAssignment[]>;
  clientPlans: Record<string, HubScheduleAssignment[]> | undefined;
  leadAssignments?: HubScheduleAssignment[];
}) {
  if (args.clientPlans === undefined) {
    return { blocked: false, reason: "no-schedule-in-payload" as const, clashError: null as string | null };
  }
  const before = JSON.stringify(args.serverPlans ?? {});
  const after = JSON.stringify(args.clientPlans ?? {});
  if (before === after) {
    return { blocked: false, reason: "schedules-unchanged" as const, clashError: null as string | null };
  }
  const merged = mergeHubDetailState(
    { jobSchedulePlans: args.serverPlans },
    { jobSchedulePlans: args.clientPlans },
  );
  const clashError = assertNoHubScheduleClashes(
    (merged.jobSchedulePlans || {}) as Record<string, HubScheduleAssignment[]>,
    args.leadAssignments || [],
  );
  return {
    blocked: Boolean(clashError),
    reason: clashError ? ("schedule-clash" as const) : ("schedules-changed-ok" as const),
    clashError,
  };
}

const overlappingA: HubScheduleAssignment = {
  id: "a1",
  jobId: "job-a",
  employeeId: "eng-1",
  employeeName: "Alex",
  startDate: "2026-08-20",
  startTime: "09:00",
  endDate: "2026-08-20",
  endTime: "12:00",
  costCentreName: "Plant",
};

const overlappingB: HubScheduleAssignment = {
  id: "b1",
  jobId: "job-b",
  employeeId: "eng-1",
  employeeName: "Alex",
  startDate: "2026-08-20",
  startTime: "10:00",
  endDate: "2026-08-20",
  endTime: "13:00",
  costCentreName: "Pipework",
};

/** Mirrors post-fix hub-state signature — key order must not count as a change. */
function hubSchedulePlansSignature(plans: Record<string, HubScheduleAssignment[]>): string {
  const rows: string[] = [];
  for (const [jobId, list] of Object.entries(plans || {})) {
    for (const row of list || []) {
      rows.push(
        [
          jobId,
          row.id || "",
          row.employeeId || "",
          row.employeeName || "",
          row.startDate || "",
          row.startTime || "",
          row.endDate || "",
          row.endTime || "",
        ].join("|"),
      );
    }
  }
  rows.sort();
  return rows.join("\n");
}

test("hypothesis A: JSON key-order drift used to re-trigger clash gate on full hub payload", () => {
  // Server has clashes already (imported). Client sends same assignments but different top-level key order
  // — JSON.stringify then treats plans as "changed" and re-runs the clash gate.
  const serverPlans = { "job-a": [overlappingA], "job-b": [overlappingB] };
  const clientPlans = { "job-b": [overlappingB], "job-a": [overlappingA] };

  assert.notEqual(JSON.stringify(serverPlans), JSON.stringify(clientPlans));
  assert.equal(hubSchedulePlansSignature(serverPlans), hubSchedulePlansSignature(clientPlans));

  const legacyStringifyGate = wouldBlockReviewSave({ serverPlans, clientPlans });
  agentLog("full payload clash gate (legacy stringify)", "A", {
    blocked: legacyStringifyGate.blocked,
    reason: legacyStringifyGate.reason,
    clashError: legacyStringifyGate.clashError,
    stringifyDiffers: true,
    signatureEqual: true,
  });

  assert.equal(legacyStringifyGate.blocked, true);
  assert.match(String(legacyStringifyGate.clashError), /Schedule clash blocked/);
});

test("post-fix: stable schedule signature treats key-order-only drift as unchanged", () => {
  const serverPlans = { "job-a": [overlappingA], "job-b": [overlappingB] };
  const clientPlans = { "job-b": [overlappingB], "job-a": [overlappingA] };
  const unchanged = hubSchedulePlansSignature(serverPlans) === hubSchedulePlansSignature(clientPlans);
  agentLog("stable signature gate", "A", { unchanged, runId: "post-fix" });
  assert.equal(unchanged, true);
});

test("hypothesis A fix path: jobReviews-only payload skips schedule clash gate", () => {
  const serverPlans = { "job-a": [overlappingA], "job-b": [overlappingB] };
  const result = wouldBlockReviewSave({
    serverPlans,
    clientPlans: undefined, // omit jobSchedulePlans — approve should send reviews only
  });
  agentLog("reviews-only payload clash gate", "A", {
    blocked: result.blocked,
    reason: result.reason,
  });
  assert.equal(result.blocked, false);
  assert.equal(result.reason, "no-schedule-in-payload");
});

test("merge keeps server schedules when client sends jobReviews only", () => {
  const server = {
    jobSchedulePlans: { "job-a": [overlappingA], "job-b": [overlappingB] },
    jobReviews: { "job-x": { construction: false, commercial: false, office: false } },
  };
  const client = {
    jobReviews: {
      "job-x": { construction: true, commercial: true, office: true },
    },
  };
  const merged = mergeHubDetailState(server, client);
  assert.deepEqual(merged.jobReviews?.["job-x"], {
    construction: true,
    commercial: true,
    office: true,
  });
  assert.ok(merged.jobSchedulePlans?.["job-a"]);
  assert.ok(merged.jobSchedulePlans?.["job-b"]);
  agentLog("reviews-only merge preserves schedules", "A", {
    reviewComplete: true,
    scheduleJobs: Object.keys(merged.jobSchedulePlans || {}),
  });
});

test("CoreApp approveSelectedJobForInvoice sends jobReviews-only hub PUT", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../app/CoreApp.tsx", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function approveSelectedJobForInvoice()");
  assert.ok(fnStart > 0);
  const fnBody = source.slice(fnStart, fnStart + 3500);
  assert.match(fnBody, /const reviewPayload = \{ jobReviews: nextReviews \}/);
  assert.doesNotMatch(fnBody, /buildHubDetailStatePayload\(\)/);
  agentLog("approve uses reviews-only payload", "A", { runId: "post-fix", reviewsOnly: true });
});

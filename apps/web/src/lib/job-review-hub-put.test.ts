import assert from "node:assert/strict";
import test from "node:test";

import { mergeHubDetailState } from "@/lib/hub-state-merge";
import {
  assertNoHubScheduleClashes,
  type HubScheduleAssignment,
} from "@/lib/schedule-clash";

/**
 * Mirrors legacy hub-state PUT clash gating: only when payload includes jobSchedulePlans
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

/** Mirrors hub-state signature — key order must not count as a change. */
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

test("JSON key-order drift used to re-trigger clash gate on full hub payload", () => {
  // Server has clashes already (imported). Client sends same assignments but different top-level key order
  // — JSON.stringify then treats plans as "changed" and re-runs the clash gate.
  const serverPlans = { "job-a": [overlappingA], "job-b": [overlappingB] };
  const clientPlans = { "job-b": [overlappingB], "job-a": [overlappingA] };

  assert.notEqual(JSON.stringify(serverPlans), JSON.stringify(clientPlans));
  assert.equal(hubSchedulePlansSignature(serverPlans), hubSchedulePlansSignature(clientPlans));

  const legacyStringifyGate = wouldBlockReviewSave({ serverPlans, clientPlans });
  assert.equal(legacyStringifyGate.blocked, true);
  assert.match(String(legacyStringifyGate.clashError), /Schedule clash blocked/);
});

test("stable schedule signature treats key-order-only drift as unchanged", () => {
  const serverPlans = { "job-a": [overlappingA], "job-b": [overlappingB] };
  const clientPlans = { "job-b": [overlappingB], "job-a": [overlappingA] };
  assert.equal(hubSchedulePlansSignature(serverPlans), hubSchedulePlansSignature(clientPlans));
});

test("jobReviews-only payload skips schedule clash gate", () => {
  const serverPlans = { "job-a": [overlappingA], "job-b": [overlappingB] };
  const result = wouldBlockReviewSave({
    serverPlans,
    clientPlans: undefined, // omit jobSchedulePlans — approve should send reviews only
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
});

test("merge jobReviews sticky-OR refuses stale client unticks", () => {
  const server = {
    jobReviews: {
      "job-x": { construction: true, commercial: true, office: true },
    },
  };
  const client = {
    jobReviews: {
      "job-x": { construction: false, commercial: false, office: false },
      "job-y": { construction: true, commercial: false, office: false },
    },
  };
  const merged = mergeHubDetailState(server, client);
  assert.deepEqual(merged.jobReviews?.["job-x"], {
    construction: true,
    commercial: true,
    office: true,
  });
  assert.deepEqual(merged.jobReviews?.["job-y"], {
    construction: true,
    commercial: false,
    office: false,
  });
});

test("CoreApp approveSelectedJobForInvoice uses atomic passaround API", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../app/CoreApp.tsx", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function approveSelectedJobForInvoice()");
  assert.ok(fnStart > 0);
  const brace = source.indexOf("{", fnStart);
  let depth = 0;
  let fnEnd = brace;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        fnEnd = i + 1;
        break;
      }
    }
  }
  const fnBody = source.slice(fnStart, fnEnd);
  assert.match(fnBody, /action: "ready-to-invoice"/);
  assert.match(fnBody, /postJobPassaround/);
  assert.doesNotMatch(fnBody, /persistJobReviewsForInvoice/);
  assert.doesNotMatch(fnBody, /buildHubDetailStatePayload\(\)/);
  // Must not auto-open invoice (that white-screened live after Ready to invoice).
  assert.doesNotMatch(fnBody, /openInvoiceForJob\(/);
  // Minimal hot path — folder switch / audit / review-edit were thrash vectors.
  assert.doesNotMatch(fnBody, /setActiveJobFolderKey\(/);
  assert.doesNotMatch(fnBody, /logAuditEvent\(/);
  assert.doesNotMatch(fnBody, /markJobReviewEdited\(/);
});

test("CoreApp completeSelectedJob uses minimal hot path", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../app/CoreApp.tsx", import.meta.url), "utf8");
  const fnStart = source.indexOf("async function completeSelectedJob()");
  assert.ok(fnStart > 0);
  const brace = source.indexOf("{", fnStart);
  let depth = 0;
  let fnEnd = brace;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        fnEnd = i + 1;
        break;
      }
    }
  }
  const fnBody = source.slice(fnStart, fnEnd);
  assert.match(fnBody, /action: "complete"/);
  assert.match(fnBody, /postJobPassaround/);
  assert.doesNotMatch(fnBody, /setActiveJobFolderKey\(/);
  assert.doesNotMatch(fnBody, /logAuditEvent\(/);
  assert.doesNotMatch(fnBody, /patchSelectedJob\(/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkInvoiceReadiness,
  type InvoiceReadinessInput,
} from "./invoice-readiness";

const readyJob: InvoiceReadinessInput = {
  requiredTasks: { complete: 4, total: 4 },
  openBlockers: 0,
  unresolvedVariations: 0,
  completionNoteSubmitted: true,
  requiredPhotos: { complete: 3, total: 3 },
  requiredDocuments: { complete: 1, total: 1 },
  timesheetsSubmitted: true,
  materialCostsConfirmed: true,
  finalJobValueConfirmed: true,
};

test("allows invoicing only when every gate passes", () => {
  assert.deepEqual(checkInvoiceReadiness(readyJob), {
    ready: true,
    completedChecks: 9,
    totalChecks: 9,
    reasons: [],
  });
});

test("returns specific reasons for every failed gate", () => {
  const result = checkInvoiceReadiness({
    ...readyJob,
    requiredTasks: { complete: 3, total: 4 },
    openBlockers: 1,
    materialCostsConfirmed: false,
  });

  assert.equal(result.ready, false);
  assert.equal(result.completedChecks, 6);
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["TASKS_INCOMPLETE", "OPEN_BLOCKERS", "MATERIAL_COSTS_UNCONFIRMED"],
  );
});


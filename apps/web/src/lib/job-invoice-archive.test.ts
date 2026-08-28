import assert from "node:assert/strict";
import test from "node:test";

import {
  jobIsArchivedStatus,
  jobPatchAfterFullInvoiceSent,
  shouldMarkJobInvoicedForClaim,
} from "./job-invoice-archive.ts";

test("shouldMarkJobInvoicedForClaim only allows full or blank claims", () => {
  assert.equal(shouldMarkJobInvoicedForClaim(undefined), true);
  assert.equal(shouldMarkJobInvoicedForClaim("full"), true);
  assert.equal(shouldMarkJobInvoicedForClaim("deposit"), false);
  assert.equal(shouldMarkJobInvoicedForClaim("progress-claim"), false);
  assert.equal(shouldMarkJobInvoicedForClaim("valuation"), false);
});

test("jobPatchAfterFullInvoiceSent marks job Invoiced for archived folder", () => {
  const patch = jobPatchAfterFullInvoiceSent("INV-1001", "2026-09-15");
  assert.equal(patch.status, "Invoiced");
  assert.equal(patch.health, "green");
  assert.match(String(patch.next), /INV-1001/);
  assert.equal(patch.due, "2026-09-15");
});

test("jobIsArchivedStatus recognises invoiced and closed jobs", () => {
  assert.equal(jobIsArchivedStatus("Invoiced"), true);
  assert.equal(jobIsArchivedStatus("Closed"), true);
  assert.equal(jobIsArchivedStatus("Ready to invoice"), false);
});

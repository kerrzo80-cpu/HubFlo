import assert from "node:assert/strict";
import test from "node:test";

import { invoiceDraftPendingXeroSend, invoiceEligibleForXeroExport } from "./xero-export-queue.ts";

test("invoiceEligibleForXeroExport excludes draft valuations and exported rows", () => {
  assert.equal(
    invoiceEligibleForXeroExport({
      status: "Draft",
      claimType: "full",
      lines: [{}],
      accountsStatus: "Not sent",
    }),
    false,
  );
  assert.equal(
    invoiceEligibleForXeroExport({
      status: "Sent",
      claimType: "valuation",
      lines: [{}],
      accountsStatus: "Not sent",
    }),
    false,
  );
  assert.equal(
    invoiceEligibleForXeroExport({
      status: "Sent",
      claimType: "full",
      lines: [{}],
      accountsStatus: "Sent",
    }),
    false,
  );
  assert.equal(
    invoiceEligibleForXeroExport({
      status: "Sent",
      claimType: "full",
      lines: [{}],
      accountsStatus: "Not sent",
    }),
    true,
  );
});

test("invoiceDraftPendingXeroSend flags draft invoices waiting for send", () => {
  assert.equal(
    invoiceDraftPendingXeroSend({
      status: "Draft",
      claimType: "full",
      lines: [{}],
    }),
    true,
  );
  assert.equal(
    invoiceDraftPendingXeroSend({
      status: "Sent",
      claimType: "full",
      lines: [{}],
    }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { jobInvoiceReviewComplete } from "./job-invoice-review";

test("requires all three role approvals", () => {
  assert.equal(jobInvoiceReviewComplete(null), false);
  assert.equal(jobInvoiceReviewComplete({ construction: true, commercial: true, office: false }), false);
  assert.equal(jobInvoiceReviewComplete({ construction: true, commercial: true, office: true }), true);
});

test("does not accept legacy or truthy non-boolean approval values", () => {
  assert.equal(jobInvoiceReviewComplete({ site: true, commercial: true, finance: true }), false);
  assert.equal(jobInvoiceReviewComplete({ construction: 1, commercial: true, office: true }), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  findInvoiceByPortalToken,
  invoicePortalUrl,
  makeInvoicePortalToken,
  resolveInvoicePortalToken,
} from "./invoice-portal.ts";

const sample = {
  id: "inv-simpro-4063-abc",
  ref: "INV-SIMPRO-4063",
  customer: "Test",
} as const;

test("makeInvoicePortalToken builds ref-id slug", () => {
  assert.equal(makeInvoicePortalToken(sample), "inv-simpro-4063-inv-simp");
});

test("findInvoiceByPortalToken matches derived token without stored portalToken", () => {
  const invoices = [{ ...sample, portalToken: undefined }];
  const token = makeInvoicePortalToken(sample);
  assert.equal(findInvoiceByPortalToken(invoices, token)?.id, sample.id);
});

test("findInvoiceByPortalToken matches stored portalToken", () => {
  const invoices = [{ ...sample, portalToken: "custom-token-123" }];
  assert.equal(findInvoiceByPortalToken(invoices, "custom-token-123")?.id, sample.id);
});

test("resolveInvoicePortalToken prefers stored value", () => {
  assert.equal(resolveInvoicePortalToken({ ...sample, portalToken: "saved" }), "saved");
  assert.equal(resolveInvoicePortalToken(sample), makeInvoicePortalToken(sample));
});

test("invoicePortalUrl encodes unique token per invoice", () => {
  const url = invoicePortalUrl(sample, "https://nexa-live.onrender.com");
  assert.match(url, /\/client\/invoices\/inv-simpro-4063-inv-simp$/);
});

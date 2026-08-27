import assert from "node:assert/strict";
import test from "node:test";

import { invoiceEligibleForXeroPaymentSync } from "./xero-payment-sync";
import { validateInvoiceForXeroPaymentPull } from "./xero-payment-pull";

test("invoiceEligibleForXeroPaymentSync requires exported invoice", () => {
  assert.equal(
    invoiceEligibleForXeroPaymentSync({
      status: "Sent",
      ref: "INV-1",
      xeroInvoiceId: "xero-1",
    }),
    true,
  );
  assert.equal(
    invoiceEligibleForXeroPaymentSync({
      status: "Sent",
      ref: "INV-2",
      xeroExportedAt: "2026-08-01T00:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    invoiceEligibleForXeroPaymentSync({
      status: "Sent",
      ref: "INV-3",
      accountsStatus: "Sent to Xero",
    }),
    false,
  );
  assert.equal(
    invoiceEligibleForXeroPaymentSync({
      status: "Sent",
      ref: "INV-4",
    }),
    false,
  );
  assert.equal(
    invoiceEligibleForXeroPaymentSync({
      status: "Draft",
      ref: "INV-5",
      xeroInvoiceId: "xero-5",
    }),
    false,
  );
  assert.equal(
    invoiceEligibleForXeroPaymentSync({
      status: "Sent",
      claimType: "valuation",
      ref: "INV-6",
      xeroInvoiceId: "xero-6",
    }),
    false,
  );
});

test("validateInvoiceForXeroPaymentPull blocks valuations and drafts", () => {
  assert.equal(
    validateInvoiceForXeroPaymentPull({
      id: "1",
      ref: "INV-1",
      chargeTotal: 100,
      vatRate: 20,
      claimType: "valuation",
      status: "Sent",
    }),
    "Convert the valuation to a progress claim before pulling Xero payments.",
  );
  assert.equal(
    validateInvoiceForXeroPaymentPull({
      id: "2",
      ref: "INV-2",
      chargeTotal: 100,
      vatRate: 20,
      status: "Draft",
    }),
    "Draft or cancelled invoices cannot pull Xero payments.",
  );
  assert.equal(
    validateInvoiceForXeroPaymentPull({
      id: "3",
      ref: "INV-3",
      chargeTotal: 100,
      vatRate: 20,
      claimType: "progress-claim",
      status: "Sent",
    }),
    null,
  );
});

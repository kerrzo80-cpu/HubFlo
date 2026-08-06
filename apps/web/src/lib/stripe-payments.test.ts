import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyStripePaymentToInvoice, invoiceOwed } from "./stripe-payments";
import { getHubDetailState, saveHubDetailState } from "./hub-detail-store";

describe("stripe payments ledger", () => {
  it("applies a Stripe payment and is idempotent on payment intent", () => {
    const hub = getHubDetailState();
    const invoice = {
      id: "inv-stripe-test-1",
      ref: "INV-STRIPE-1",
      customer: "Acme Ltd",
      title: "Test",
      chargeTotal: 100,
      vatRate: 20,
      status: "Sent",
      paymentStatus: "Unpaid",
      paidAmount: 0,
      payments: [],
      portalToken: "inv-stripe-1-token",
    };
    saveHubDetailState({
      ...hub,
      invoices: [invoice, ...((hub.invoices as unknown[]) || []).filter((row) => (row as { id?: string }).id !== invoice.id)],
    });

    const first = applyStripePaymentToInvoice({
      invoiceId: invoice.id,
      amount: 120,
      paymentIntentId: "pi_test_1",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.duplicate, false);
    assert.equal(first.invoice.paidAmount, 120);
    assert.equal(first.invoice.paymentStatus, "Paid");

    const second = applyStripePaymentToInvoice({
      invoiceId: invoice.id,
      amount: 120,
      paymentIntentId: "pi_test_1",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.duplicate, true);
    assert.equal(second.invoice.paidAmount, 120);

    assert.equal(invoiceOwed(second.invoice), 0);
  });
});

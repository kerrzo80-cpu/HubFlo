import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getHubDetailState, saveHubDetailState } from "./hub-detail-store";
import { applySumUpPaymentToInvoice, invoiceOwed } from "./sumup-payments";

describe("sumup payments ledger", () => {
  it("applies a SumUp payment and is idempotent on checkout id", () => {
    const hub = getHubDetailState();
    const invoice = {
      id: "inv-sumup-test-1",
      ref: "INV-SUMUP-1",
      customer: "Acme Ltd",
      title: "Test",
      chargeTotal: 100,
      vatRate: 20,
      status: "Sent",
      paymentStatus: "Unpaid",
      paidAmount: 0,
      payments: [],
      portalToken: "inv-sumup-1-token",
    };
    saveHubDetailState({
      ...hub,
      invoices: [invoice, ...((hub.invoices as unknown[]) || []).filter((row) => (row as { id?: string }).id !== invoice.id)],
    });

    const first = applySumUpPaymentToInvoice({
      invoiceId: invoice.id,
      amount: 120,
      checkoutId: "chk_test_1",
      transactionCode: "TX1",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.duplicate, false);
    assert.equal(first.invoice.paidAmount, 120);
    assert.equal(first.invoice.paymentStatus, "Paid");

    const second = applySumUpPaymentToInvoice({
      invoiceId: invoice.id,
      amount: 120,
      checkoutId: "chk_test_1",
      transactionCode: "TX1",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.duplicate, true);
    assert.equal(second.invoice.paidAmount, 120);
    assert.equal(invoiceOwed(second.invoice), 0);
  });
});

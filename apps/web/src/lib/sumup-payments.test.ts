import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

describe("sumup payments ledger", () => {
  it("applies a SumUp payment and is idempotent on checkout id", async (t) => {
    const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-sumup-"));
    process.env.NEXA_STORE_DIR = storeDir;
    process.env.NEXA_STORE_PATH = "";
    process.env.NEXA_WORKSPACE_MODE = "live";
    t.after(() => rmSync(storeDir, { recursive: true, force: true }));

    const { writeServerStore } = await import("./server-store");
    writeServerStore("people-store", { clients: [], clientSites: [], auditEvents: [] });
    writeServerStore("hub-detail-store", {
      invoices: [
        {
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
        },
      ],
    });

    const { applySumUpPaymentToInvoice, invoiceOwed } = await import("./sumup-payments");

    const first = applySumUpPaymentToInvoice({
      invoiceId: "inv-sumup-test-1",
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
      invoiceId: "inv-sumup-test-1",
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

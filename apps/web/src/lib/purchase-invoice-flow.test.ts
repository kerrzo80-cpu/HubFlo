import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decidePendingInvoiceAdjustment,
  purchaseRequestActualCost,
  purchaseRequestNetInvoicedCost,
  purchaseRequestThreeWayMatch,
  submitSupplierCreditNote,
  submitSupplierInvoice,
} from "@/lib/purchase-invoice-flow";
import type { PurchaseRequest } from "@/lib/workflow-data";

function basePo(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: "po-1",
    jobId: "job-1",
    jobRef: "J-100",
    requestedBy: "Office",
    supplier: "Parts Co",
    item: "Valves",
    estimatedCost: 100,
    reason: "Site need",
    status: "Received",
    poNumber: "PO-100",
    createdAt: "2026-08-01T10:00:00.000Z",
    receivedAt: "2026-08-02T10:00:00.000Z",
    lines: [
      {
        id: "line-1",
        description: "Pump valve",
        quantity: 2,
        estimatedCost: 100,
        actualCost: 100,
        receivedPercent: 100,
      },
    ],
    ...overrides,
  };
}

describe("purchase invoice flow", () => {
  it("saves a first supplier invoice without approval", () => {
    const po = basePo({ status: "Pending cost", receivedAt: undefined, lines: [{
      id: "line-1",
      description: "Pump valve",
      quantity: 2,
      estimatedCost: 100,
      actualCost: 100,
      receivedPercent: 0,
    }] });
    const result = submitSupplierInvoice(po, {
      amount: 100,
      reference: "INV-1",
      fileName: "inv-1.pdf",
      uploadedBy: "Accounts",
    });
    assert.equal(result.requiresApproval, false);
    assert.equal(result.document.status, "Approved");
    assert.equal(result.patch.supplierInvoiceAmount, 100);
    assert.equal(result.patch.supplierInvoiceRef, "INV-1");
  });

  it("queues a second invoice on a receipted PO for approval and can add lines when approved", () => {
    const first = submitSupplierInvoice(basePo({ status: "Part received" }), {
      amount: 100,
      reference: "INV-1",
      fileName: "inv-1.pdf",
      uploadedBy: "Accounts",
    });
    const receipted: PurchaseRequest = {
      ...basePo(),
      ...first.patch,
      status: "Received",
      supplierInvoiceDocuments: first.patch.supplierInvoiceDocuments,
    };
    const second = submitSupplierInvoice(receipted, {
      amount: 40,
      reference: "INV-2",
      fileName: "inv-2.pdf",
      uploadedBy: "Accounts",
      proposedLines: [{ description: "Extra gasket pack", quantity: 1, actualCost: 40 }],
    });
    assert.equal(second.requiresApproval, true);
    assert.equal(second.document.status, "Pending approval");
    assert.equal(second.patch.status, "Disputed");
    assert.ok(second.adjustment);

    const approved = decidePendingInvoiceAdjustment(
      { ...receipted, ...second.patch },
      second.adjustment!.id,
      "Approved",
      "Manager",
    );
    assert.equal(approved.adjustment.status, "Approved");
    assert.equal((approved.patch.lines || []).some((line) => line.description === "Extra gasket pack"), true);
    assert.ok((approved.patch.actualCost || 0) >= 140);
    assert.equal(purchaseRequestNetInvoicedCost({ ...receipted, ...approved.patch }), 140);
  });

  it("applies a supplier credit note and reduces PO / job actual cost", () => {
    const po = basePo({
      supplierInvoiceAmount: 100,
      invoiceFileName: "inv.pdf",
      invoiceReceivedAt: "2026-08-02T12:00:00.000Z",
      actualCost: 100,
    });
    const before = purchaseRequestActualCost(po);
    assert.equal(before, 100);

    const credit = submitSupplierCreditNote(po, {
      creditAmount: 25,
      reference: "CN-9",
      fileName: "cn-9.pdf",
      uploadedBy: "Accounts",
      applyNow: true,
      lines: [{ purchaseOrderLineId: "line-1", description: "Pump valve credit", creditAmount: 25 }],
    });
    assert.equal(credit.credit.status, "Applied");
    const next = { ...po, ...credit.patch };
    assert.equal(purchaseRequestActualCost(next), 75);
    assert.equal(purchaseRequestNetInvoicedCost(next), 75);
    const match = purchaseRequestThreeWayMatch(next);
    assert.equal(match.invoiced, 75);
  });
});

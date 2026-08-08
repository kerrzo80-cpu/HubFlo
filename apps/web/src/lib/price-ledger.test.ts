import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyFirmSupplierCost,
  derivePricingState,
  stampBudgetPrice,
  stampGuidePrice,
  stampRfqPrice,
} from "./price-ledger";

describe("price-ledger", () => {
  it("derives budget / guide / rfq / firm from source and cost", () => {
    assert.equal(derivePricingState({ pricingSource: "blake-budget", unitCost: 12 }), "budget");
    assert.equal(derivePricingState({ pricingSource: "rate-library", unitCost: 4 }), "guide");
    assert.equal(derivePricingState({ unitCost: 0, supplierRequired: true }), "rfq");
    assert.equal(derivePricingState({ status: "Supplier RFQ" }), "rfq");
    assert.equal(derivePricingState({ pricingSource: "supplier", unitCost: 18 }), "firm");
  });

  it("stamps budget and firm correctly", () => {
    const budget = stampBudgetPrice({ id: "a", description: "15mm copper" }, 4.5);
    assert.equal(budget.pricingState, "budget");
    assert.equal(budget.pricingSource, "blake-budget");
    assert.equal(budget.supplierRequired, true);

    const firm = applyFirmSupplierCost(budget, 5.1, { note: "Wolseley quote" });
    assert.equal(firm.pricingState, "firm");
    assert.equal(firm.unitCost, 5.1);
    assert.equal(firm.supplierRequired, false);
    assert.equal(firm.pricingSource, "supplier");
  });

  it("guide and rfq helpers set provenance", () => {
    const guide = stampGuidePrice({ id: "b" }, 7.8);
    assert.equal(guide.pricingState, "guide");
    const rfq = stampRfqPrice({ id: "c", unitCost: 0 });
    assert.equal(rfq.pricingState, "rfq");
    assert.equal(rfq.supplierRequired, true);
  });
});

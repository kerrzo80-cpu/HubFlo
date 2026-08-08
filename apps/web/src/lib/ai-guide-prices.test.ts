import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyGuidePricesToKit, summariseGuidePricing } from "./ai-guide-prices";
import type { KitLine } from "./heat-design/types";

describe("ai-guide-prices", () => {
  it("fills £0 kit lines from library / soft guides", () => {
    const lines: KitLine[] = [
      { id: "1", category: "Emitters", description: "TRV", qty: 4, unitCost: 0, unit: "nr", required: true },
      { id: "2", category: "Pipework", description: "15mm Copper tube", qty: 12, unitCost: 0, unit: "m", required: true },
      { id: "3", category: "Plant", description: "Mystery widget XYZ", qty: 1, unitCost: 0, unit: "nr", required: true },
      { id: "4", category: "Emitters", description: "Lockshield valve", qty: 4, unitCost: 12, unit: "nr", required: true },
    ];
    const priced = applyGuidePricesToKit(lines);
    assert.ok((priced[0]?.unitCost || 0) > 0);
    assert.ok((priced[1]?.unitCost || 0) > 0);
    assert.equal(priced[2]?.unitCost, 0);
    assert.equal(priced[3]?.unitCost, 12);
    const summary = summariseGuidePricing(priced);
    assert.equal(summary.rfqLines, 1);
    assert.ok(summary.pricedLines >= 3);
  });
});

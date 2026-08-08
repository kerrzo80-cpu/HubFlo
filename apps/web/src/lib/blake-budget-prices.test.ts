import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyTaggedGuidePrices, budgetPriceKitWithBlake, kitBudgetSummary } from "./blake-budget-prices";
import type { KitLine } from "./heat-design/types";

const sample: KitLine[] = [
  { id: "a", category: "Emitters", description: "TRV", qty: 3, unitCost: 0, unit: "nr", required: true },
  { id: "b", category: "Mystery", description: "Obscure flange XYZ-99", qty: 1, unitCost: 0, unit: "nr", required: true },
];

describe("blake-budget-prices", () => {
  it("tags rate-library fills", () => {
    const priced = applyTaggedGuidePrices(sample);
    assert.equal(priced[0]?.pricingSource, "rate-library");
    assert.ok((priced[0]?.unitCost || 0) > 0);
  });

  it("falls back without OpenAI and summarises budget", async () => {
    const previous = process.env.OPENAI_API_KEY;
    const previousNexa = process.env.NEXA_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NEXA_OPENAI_API_KEY;
    try {
      const result = await budgetPriceKitWithBlake(sample);
      assert.equal(result.aiUsed, false);
      assert.equal(result.connected, false);
      assert.ok(result.pricedCount >= 1);
      const summary = kitBudgetSummary(result.lines);
      assert.ok(summary.budgetTotal >= 0);
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
      if (previousNexa !== undefined) process.env.NEXA_OPENAI_API_KEY = previousNexa;
    }
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { previousJobMaterialsCost, previousQuoteLinesSell } from "./quote-export.ts";

test("previousJobMaterialsCost totals existing centre materials", () => {
  assert.equal(previousJobMaterialsCost(undefined), 0);
  assert.equal(
    previousJobMaterialsCost([
      { quantity: 2, unitCost: 50 },
      { quantity: 1, unitCost: 25.5 },
    ]),
    125.5,
  );
});

test("previousQuoteLinesSell prefers unitSell", () => {
  assert.equal(
    previousQuoteLinesSell([
      { quantity: 1, unitSell: 100, unitCost: 70 },
      { quantity: 2, unitCost: 10 },
    ]),
    120,
  );
});

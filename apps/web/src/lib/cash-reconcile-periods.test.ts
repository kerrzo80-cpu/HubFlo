import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getLastReconciled,
  markReconciled,
  resetCashReconcilePeriodsForTests,
} from "./cash-reconcile-periods";

describe("cash reconcile periods", () => {
  it("marks and returns the last reconciled period", () => {
    resetCashReconcilePeriodsForTests();
    assert.equal(getLastReconciled(), null);

    const first = markReconciled("2026-08", "Brian");
    assert.equal(first.periodKey, "2026-08");
    assert.equal(first.reconciledBy, "Brian");

    const last = getLastReconciled();
    assert.equal(last?.periodKey, "2026-08");

    const second = markReconciled("2026-09");
    assert.equal(second.periodKey, "2026-09");
    assert.equal(getLastReconciled()?.periodKey, "2026-09");
  });

  it("rejects empty period keys", () => {
    resetCashReconcilePeriodsForTests();
    assert.throws(() => markReconciled(""), /periodKey is required/);
  });
});

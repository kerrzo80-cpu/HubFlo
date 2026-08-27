import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideJobValueSync,
  isOscillatingValueHistory,
  JOB_VALUE_SYNC_CIRCUIT_BREAKER,
  PASSAROUND_HOLD_MS,
} from "./job-value-sync";

describe("decideJobValueSync", () => {
  it("skips simPRO and frozen jobs", () => {
    assert.equal(
      decideJobValueSync({ headerValue: 100, nextValue: 200, isSimpro: true }).action,
      "skip",
    );
    assert.equal(
      decideJobValueSync({ headerValue: 100, nextValue: 200, frozen: true }).action,
      "skip",
    );
  });

  it("noops when header already matches centre total", () => {
    const decision = decideJobValueSync({ headerValue: 147.75, nextValue: 147.75 });
    assert.equal(decision.action, "noop");
    if (decision.action === "noop") assert.equal(decision.nextValue, 147.75);
  });

  it("skips when lastSynced already equals nextValue", () => {
    assert.equal(
      decideJobValueSync({
        headerValue: 100,
        nextValue: 160.75,
        lastSynced: 160.75,
      }).action,
      "skip",
    );
  });

  it("freezes A↔B oscillation (gas-cert style thrash)", () => {
    const decision = decideJobValueSync({
      headerValue: 147.75,
      nextValue: 160.75,
      history: [147.75, 160.75, 147.75],
    });
    assert.equal(decision.action, "freeze");
    assert.equal(isOscillatingValueHistory([147.75, 160.75, 147.75, 160.75]), true);
  });

  it("skips updates while passaround hold is active after a prior sync", () => {
    assert.equal(
      decideJobValueSync({
        headerValue: 100,
        nextValue: 200,
        lastSynced: 100,
        holdActive: true,
      }).action,
      "skip",
    );
  });

  it("updates when values differ and no hold/oscillation", () => {
    const decision = decideJobValueSync({
      headerValue: 100,
      nextValue: 250,
      history: [100],
    });
    assert.equal(decision.action, "update");
    if (decision.action === "update") {
      assert.equal(decision.nextValue, 250);
      assert.deepEqual(decision.history, [100, 250]);
    }
  });

  it("exports hold and circuit-breaker constants used by the hot path", () => {
    assert.equal(PASSAROUND_HOLD_MS, 8000);
    assert.equal(JOB_VALUE_SYNC_CIRCUIT_BREAKER, 20);
  });
});

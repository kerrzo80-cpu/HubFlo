import assert from "node:assert/strict";
import test from "node:test";

import {
  getBlakeAiUsage,
  recordBlakeAiDirectCost,
  resetBlakeAiUsageForTests,
} from "@/lib/blake-ai-usage";

test("Standard Voice minute-priced transcription is included in Blake AI spend", () => {
  const previousTenant = process.env.NEXA_TENANT_KEY;
  process.env.NEXA_TENANT_KEY = "voice-cost-test";
  resetBlakeAiUsageForTests();

  try {
    // Two minutes at the current gpt-transcribe rate of $0.0045/minute.
    recordBlakeAiDirectCost({ model: "gpt-transcribe", estimatedCostUsd: 0.009 });
    const usage = getBlakeAiUsage();
    assert.equal(usage.calls, 1);
    assert.equal(usage.estimatedCostUsd, 0.009);
    assert.equal(usage.byModel["gpt-transcribe"]?.estimatedCostUsd, 0.009);
  } finally {
    resetBlakeAiUsageForTests();
    if (previousTenant === undefined) delete process.env.NEXA_TENANT_KEY;
    else process.env.NEXA_TENANT_KEY = previousTenant;
  }
});

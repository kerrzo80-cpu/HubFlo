import test from "node:test";
import assert from "node:assert/strict";

import { estimateOpenAiCostUsd, extractOpenAiUsage } from "./blake-ai-usage";

test("Luna usage cost includes cached input discount", () => {
  const cost = estimateOpenAiCostUsd({
    model: "gpt-5.6-luna",
    inputTokens: 10_000,
    cachedInputTokens: 5_000,
    outputTokens: 1_000,
  });
  assert.equal(cost, 0.0023);
});

test("extracts Responses API token usage", () => {
  assert.deepEqual(extractOpenAiUsage({
    model: "gpt-5.6-terra",
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      input_tokens_details: { cached_tokens: 400 },
    },
  }), {
    model: "gpt-5.6-terra",
    inputTokens: 1200,
    outputTokens: 300,
    cachedInputTokens: 400,
  });
});

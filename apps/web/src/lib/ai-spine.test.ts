import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAiSpine } from "./ai-spine";
import { resetHeatDesignStoreForTests } from "./heat-design-store";

describe("ai-spine", () => {
  it("creates linked heat design + takeoff from a brief (rule path)", async () => {
    resetHeatDesignStoreForTests();
    const previous = process.env.OPENAI_API_KEY;
    const previousNexa = process.env.NEXA_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NEXA_OPENAI_API_KEY;
    try {
      const result = await runAiSpine({
        customerName: "Spine Test Ltd",
        siteAddress: "1 Test Lane",
        postcode: "AB1 2CD",
        jobType: "ASHP replacement",
        notes: "Air source heat pump with radiators",
        preferAshp: true,
      });
      assert.equal(result.ok, true);
      assert.ok(result.heatDesign.id);
      assert.ok(result.takeoff.id);
      assert.ok(result.steps.length >= 3);
      assert.ok(result.steps.some((step) => step.href.includes("/heat-design")));
      assert.ok(result.steps.some((step) => step.href.includes("projectId=")));
      assert.ok(result.steps.some((step) => step.href.includes("/takeoff")));
      const quoteStep = result.steps.find((step) => step.id === "quote");
      assert.ok(quoteStep);
      assert.match(quoteStep.href, /^\/(\?quote=|quotes)/);
      assert.equal(result.aiUsed, false);
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
      if (previousNexa !== undefined) process.env.NEXA_OPENAI_API_KEY = previousNexa;
    }
  });
});

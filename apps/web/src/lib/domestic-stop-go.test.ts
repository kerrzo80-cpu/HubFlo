import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOMESTIC_COST_CENTRE_CATALOGUE } from "@/lib/domestic-stop-go/cost-centres";
import { KEEP_DISTINCT, distinctStatusesRemainDistinct, evaluateRules } from "@/lib/domestic-stop-go/rules-engine";
import { getPublishedTemplate, PUBLISHED_WORKFLOW_TEMPLATES } from "@/lib/domestic-stop-go/templates";
import { seedDomesticCostCentresIdempotent } from "@/lib/domestic-stop-go/store";
import type { WorkflowAnswer } from "@/lib/domestic-stop-go/types";

function answer(fieldKey: string, value: unknown, extras: Partial<WorkflowAnswer> = {}): WorkflowAnswer {
  return {
    id: fieldKey,
    runId: "run-test",
    fieldKey,
    repeatGroupId: null,
    value,
    answerStatus: "answered",
    answeredBy: "eng-chris",
    answeredAt: new Date().toISOString(),
    source: "engineer",
    revision: 1,
    ...extras,
  };
}

describe("domestic stop/go seed and templates", () => {
  it("seeds seven cost centres idempotently with stable codes", () => {
    const first = seedDomesticCostCentresIdempotent();
    const second = seedDomesticCostCentresIdempotent();
    assert.equal(first.length, 7);
    assert.equal(second.length, first.length);
    assert.deepEqual(
      first.map((item) => item.stableCode).sort(),
      [
        "DOM_GAS_BOILER_INSTALL",
        "DOM_GAS_BOILER_SERVICE",
        "DOM_GAS_LANDLORD_SAFETY",
        "DOM_GAS_REPAIR",
        "DOM_GAS_UNSAFE",
        "DOM_OIL_BOILER_INSTALL",
        "DOM_OIL_SERVICE_TANK",
      ].sort(),
    );
    assert.equal(new Set(first.map((item) => item.stableCode)).size, 7);
    for (const centre of DOMESTIC_COST_CENTRE_CATALOGUE) {
      assert.ok(getPublishedTemplate(centre.stableCode), centre.stableCode);
    }
    assert.equal(PUBLISHED_WORKFLOW_TEMPLATES.length, 7);
  });
});

describe("domestic stop/go rules engine", () => {
  const template = getPublishedTemplate("DOM_GAS_BOILER_SERVICE")!;

  it("keeps blank, zero, false, not-tested and not-applicable distinct", () => {
    assert.equal(distinctStatusesRemainDistinct([...KEEP_DISTINCT]), true);
  });

  it("blocks continue when a required gate field is missing", () => {
    const errors = evaluateRules({
      template,
      answers: [],
      gateKey: "attendance",
      mode: "gate",
    });
    assert.ok(errors.some((item) => item.code === "REQUIRED_FOR_COMPLETION"));
  });

  it("shows CO alarm follow-up only when present is yes", () => {
    const hidden = evaluateRules({
      template,
      answers: [answer("safe_start.co_alarm_present", "no")],
      gateKey: "condition",
      mode: "gate",
    });
    assert.equal(hidden.some((item) => item.fieldKey === "safe_start.co_alarm_location"), false);
    const shown = evaluateRules({
      template,
      answers: [answer("safe_start.co_alarm_present", "yes")],
      gateKey: "condition",
      mode: "gate",
    });
    assert.ok(shown.some((item) => item.fieldKey === "safe_start.co_alarm_location"));
  });

  it("rejects tbc at completion", () => {
    const errors = evaluateRules({
      template,
      answers: [answer("findings.final_status", "safe_operational", { answerStatus: "tbc" })],
      mode: "completion",
    });
    assert.ok(errors.some((item) => item.code === "TBC_NOT_ALLOWED"));
  });

  it("hard-stops an unsafe final status", () => {
    const errors = evaluateRules({
      template,
      answers: [answer("findings.final_status", "unsafe")],
      mode: "completion",
    });
    assert.ok(errors.some((item) => item.code === "LAUNCH_LINKED_WORKFLOW" || item.code === "BLOCKS_GATE"));
  });

  it("hard-stops missing case seal confirmation", () => {
    const errors = evaluateRules({
      template,
      answers: [answer("reasm.case_seals", "no")],
      gateKey: "reassembly",
      mode: "gate",
    });
    assert.ok(errors.some((item) => item.fieldKey === "reasm.case_seals"));
  });
});

describe("landlord and oil hard stops", () => {
  it("requires at least one appliance row on landlord safety", () => {
    const template = getPublishedTemplate("DOM_GAS_LANDLORD_SAFETY")!;
    const errors = evaluateRules({ template, answers: [], mode: "completion" });
    assert.ok(errors.some((item) => item.code === "AT_LEAST_ONE_REPEAT_ITEM"));
  });

  it("does not use gas unsafe classifications for oil defects", () => {
    const template = getPublishedTemplate("DOM_OIL_SERVICE_TANK")!;
    assert.equal(template.fuel, "oil");
    assert.equal(template.linkedUnsafeCode, undefined);
    const errors = evaluateRules({
      template,
      answers: [answer("oilsvc.final_status", "unsafe_fire_pollution")],
      mode: "completion",
    });
    assert.ok(errors.some((item) => /oil/i.test(item.message) || item.code === "BLOCKS_GATE"));
  });
});

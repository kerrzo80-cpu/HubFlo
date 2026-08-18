import assert from "node:assert/strict";
import test from "node:test";

import { assessSoundDb, calculateRoomHeatLoss, calculateSystemDesign, suggestHeatPump } from "./calc.ts";
import { makeBlankRoom, makeDemoProject } from "./catalogue.ts";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

test("assessSoundDb applies inverse-square attenuation and clamps distance to 1m", () => {
  assert.equal(assessSoundDb(54, 8), 28);
  assert.equal(assessSoundDb(50, 0), 42); // distance clamped to 1m -> log10(1) = 0
});

test("calculateRoomHeatLoss returns finite, non-negative results for a blank room", () => {
  const result = calculateRoomHeatLoss(makeBlankRoom(1));
  assert.ok(isFiniteNumber(result.watts) && result.watts > 0);
  assert.ok(isFiniteNumber(result.floorArea) && result.floorArea > 0);
  assert.ok(isFiniteNumber(result.radiatorOutputAtDeltaT50) && result.radiatorOutputAtDeltaT50 > 0);
  for (const component of [
    result.wallLoss,
    result.glazingLoss,
    result.floorLoss,
    result.ceilingLoss,
    result.ventilationLoss,
  ]) {
    assert.ok(isFiniteNumber(component) && component >= 0);
  }
});

test("a colder design temperature increases heat loss", () => {
  const room = makeBlankRoom(1);
  assert.ok(calculateRoomHeatLoss(room, -10).watts > calculateRoomHeatLoss(room, 5).watts);
});

test("room ACH and targetTemp overrides change ventilation and totals", () => {
  const base = makeBlankRoom(2, { withDefaultWindow: false });
  const airtight = calculateRoomHeatLoss({ ...base, airChanges: 0.3 });
  const leaky = calculateRoomHeatLoss({ ...base, airChanges: 2 });
  assert.ok(leaky.ventilationLoss > airtight.ventilationLoss);
  assert.ok(leaky.watts > airtight.watts);
  const warmer = calculateRoomHeatLoss({ ...base, targetTemp: 24 });
  const cooler = calculateRoomHeatLoss({ ...base, targetTemp: 18 });
  assert.ok(warmer.watts > cooler.watts);
  assert.equal(warmer.targetTemp, 24);
});

test("suggestHeatPump returns a valid unit for normal and oversized loads", () => {
  const small = suggestHeatPump(3, 45);
  assert.ok(small && typeof small.id === "string");
  const huge = suggestHeatPump(9999, 45);
  assert.ok(huge && typeof huge.id === "string", "falls back to the largest pump");
});

test("calculateSystemDesign on the demo project yields sane, finite totals", () => {
  const result = calculateSystemDesign(makeDemoProject());
  assert.ok(isFiniteNumber(result.totalHeatLossKw) && result.totalHeatLossKw > 0);
  assert.ok(isFiniteNumber(result.designLoadKw) && result.designLoadKw >= result.totalHeatLossKw);
  assert.ok(result.selectedPump && typeof result.selectedPump.id === "string");
  assert.ok(isFiniteNumber(result.scop) && result.scop > 0);
  assert.ok(isFiniteNumber(result.coveragePercent) && result.coveragePercent > 0);
  assert.ok(isFiniteNumber(result.kitTotal) && result.kitTotal > 0);
});

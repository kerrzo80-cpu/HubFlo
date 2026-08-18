import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateHouseTypeTotal,
  calculateProjectTotals,
  calculateTakeoffLine,
  dedupeTakeoffLines,
  findDuplicateTakeoffLines,
  roundLabourHours,
  validatePlotRegister,
} from "./ai-takeoff-calc.ts";
import { DEFAULT_AI_TAKEOFF_PRICING_RULES, type AiTakeoffLine } from "./ai-takeoff-assistant-types.ts";
import { executeAiTakeoffTool } from "./ai-takeoff-tools.ts";

function line(partial: Partial<AiTakeoffLine> & { description: string }): AiTakeoffLine {
  return {
    id: partial.id || "line-1",
    revisionId: "rev-1",
    status: partial.status || "proposed",
    kind: partial.kind || "measured",
    description: partial.description,
    quantity: partial.quantity ?? 1,
    unit: partial.unit || "nr",
    unitCost: partial.unitCost ?? 0,
    markupPercent: partial.markupPercent ?? DEFAULT_AI_TAKEOFF_PRICING_RULES.materialsMarkupPercent,
    labourHours: partial.labourHours ?? 0,
    labourRate: partial.labourRate ?? DEFAULT_AI_TAKEOFF_PRICING_RULES.labourRatePerHour,
    houseType: partial.houseType,
    plotNumber: partial.plotNumber,
    costCentre: partial.costCentre,
    phase: partial.phase || "general",
    ref: partial.ref,
    updatedAt: new Date().toISOString(),
  };
}

test("rounds labour to nearest half hour", () => {
  assert.equal(roundLabourHours(1.2), 1);
  assert.equal(roundLabourHours(1.3), 1.5);
  assert.equal(roundLabourHours(1.75), 2);
});

test("NeXa calculates material sell with markup and labour", () => {
  const calc = calculateTakeoffLine(
    line({ description: "Radiator", quantity: 2, unitCost: 100, labourHours: 1.2 }),
  );
  assert.equal(calc.labourHours, 1);
  assert.equal(calc.materialSell, 260);
  assert.equal(calc.labourSell, 70);
  assert.equal(calc.lineTotalSell, 330);
});

test("project totals multiply house sell by plot count", () => {
  const lines = [
    line({ id: "a", description: "Boiler", houseType: "HT-A", quantity: 1, unitCost: 1000, labourHours: 0 }),
  ];
  const totals = calculateProjectTotals(
    lines,
    [
      { plot: "1", houseType: "HT-A" },
      { plot: "2", houseType: "HT-A" },
    ],
    DEFAULT_AI_TAKEOFF_PRICING_RULES,
  );
  assert.equal(totals.totalSell, 2600);
  assert.equal(totals.vat, 520);
  assert.equal(totals.grandTotal, 3120);
  assert.equal(calculateHouseTypeTotal(lines, "HT-A").totalSell, 1300);
});

test("detects duplicate lines and bad plot register", () => {
  const lines = [
    line({ id: "1", description: "Pipe", houseType: "HT-A", quantity: 10, unit: "m" }),
    line({ id: "2", description: "Pipe", houseType: "HT-A", quantity: 10, unit: "m" }),
  ];
  assert.equal(findDuplicateTakeoffLines(lines).length, 1);
  assert.ok(validatePlotRegister([{ plot: "1", houseType: "HT-B" }], ["HT-A"]).some((row) => /unknown house type/i.test(row)));
  assert.ok(validatePlotRegister([{ plot: "1", houseType: "HT-A" }], ["HT-A", "HT-B"]).some((row) => /no plots/i.test(row)));
});

test("tool handlers create house types and takeoff items", async () => {
  const tenderId = `test-ai-takeoff-${Date.now()}`;
  const houses = await executeAiTakeoffTool(tenderId, "create_house_type", { houseTypes: ["HT-A"] });
  assert.equal(houses.ok, true);
  const plots = await executeAiTakeoffTool(tenderId, "assign_plots", {
    plots: [{ plot: "1", houseType: "HT-A" }],
  });
  assert.equal(plots.ok, true);
  const item = await executeAiTakeoffTool(tenderId, "add_takeoff_item", {
    description: "Basin",
    quantity: 1,
    unit: "nr",
    houseType: "HT-A",
    unitCost: 50,
  });
  assert.equal(item.ok, true);
  assert.equal(item.state.lines.length, 1);
});

test("set_single_area_project skips housing plot nag for commercial jobs", async () => {
  const tenderId = `test-ai-takeoff-single-${Date.now()}`;
  const result = await executeAiTakeoffTool(tenderId, "set_single_area_project", { areaName: "Health Club" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.houseTypes, ["Health Club"]);
  assert.deepEqual(result.state.plots, [{ plot: "1", houseType: "Health Club" }]);
  assert.equal(validatePlotRegister(result.state.plots, result.state.houseTypes).length, 0);

  const priced = await executeAiTakeoffTool(tenderId, "update_pricing_rules", {
    labourRatePerHour: 70,
    materialsMarkupPercent: 30,
  });
  assert.equal(priced.ok, true);
  assert.equal(priced.state.pricingRules.labourRatePerHour, 70);
  assert.equal(priced.state.pricingRules.materialsMarkupPercent, 30);

  const item = await executeAiTakeoffTool(tenderId, "add_takeoff_item", {
    description: "22mm copper",
    quantity: 10,
    unit: "m",
    unitCost: 7.8,
  });
  assert.equal(item.ok, true);
  assert.equal(item.state.lines[0]?.houseType, "Health Club");
  assert.equal(item.state.lines[0]?.plotNumber, "1");
});

test("house types without a plot register do not fail validation", () => {
  assert.equal(validatePlotRegister([], ["Health Club"]).length, 0);
});

test("typed lines still total when plot register is empty", () => {
  const lines = [
    line({
      id: "a",
      description: "Pipe",
      houseType: "Health Club",
      quantity: 10,
      unitCost: 5,
      labourHours: 1,
    }),
  ];
  const totals = calculateProjectTotals(lines, [], DEFAULT_AI_TAKEOFF_PRICING_RULES);
  assert.equal(totals.totalSell, 135);
  assert.equal(totals.labourHours, 1);
});

test("all-in sell rate keeps rate × qty equal to line sell", () => {
  const calc = calculateTakeoffLine(
    line({ description: "Pipe", quantity: 10, unitCost: 5, labourHours: 1 }),
  );
  const allIn = Math.round((calc.lineTotalSell / calc.quantity) * 100) / 100;
  assert.equal(Math.round(allIn * calc.quantity * 100) / 100, calc.lineTotalSell);
  assert.notEqual(Math.round(calc.unitCost * 1.3 * calc.quantity * 100) / 100, calc.lineTotalSell);
});

test("dedupeTakeoffLines keeps one row per key", () => {
  const lines = [
    line({ id: "a", description: "Pipe", houseType: "HT-A", quantity: 10, unit: "m", status: "proposed" }),
    line({ id: "b", description: "Pipe", houseType: "HT-A", quantity: 10, unit: "m", status: "proposed" }),
    line({ id: "c", description: "Basin", houseType: "HT-A", quantity: 1, unit: "nr", status: "applied" }),
    line({ id: "d", description: "Basin", houseType: "HT-A", quantity: 1, unit: "nr", status: "proposed" }),
  ];
  const result = dedupeTakeoffLines(lines);
  assert.equal(result.removed, 2);
  assert.equal(result.lines.length, 2);
  assert.ok(result.lines.some((row) => row.id === "c" && row.status === "applied"));
});

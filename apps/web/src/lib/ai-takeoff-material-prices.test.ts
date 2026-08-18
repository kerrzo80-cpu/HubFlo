import assert from "node:assert/strict";
import test from "node:test";

import { softGuideUnitCost } from "./ai-soft-guide-prices.ts";
import {
  priceAiTakeoffLinesFromGuides,
  resolveTakeoffMaterialUnitCost,
  summariseMaterialPricing,
} from "./ai-takeoff-material-prices.ts";
import type { AiTakeoffLine } from "./ai-takeoff-assistant-types.ts";
import { calculateTakeoffLine } from "./ai-takeoff-calc.ts";
import { executeAiTakeoffTool } from "./ai-takeoff-tools.ts";

function line(partial: Partial<AiTakeoffLine> & Pick<AiTakeoffLine, "description">): AiTakeoffLine {
  return {
    id: partial.id || `line-${Math.random().toString(36).slice(2, 8)}`,
    revisionId: "rev",
    status: partial.status || "proposed",
    kind: partial.kind || "measured",
    description: partial.description,
    quantity: partial.quantity ?? 1,
    unit: partial.unit || "nr",
    houseType: partial.houseType,
    plotNumber: partial.plotNumber,
    costCentre: partial.costCentre,
    phase: partial.phase || "general",
    ref: partial.ref,
    unitCost: partial.unitCost ?? 0,
    markupPercent: partial.markupPercent ?? 30,
    labourHours: partial.labourHours ?? 0.5,
    labourRate: partial.labourRate ?? 70,
    sourceDocument: partial.sourceDocument,
    confidence: partial.confidence || "Medium",
    updatedAt: partial.updatedAt || new Date().toISOString(),
  };
}

test("soft guides price Health Club style sanitary / waste lines", () => {
  assert.ok(softGuideUnitCost("arezzo ss 90mm high flow shower tray waste", "nr") > 0);
  assert.ok(softGuideUnitCost("imperia 600mm linear grid; brushed brass", "No") > 0);
  assert.ok(
    softGuideUnitCost("fixing to backgrounds requiring plugging/screwin bedding and sealing all round in silicone", "item") >
      0,
  );
  assert.ok(softGuideUnitCost("wash hand basin", "nr") > 0);
});

test("resolveTakeoffMaterialUnitCost uses library/soft guides not blank", () => {
  const basin = resolveTakeoffMaterialUnitCost("Wash hand basin", "nr", 0);
  assert.ok(basin.unitCost > 0);
  assert.notEqual(basin.source, "none");

  const bill = resolveTakeoffMaterialUnitCost("Anything", "nr", 42.5);
  assert.equal(bill.unitCost, 42.5);
  assert.equal(bill.source, "bill");
});

test("priceAiTakeoffLinesFromGuides fills Cost so sell is not labour-only", () => {
  const lines = [
    line({
      description: "arezzo ss 90mm high flow shower tray waste",
      quantity: 1,
      unit: "nr",
      unitCost: 0,
      labourHours: 0.5,
    }),
    line({
      description: "imperia 600mm linear grid brushed brass",
      quantity: 6,
      unit: "nr",
      unitCost: 0,
      labourHours: 0.5,
    }),
  ];
  const priced = priceAiTakeoffLinesFromGuides(lines);
  assert.ok(priced.filled >= 1);
  for (const row of priced.lines) {
    assert.ok(row.unitCost > 0, row.description);
    const calc = calculateTakeoffLine(row);
    assert.ok(calc.lineTotalSell > calc.labourHours * 70, "sell should include materials");
  }
  const summary = summariseMaterialPricing(priced.lines);
  assert.equal(summary.zero, 0);
  assert.ok(summary.materialCost > 0);
});

test("clear_takeoff_lines empties applied rows", async () => {
  const tenderId = `test-clear-${Date.now()}`;
  await executeAiTakeoffTool(tenderId, "set_single_area_project", { areaName: "Health Club" });
  await executeAiTakeoffTool(tenderId, "add_takeoff_item", {
    description: "Basin",
    quantity: 1,
    unit: "nr",
    unitCost: 95,
  });
  const before = await executeAiTakeoffTool(tenderId, "add_takeoff_item", {
    description: "WC",
    quantity: 1,
    unit: "nr",
    unitCost: 185,
  });
  assert.equal(before.state.lines.length, 2);
  // mark one applied manually via update
  await executeAiTakeoffTool(tenderId, "update_takeoff_item", {
    id: before.state.lines[0]!.id,
    status: "applied",
  });
  const cleared = await executeAiTakeoffTool(tenderId, "clear_takeoff_lines", { includeApplied: true });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.state.lines.length, 0);
});

test("price_takeoff_materials library-only fills zero costs", async () => {
  const tenderId = `test-price-mats-${Date.now()}`;
  await executeAiTakeoffTool(tenderId, "set_single_area_project", { areaName: "Health Club" });
  await executeAiTakeoffTool(tenderId, "add_takeoff_item", {
    description: "TRV",
    quantity: 4,
    unit: "nr",
    unitCost: 0,
    labourHours: 0.5,
  });
  const priced = await executeAiTakeoffTool(tenderId, "price_takeoff_materials", { useBlakeBudget: false });
  assert.equal(priced.ok, true);
  assert.ok((priced.state.lines[0]?.unitCost || 0) > 0);
  assert.match(priced.message, /Materials|library|soft/i);
});

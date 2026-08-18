import assert from "node:assert/strict";
import test from "node:test";

import type { KitLine } from "./types.ts";
import {
  HEAT_DESIGN_BOQ_SHEET,
  kitLineCommercialDescription,
  kitLinesToTenderBoqLines,
  mergeHeatDesignBoqLines,
  previousHeatDesignBoqSell,
  previousJobMaterialsCost,
  previousQuoteLinesSell,
} from "./quote-export.ts";

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

test("kitLineCommercialDescription keeps PEX UFH distinct from copper plant", () => {
  assert.equal(
    kitLineCommercialDescription({
      id: "kit-ufh",
      category: "Emitters",
      description: "16mm PEX UFH pipe & staples (~120 m, heated ~40 m²)",
      qty: 120,
      unitCost: 2.4,
      unit: "m",
      required: true,
    }),
    "Emitters — 16mm PEX UFH pipe & staples (~120 m, heated ~40 m²)",
  );
  assert.equal(
    kitLineCommercialDescription({
      id: "kit-pipe",
      category: "Pipework",
      description: "Primary / plant copper pipework & insulation (~45 m) @ 45°C design",
      qty: 45,
      unitCost: 18,
      unit: "m",
      required: true,
    }),
    "Pipework — Primary / plant copper pipework & insulation (~45 m) @ 45°C design",
  );
});

test("kitLinesToTenderBoqLines maps measured PEX and copper lines under Heating design", () => {
  const kit: KitLine[] = [
    {
      id: "kit-pipe",
      category: "Pipework",
      description: "Primary / plant copper pipework & insulation (~45 m) @ 45°C design",
      qty: 45,
      unitCost: 10,
      unit: "m",
      required: true,
    },
    {
      id: "kit-ufh",
      category: "Emitters",
      description: "16mm PEX UFH pipe & staples (~120 m, heated ~40 m²)",
      qty: 120,
      unitCost: 2,
      unit: "m",
      required: true,
    },
  ];
  const lines = kitLinesToTenderBoqLines(kit, { markupPercent: 0, systemLabel: "ASHP" });
  assert.equal(lines[0]?.kind, "header");
  assert.equal(lines[0]?.sheet, HEAT_DESIGN_BOQ_SHEET);
  assert.equal(lines.length, 3);
  assert.match(lines[1]!.description, /copper/i);
  assert.match(lines[2]!.description, /PEX UFH/i);
  assert.equal(lines[1]!.quantity, 45);
  assert.equal(lines[1]!.unit, "m");
  assert.equal(lines[2]!.quantity, 120);
});

test("mergeHeatDesignBoqLines replaces prior Heat Design block only", () => {
  const existing = [
    { id: "other-1", kind: "measured" as const, description: "Existing electrical", quantity: 1, unit: "nr", rate: 50, value: 50 },
    { id: "heat-kit-old", kind: "measured" as const, description: "Old heat", quantity: 1, unit: "nr", rate: 10, value: 10, sheet: HEAT_DESIGN_BOQ_SHEET, section: HEAT_DESIGN_BOQ_SHEET },
  ];
  const next = kitLinesToTenderBoqLines(
    [
      {
        id: "kit-ashp",
        category: "Heat pump",
        description: "ASHP 8kW",
        qty: 1,
        unitCost: 4000,
        required: true,
      },
    ],
    { markupPercent: 0 },
  );
  const merged = mergeHeatDesignBoqLines(existing, next);
  assert.equal(merged.some((line) => line.id === "other-1"), true);
  assert.equal(merged.some((line) => line.id === "heat-kit-old"), false);
  assert.equal(merged.some((line) => line.id === "heat-kit-kit-ashp"), true);
  assert.equal(previousHeatDesignBoqSell(merged), 4000);
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-takeoff-rates-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

let applyTakeoffRatesToMaterials: typeof import("./takeoff-studio-rates").applyTakeoffRatesToMaterials;
let summarisePricedMaterials: typeof import("./takeoff-studio-rates").summarisePricedMaterials;

before(async () => {
  const mod = await import("./takeoff-studio-rates");
  applyTakeoffRatesToMaterials = mod.applyTakeoffRatesToMaterials;
  summarisePricedMaterials = mod.summarisePricedMaterials;
});

describe("takeoff studio rates", () => {
  it("prices copper pipe and fittings from defaults", () => {
    const priced = applyTakeoffRatesToMaterials([
      {
        id: "1",
        section: "Pipework",
        description: "22mm Copper · Cold pipe runs",
        quantity: 10,
        unit: "m",
        unitCost: 0,
        markupPercent: 0,
        supplierRequired: false,
      },
      {
        id: "2",
        section: "Fittings",
        description: "22mm Copper 90° elbow",
        quantity: 3,
        unit: "nr",
        unitCost: 0,
        markupPercent: 0,
        supplierRequired: false,
      },
    ]);
    assert.ok((priced[0]?.unitCost || 0) > 0);
    assert.ok((priced[1]?.unitCost || 0) > 0);
    const summary = summarisePricedMaterials(priced);
    assert.equal(summary.pricedLines, 2);
    assert.ok(summary.materialCost > 0);
  });

  it("keeps an existing unitCost", () => {
    const priced = applyTakeoffRatesToMaterials([
      {
        id: "1",
        section: "Pipework",
        description: "22mm Copper · Cold pipe runs",
        quantity: 10,
        unit: "m",
        unitCost: 99,
        markupPercent: 0,
        supplierRequired: false,
      },
    ]);
    assert.equal(priced[0]?.unitCost, 99);
  });
});

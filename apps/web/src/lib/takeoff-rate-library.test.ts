import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-takeoff-rate-lib-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";

let expandTakeoffAssemblies: typeof import("./takeoff-rate-library").expandTakeoffAssemblies;
let getTakeoffRateLibrary: typeof import("./takeoff-rate-library").getTakeoffRateLibrary;
let lookupLibraryRate: typeof import("./takeoff-rate-library").lookupLibraryRate;
let saveTakeoffRateLibrary: typeof import("./takeoff-rate-library").saveTakeoffRateLibrary;
let priceAndExpandTakeoffMaterials: typeof import("./takeoff-studio-rates").priceAndExpandTakeoffMaterials;

before(async () => {
  const lib = await import("./takeoff-rate-library");
  const rates = await import("./takeoff-studio-rates");
  expandTakeoffAssemblies = lib.expandTakeoffAssemblies;
  getTakeoffRateLibrary = lib.getTakeoffRateLibrary;
  lookupLibraryRate = lib.lookupLibraryRate;
  saveTakeoffRateLibrary = lib.saveTakeoffRateLibrary;
  priceAndExpandTakeoffMaterials = rates.priceAndExpandTakeoffMaterials;
});

describe("takeoff rate library", () => {
  it("loads defaults and accepts edited pipe rates", () => {
    const library = getTakeoffRateLibrary();
    assert.ok(library.rates.length >= 5);
    const cu22 = library.rates.find((row) => row.id === "rate-cu-22");
    assert.ok(cu22);
    saveTakeoffRateLibrary({
      rates: library.rates.map((row) => (row.id === "rate-cu-22" ? { ...row, unitCost: 9.5 } : row)),
    });
    assert.equal(lookupLibraryRate("22mm Copper · Cold pipe runs", "m"), 9.5);
  });

  it("expands WC assembly ancillaries on push materials", () => {
    const expanded = expandTakeoffAssemblies([
      {
        id: "wc",
        section: "Counts",
        description: "Takeoff · WC",
        quantity: 2,
        unit: "nr",
        unitCost: 185,
        markupPercent: 0,
        supplierRequired: false,
      },
    ]);
    assert.ok(expanded.some((row) => /cistern/i.test(row.description)));
    assert.ok(expanded.some((row) => row.quantity === 2 && /seat/i.test(row.description)));
  });

  it("prices and expands in one pass", () => {
    const priced = priceAndExpandTakeoffMaterials([
      {
        id: "1",
        section: "Pipework",
        description: "22mm Copper · Cold pipe runs",
        quantity: 5,
        unit: "m",
        unitCost: 0,
        markupPercent: 0,
        supplierRequired: false,
      },
      {
        id: "2",
        section: "Counts",
        description: "Takeoff · Radiator",
        quantity: 1,
        unit: "nr",
        unitCost: 0,
        markupPercent: 0,
        supplierRequired: false,
      },
    ]);
    assert.ok((priced.find((row) => /Copper/.test(row.description))?.unitCost || 0) > 0);
    assert.ok(priced.some((row) => /TRV/i.test(row.description)));
  });
});

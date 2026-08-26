import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layerSectionFromSheetName } from "@/lib/tender-boq-sections";

describe("BoQ layer section from sheet name", () => {
  it("maps legacy Takeoff layer tabs to section labels", () => {
    assert.equal(layerSectionFromSheetName("Takeoff · Hot & cold"), "Hot & cold");
    assert.equal(layerSectionFromSheetName("Takeoff · Heating"), "Heating");
    assert.equal(layerSectionFromSheetName("Heating"), "Heating");
  });

  it("returns null for house-type tabs", () => {
    assert.equal(layerSectionFromSheetName("Takeoff · House Type A"), null);
    assert.equal(layerSectionFromSheetName("House Type 1"), null);
  });
});

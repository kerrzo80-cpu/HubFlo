import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classificationLayer,
  createDefaultStudioState,
  ensureServiceClassifications,
  setClassificationColour,
  setStudioActiveLayer,
  SERVICE_CLASS_DEFS,
} from "./takeoff-studio";

describe("takeoff studio service colours and layers", () => {
  it("seeds hot/cold/heating/waste classes with distinct colours", () => {
    const studio = createDefaultStudioState();
    const cold = studio.classifications.find((cls) => cls.id === "cls-ai-P-PIPE-C");
    const hot = studio.classifications.find((cls) => cls.id === "cls-ai-P-PIPE-H");
    const flow = studio.classifications.find((cls) => cls.id === "cls-linear-heating-flow");
    assert.equal(cold?.colour, "#2878c8");
    assert.equal(hot?.colour, "#d64545");
    assert.equal(flow?.colour, "#f97316");
    assert.equal(studio.activeClassificationId, "cls-ai-P-PIPE-C");
    assert.equal(SERVICE_CLASS_DEFS.length >= 6, true);
  });

  it("ensureServiceClassifications adds missing presets without overwriting colours", () => {
    const base = createDefaultStudioState();
    const stripped = {
      ...base,
      classifications: base.classifications.filter((cls) => !cls.id.startsWith("cls-ai-") && !cls.id.startsWith("cls-linear-heating")),
    };
    const ensured = ensureServiceClassifications(stripped);
    assert.ok(ensured.classifications.some((cls) => cls.id === "cls-ai-P-PIPE-C"));

    const recoloured = setClassificationColour(ensured, "cls-ai-P-PIPE-C", "#00ff00");
    const again = ensureServiceClassifications(recoloured);
    const cold = again.classifications.find((cls) => cls.id === "cls-ai-P-PIPE-C");
    assert.equal(cold?.colour, "#00ff00");
  });

  it("setStudioActiveLayer filters to heating and selects a heating class", () => {
    const studio = createDefaultStudioState();
    const heating = setStudioActiveLayer(studio, "heating");
    assert.equal(heating.activeLayerId, "heating");
    const active = heating.classifications.find((cls) => cls.id === heating.activeClassificationId);
    assert.equal(classificationLayer(active!), "heating");
  });
});

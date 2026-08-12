import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classificationLayer,
  createDefaultStudioState,
  ensureServiceClassifications,
  importSkillCountsIntoStudio,
  setClassificationColour,
  setStudioActiveLayer,
  studioHasAiPipeRuns,
  studioNeedsAiReview,
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

  it("seeds countable valves and fittings on each major service layer", () => {
    const studio = createDefaultStudioState();
    const byLayer = (layer: string) =>
      studio.classifications.filter((cls) => classificationLayer(cls) === layer && cls.kind === "count");

    const hotCold = byLayer("hot-cold").map((cls) => cls.name);
    assert.ok(hotCold.includes("Isolation valve"));
    assert.ok(hotCold.includes("Check valve (NRV)"));
    assert.ok(hotCold.includes("TMV"));
    assert.ok(hotCold.includes("Stopcock"));

    const heating = byLayer("heating").map((cls) => cls.name);
    assert.ok(heating.includes("TRV"));
    assert.ok(heating.includes("Magnetic filter"));
    assert.ok(heating.includes("Zone / motorised valve"));

    const waste = byLayer("sanitary-waste").map((cls) => cls.name);
    assert.ok(waste.includes("Bottle trap"));
    assert.ok(waste.includes("Air admittance valve"));
    assert.ok(waste.includes("Rodding eye"));

    const gas = byLayer("gas").map((cls) => cls.name);
    assert.ok(gas.includes("Gas cock"));
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

  it("needs AI review only for fixture pins — pipe runs alone do not block", () => {
    const withPipesOnly = {
      ...createDefaultStudioState(),
      aiReviewStatus: "pending" as const,
      geometries: [
        {
          id: "ai-pipe-doc-1-1-0",
          classificationId: "cls-ai-P-PIPE-C",
          kind: "linear" as const,
          documentId: "doc-1",
          page: 1,
          points: [{ x: 0, y: 0 }, { x: 40, y: 0 }],
          source: "ai" as const,
        },
      ],
    };
    assert.equal(studioHasAiPipeRuns(withPipesOnly), true);
    assert.equal(studioNeedsAiReview(withPipesOnly), false);
  });

  it("confirming AI counts does not delete Blake pipe runs", () => {
    const studio = {
      ...createDefaultStudioState(),
      aiReviewStatus: "pending" as const,
      geometries: [
        {
          id: "ai-pipe-doc-1-1-0",
          classificationId: "cls-ai-P-PIPE-C",
          kind: "linear" as const,
          documentId: "doc-1",
          page: 1,
          points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
          source: "ai" as const,
          material: "Copper",
          diameter: "22mm",
        },
        {
          id: "ai-pin-1",
          classificationId: "cls-ai-WC",
          kind: "count" as const,
          documentId: "doc-1",
          page: 1,
          point: { x: 10, y: 10 },
          source: "ai" as const,
        },
      ],
    };
    const next = importSkillCountsIntoStudio(
      studio,
      [
        {
          id: "m-wc",
          kind: "primary",
          code: "WC",
          description: "WC",
          unit: "nr",
          quantity: 1,
          tagMatches: [
            {
              id: "pin-1",
              documentId: "doc-1",
              pageNumber: 1,
              x: 12,
              y: 12,
              pageHeight: 100,
              pageWidth: 100,
            },
          ],
        },
      ],
      { replaceExistingAi: true, aiReviewStatus: "confirmed" },
    );
    assert.ok(next.geometries.some((geo) => geo.id === "ai-pipe-doc-1-1-0"), "pipe run kept");
    const countPins = next.geometries.filter((geo) => geo.kind === "count" && !geo.autoGenerated);
    assert.equal(countPins.length, 1, "old pin replaced, one pin re-imported");
    assert.equal(countPins[0]?.id, "ai-pin-1");
  });
});

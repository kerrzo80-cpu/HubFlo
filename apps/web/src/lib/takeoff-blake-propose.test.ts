import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyBlakeProposal, ensurePlantClassifications } from "./takeoff-blake-propose";
import { createDefaultStudioState, importPipeRunsIntoStudio, isAiStudioGeometry } from "./takeoff-studio";

describe("blake route & equipment proposer", () => {
  it("seeds plant classifications", () => {
    const studio = ensurePlantClassifications(createDefaultStudioState());
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-ai-P-BOILER"));
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-ai-P-ASHP"));
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-ai-P-CYL"));
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-ai-P-MANIFOLD"));
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-count-flue-terminal"));
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-count-condensate-pump"));
    assert.ok(studio.classifications.some((cls) => cls.id === "cls-count-outdoor-sensor"));
    const boiler = studio.classifications.find((cls) => cls.id === "cls-ai-P-BOILER");
    assert.equal(boiler?.group, "boilers-plant");
    const rad = studio.classifications.find((cls) => cls.id === "cls-ai-P-RAD");
    assert.equal(rad?.group, "radiators-valves");
  });

  it("ensurePlantClassifications backfills Draw-as groups on older plant pins", () => {
    const base = ensurePlantClassifications(createDefaultStudioState());
    const flat = {
      ...base,
      classifications: base.classifications.map(({ group: _group, ...cls }) => cls),
    };
    const ensured = ensurePlantClassifications(flat);
    assert.equal(ensured.classifications.find((cls) => cls.id === "cls-count-flue-terminal")?.group, "boilers-plant");
    assert.equal(ensured.classifications.find((cls) => cls.id === "cls-ai-P-MANIFOLD")?.group, "ufh-manifolds");
  });

  it("proposes boiler + radiators plant, stubs, and follow-up questions", () => {
    const result = applyBlakeProposal(createDefaultStudioState(), {
      plantKind: "boiler",
      emitterMode: "radiators",
      includeCylinder: true,
      documentId: "doc-1",
      page: 1,
      pageWidth: 1000,
      pageHeight: 800,
      plantPoint: { x: 200, y: 600 },
      pipeSpecId: "cu-22",
    });
    assert.ok(result.routeCount >= 4);
    assert.ok(result.equipment.includes("Boiler"));
    assert.ok(result.equipment.includes("Cylinder"));
    const plants = result.studio.geometries.filter((geo) => geo.kind === "count" && geo.id.startsWith("ai-propose-plant-"));
    const pipes = result.studio.geometries.filter((geo) => geo.kind === "linear" && geo.id.startsWith("ai-propose-pipe-"));
    assert.ok(plants.length >= 3);
    assert.ok(pipes.length >= 4);
    assert.ok(plants.every((geo) => isAiStudioGeometry(geo)));
    assert.ok(result.questions.some((q) => /radiator/i.test(q)));
  });

  it("ASHP + UFH includes manifold and does not wipe on measured Blake pipe import", () => {
    const proposed = applyBlakeProposal(createDefaultStudioState(), {
      plantKind: "ashp",
      emitterMode: "ufh",
      includeCylinder: true,
      documentId: "doc-1",
      page: 1,
      pageWidth: 1000,
      pageHeight: 800,
      plantPoint: { x: 180, y: 620 },
    });
    assert.ok(proposed.equipment.includes("ASHP"));
    assert.ok(proposed.equipment.includes("UFH manifold"));

    const afterMeasure = importPipeRunsIntoStudio(
      proposed.studio,
      [
        {
          documentId: "doc-1",
          pageNumber: 1,
          role: "cold",
          pageHeight: 800,
          points: [
            { x: 10, y: 10 },
            { x: 80, y: 10 },
          ],
        },
      ],
      { replaceExistingAiPipes: true, renderScale: 1 },
    );
    assert.ok(afterMeasure.geometries.some((geo) => geo.id.startsWith("ai-propose-pipe-")));
    assert.ok(afterMeasure.geometries.some((geo) => geo.id.startsWith("ai-propose-plant-")));
    assert.ok(afterMeasure.geometries.some((geo) => geo.id.startsWith("ai-pipe-")));
  });
});

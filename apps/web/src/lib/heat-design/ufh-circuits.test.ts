import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeBlankProject, makeBlankRoom } from "./catalogue";
import { placePlantOnLayout, seedHeatingLayout } from "./layout";
import { polygonArea, rectPolygon, roomPolygon, syncRoomFromPolygon } from "./geometry";
import {
  applyPlanScaleCalibration,
  draftScaleLengthM,
  isPlanScaleCalibrated,
} from "./ufh-scale";
import {
  assignNearestManifold,
  buildUfhCircuitsOnLayout,
  generateSerpentineCircuit,
  polylineLengthM,
  spacingMmForWm2,
} from "./ufh-circuits";
import type { PlanUnderlay } from "./types";

function sampleUnderlay(): PlanUnderlay {
  return {
    dataUrl: "data:image/png;base64,xx",
    opacity: 0.4,
    widthM: 10,
    heightM: 8,
    originX: 0,
    originY: 0,
  };
}

describe("plan scale calibration", () => {
  it("converts a known plan segment into real metres", () => {
    const underlay = sampleUnderlay();
    const room = syncRoomFromPolygon(
      makeBlankRoom(0, { withDefaultWindow: false, planX: 0, planY: 0, length: 5, width: 4 }),
      rectPolygon(0, 0, 5, 4),
    );
    // Plan says the 5 m wall is only 2.5 units → scale ×2 → real 5 m wall becomes 10 units? 
    // Known: distance from (0,0)-(5,0) is 5 plan-units representing 10 real metres → factor 2.
    const result = applyPlanScaleCalibration(
      underlay,
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      10,
      [room],
      null,
    );
    assert.equal(result.scaleFactor, 2);
    assert.equal(result.measuredPlanM, 5);
    assert.ok(isPlanScaleCalibrated(result.underlay));
    assert.equal(result.underlay.widthM, 20);
    assert.equal(result.underlay.heightM, 16);
    const area = polygonArea(roomPolygon(result.rooms[0]!));
    assert.ok(Math.abs(area - 80) < 0.01); // 5×4 × 2² = 80
    assert.ok(draftScaleLengthM({ x: 0, y: 0 }, { x: 3, y: 4 }) > 4.9);
  });
});

describe("UFH serpentine + manifold assignment", () => {
  it("generates a serpentine polyline with length > 0 inside a room", () => {
    const polygon = rectPolygon(0, 0, 4, 3);
    const path = generateSerpentineCircuit(polygon, 0.2);
    assert.ok(path.length >= 4);
    const length = polylineLengthM(path);
    assert.ok(length > 5, `expected meaningful loop length, got ${length}`);
    // Rough: area/spacing ≈ 12/0.2 = 60, serpentine less due to clearance
    assert.ok(length > 20);
  });

  it("assigns each room to the nearest manifold", () => {
    const roomA = syncRoomFromPolygon(
      makeBlankRoom(0, { withDefaultWindow: false, planX: 0, planY: 0, length: 3, width: 3 }),
      rectPolygon(0, 0, 3, 3),
    );
    const roomB = syncRoomFromPolygon(
      makeBlankRoom(1, { withDefaultWindow: false, planX: 8, planY: 0, length: 3, width: 3 }),
      rectPolygon(8, 0, 3, 3),
    );
    let layout = placePlantOnLayout(null, "manifold", 1, 1.5, "ground", { label: "M1" });
    layout = placePlantOnLayout(layout, "manifold", 9, 1.5, "ground", { label: "M2" });
    const manifolds = layout.plants.filter((p) => p.kind === "manifold");
    assert.equal(assignNearestManifold(roomA, manifolds)?.label, "M1");
    assert.equal(assignNearestManifold(roomB, manifolds)?.label, "M2");
  });

  it("buildUfhCircuitsOnLayout produces room circuits and positive pipe metres", () => {
    const project = makeBlankProject();
    project.chosenSystemId = "opt-gas";
    project.emitterMode = "ufh";
    project.rooms = [
      syncRoomFromPolygon(
        makeBlankRoom(0, { withDefaultWindow: false, planX: 1, planY: 1, length: 4, width: 3.2, roomType: "Living Room" }),
        rectPolygon(1, 1, 4, 3.2),
      ),
      syncRoomFromPolygon(
        makeBlankRoom(1, { withDefaultWindow: false, planX: 5.2, planY: 1, length: 3, width: 2.8, roomType: "Kitchen" }),
        rectPolygon(5.2, 1, 3, 2.8),
      ),
    ];
    let layout = placePlantOnLayout(null, "boiler", 0.5, 0.5, "ground", { systemOptionId: "opt-gas" });
    layout = placePlantOnLayout(layout, "cylinder", 0.5, 1.2, "ground");
    layout = placePlantOnLayout(layout, "manifold", 2, 0.4, "ground");
    const seeded = seedHeatingLayout(
      { ...project, heatingLayout: layout },
      "opt-gas",
      "ufh",
      { preservePlants: layout.plants },
    );
    const { layout: ufhLayout, summary, circuits } = buildUfhCircuitsOnLayout(
      { ...project, heatingLayout: seeded },
      seeded,
      { pattern: "serpentine" },
    );
    assert.ok(circuits.length >= 2);
    assert.ok(summary.ufhPipeM > 0);
    assert.ok(summary.circuitCount >= 2);
    assert.ok(ufhLayout.pipes.some((pipe) => /ufh loop/i.test(pipe.label)));
    assert.ok(circuits.every((row) => row.loopLengthM > 0));
    assert.ok(circuits.every((row) => row.manifoldId));
    assert.equal(spacingMmForWm2(120), 100);
    assert.equal(spacingMmForWm2(50), 300);
  });
});

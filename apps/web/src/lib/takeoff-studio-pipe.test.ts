import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultStudioState } from "./takeoff-studio";
import {
  appendLinearWithAutoFittings,
  couplingPointsAlongRun,
  elbowPointsAlongRun,
  isRightAngleBend,
  previewFittingsForDraft,
  summariseStudioPipeBoq,
} from "./takeoff-studio-pipe";

describe("studio pipe auto fittings", () => {
  it("detects right-angle bends and ignores shallow turns", () => {
    assert.equal(
      isRightAngleBend({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }),
      true,
    );
    assert.equal(
      isRightAngleBend({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 5 }),
      false,
    );
    // Finger-tap corner that is a bit short / not perfectly square still counts
    assert.equal(
      isRightAngleBend({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 22, y: 18 }),
      true,
    );
  });

  it("previews elbows/couplings before Done run", () => {
    const preview = previewFittingsForDraft(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 160, y: 80 },
        { x: 160, y: 20 },
      ],
      { metresPerUnit: 0.1, stockLengthM: 3, autoElbows: true, autoCouplings: true },
    );
    assert.equal(preview.elbows, 3);
    assert.ok((preview.metres || 0) > 20);
    assert.ok(preview.couplings >= 6);
  });

  it("places elbows at direction changes", () => {
    const elbows = elbowPointsAlongRun([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 160, y: 80 },
    ]);
    assert.equal(elbows.length, 2);
    assert.equal(elbows[0]?.x, 100);
    assert.equal(elbows[1]?.y, 80);
  });

  it("places couplings every 3 m along the run", () => {
    // 10 m run at 10 units per metre
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const couplings = couplingPointsAlongRun(points, 0.1, 3);
    assert.equal(couplings.length, 3);
    assert.ok(Math.abs((couplings[0]?.x || 0) - 30) < 0.01);
    assert.ok(Math.abs((couplings[2]?.x || 0) - 90) < 0.01);
  });

  it("appends copper run with auto elbows and BOQ rows", () => {
    let studio = createDefaultStudioState();
    studio = {
      ...studio,
      scales: [{ documentId: "doc-1", page: 1, metresPerUnit: 0.1 }],
    };
    const next = appendLinearWithAutoFittings(studio, {
      id: "run-1",
      classificationId: "cls-ai-P-PIPE-C",
      kind: "linear",
      documentId: "doc-1",
      page: 1,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      material: "Copper",
      diameter: "22mm",
      stockLengthM: 3,
      pipeSpecId: "cu-22",
    });
    const elbows = next.geometries.filter((geo) => geo.kind === "count" && geo.fittingKind === "90-elbow");
    const couplings = next.geometries.filter((geo) => geo.kind === "count" && geo.fittingKind === "coupling");
    assert.equal(elbows.length, 1);
    assert.ok(couplings.length >= 4); // ~15 m run → 4 couplings at 3/6/9/12
    const boq = summariseStudioPipeBoq(next);
    assert.ok(boq.some((row) => row.unit === "m" && row.description.includes("22mm Copper")));
    assert.ok(boq.some((row) => row.description.includes("90° elbow")));
    assert.ok(boq.some((row) => row.description.includes("Coupling")));
  });
});

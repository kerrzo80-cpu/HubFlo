import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildIsoPreviewScene,
  projectIso,
} from "@/lib/takeoff-studio-isometric";
import { dropPlanPointsAlongRun, dropUnitOffsetsAlongRun } from "@/lib/takeoff-studio-pipe";
import type { StudioState } from "@/lib/takeoff-studio";

describe("takeoff-studio-isometric", () => {
  it("projects isometric with z raising points upward (lower screen y)", () => {
    const base = projectIso({ x: 10, y: 10, z: 0 });
    const up = projectIso({ x: 10, y: 10, z: 5 });
    assert.ok(up.y < base.y);
  });

  it("yaw orbit moves plan points in screen space", () => {
    const facing = projectIso({ x: 40, y: 0, z: 0 }, { yawDeg: 0, pitchDeg: 0 });
    const turned = projectIso({ x: 40, y: 0, z: 0 }, { yawDeg: 90, pitchDeg: 0 });
    assert.ok(Math.abs(facing.x - turned.x) > 1 || Math.abs(facing.y - turned.y) > 1);
  });

  it("spaces multiple drops along the run (not only at the end)", () => {
    assert.deepEqual(dropUnitOffsetsAlongRun(100, 1), [100]);
    assert.deepEqual(dropUnitOffsetsAlongRun(90, 3), [30, 60, 90]);
    const points = dropPlanPointsAlongRun(
      [
        { x: 0, y: 0 },
        { x: 90, y: 0 },
      ],
      3,
    );
    assert.equal(points.length, 3);
    assert.ok(Math.abs((points[0]?.x || 0) - 30) < 0.01);
    assert.ok(Math.abs((points[1]?.x || 0) - 60) < 0.01);
    assert.ok(Math.abs((points[2]?.x || 0) - 90) < 0.01);
  });

  it("builds a scene for completed length runs with drop stubs", () => {
    const studio: StudioState = {
      version: 1,
      activePage: 1,
      tool: "select",
      classifications: [{ id: "c1", kind: "linear", name: "Flow", colour: "#1998cf", unit: "m", layer: "hot-cold" }],
      geometries: [
        {
          id: "lin1",
          classificationId: "c1",
          kind: "linear",
          documentId: "doc1",
          page: 1,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 40 },
          ],
          material: "Copper",
          diameter: "22mm",
          dropCount: 2,
          dropHeightM: 2.4,
          riseDropM: 4.8,
        },
      ],
      scales: [{ documentId: "doc1", page: 1, metresPerUnit: 0.05 }],
      updatedAt: new Date().toISOString(),
    };

    const scene = buildIsoPreviewScene(studio, {
      documentId: "doc1",
      page: 1,
      metresPerUnit: 0.05,
    });
    assert.ok(scene);
    assert.equal(scene!.routes.length, 1);
    assert.ok(scene!.routes[0]!.planPath.startsWith("M"));
    assert.equal(scene!.routes[0]!.dropPaths.length, 2);
    assert.ok(scene!.routes[0]!.metres > 0);
  });
});

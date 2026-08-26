import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendManualPipeRun,
  mergeUserDrawnPipes,
  pipeLengthM,
} from "@/lib/heat-design/layout";
import type { HeatingSystemLayout } from "@/lib/heat-design/types";

function blankLayout(): HeatingSystemLayout {
  return {
    systemOptionId: "opt-ashp",
    plants: [],
    pipes: [],
    emitters: [],
    emitterMode: "radiators",
    updatedAt: new Date().toISOString(),
  };
}

describe("heat-design pipe draw", () => {
  it("measures polyline length", () => {
    assert.equal(pipeLengthM([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]), 7);
  });

  it("appends a placedByUser drawn pipe", () => {
    const next = appendManualPipeRun(blankLayout(), {
      kind: "flow",
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
      ],
      floorLevel: "ground",
      existing: true,
      diameterMm: 22,
      flowLpm: 14.5,
    });
    assert.equal(next.pipes.length, 1);
    const pipe = next.pipes[0]!;
    assert.equal(pipe.placedByUser, true);
    assert.equal(pipe.existing, true);
    assert.equal(pipe.diameterMm, 22);
    assert.equal(pipe.flowLpm, 14.5);
    assert.equal(pipe.kind, "flow");
    assert.match(pipe.label, /Existing|drawn/i);
  });

  it("keeps user-drawn pipes when merging after auto-route", () => {
    const withDrawn = appendManualPipeRun(blankLayout(), {
      kind: "return",
      points: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
      ],
      floorLevel: "ground",
      diameterMm: 15,
    });
    const auto: HeatingSystemLayout = {
      ...blankLayout(),
      pipes: [
        {
          id: "auto-1",
          kind: "flow",
          label: "Flow auto",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          floorLevel: "ground",
          diameterMm: 22,
        },
      ],
    };
    const merged = mergeUserDrawnPipes(auto, withDrawn.pipes);
    assert.equal(merged.pipes.length, 2);
    assert.ok(merged.pipes.some((pipe) => pipe.id === "auto-1"));
    assert.ok(merged.pipes.some((pipe) => pipe.placedByUser));
  });
});

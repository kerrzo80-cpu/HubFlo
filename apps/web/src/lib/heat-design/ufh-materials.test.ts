import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyBlakePipeSizing, summariseHeatingFittings } from "./blake-route";
import { isUfhCircuitPipe, sizeTierForPipe } from "./pipe-sizing";
import { heatingLayoutToStudio } from "./takeoff-export";
import type { HeatingSystemLayout } from "./types";

function sampleMixedLayout(): HeatingSystemLayout {
  return {
    systemOptionId: "opt-gas",
    emitterMode: "ufh",
    updatedAt: new Date().toISOString(),
    plants: [
      { id: "p1", kind: "boiler", label: "Gas boiler", x: 1, y: 1, floorLevel: "ground" },
      { id: "p2", kind: "manifold", label: "Manifold", x: 2.5, y: 1, floorLevel: "ground" },
    ],
    emitters: [],
    pipes: [
      {
        id: "pipe-primary",
        kind: "primary",
        label: "Boiler → manifold",
        floorLevel: "ground",
        points: [
          { x: 1, y: 1 },
          { x: 2.5, y: 1 },
        ],
      },
      {
        id: "pipe-ufh-loop",
        kind: "flow",
        label: "UFH loop · Living",
        floorLevel: "ground",
        points: [
          { x: 3, y: 1 },
          { x: 5, y: 1 },
          { x: 5, y: 3 },
          { x: 3, y: 3 },
          { x: 3, y: 1 },
        ],
      },
      {
        id: "pipe-ufh-tail",
        kind: "flow",
        label: "UFH tail flow · Living",
        floorLevel: "ground",
        points: [
          { x: 2.5, y: 1 },
          { x: 3, y: 1 },
        ],
      },
    ],
  };
}

describe("heat-design UFH pipe materials", () => {
  it("classifies UFH loops and tails as 16 mm PEX", () => {
    assert.equal(isUfhCircuitPipe({ label: "UFH loop · Kitchen" }), true);
    assert.equal(isUfhCircuitPipe({ label: "UFH tail return · Hall" }), true);
    assert.equal(isUfhCircuitPipe({ label: "Boiler → cylinder" }), false);

    const loop = sizeTierForPipe("flow", "UFH loop · Living");
    assert.equal(loop.diameterMm, 16);
    assert.equal(loop.pipeSpecId, "pex-16");
    assert.equal(loop.material, "PEX");

    const primary = sizeTierForPipe("primary", "Boiler → manifold");
    assert.equal(primary.diameterMm, 28);
    assert.equal(primary.material, "Copper");
  });

  it("keeps UFH PEX after Blake sizing (not copper overwrite)", () => {
    const sized = applyBlakePipeSizing(sampleMixedLayout());
    const loop = sized.pipes.find((pipe) => pipe.id === "pipe-ufh-loop");
    const tail = sized.pipes.find((pipe) => pipe.id === "pipe-ufh-tail");
    const primary = sized.pipes.find((pipe) => pipe.id === "pipe-primary");

    assert.equal(loop?.material, "PEX");
    assert.equal(loop?.diameterMm, 16);
    assert.equal(loop?.pipeSpecId, "pex-16");
    assert.equal(tail?.material, "PEX");
    assert.equal(tail?.diameterMm, 16);
    assert.equal(primary?.material, "Copper");
    assert.equal(primary?.diameterMm, 28);
  });

  it("counts UFH metres without copper elbows/couplings", () => {
    const summary = summariseHeatingFittings(sampleMixedLayout());
    const pex = summary.bySize.find((row) => row.diameterMm === 16);
    assert.ok(pex);
    assert.equal(pex!.material, "PEX");
    assert.ok(pex!.metres > 0);
    assert.equal(pex!.elbows, 0);
    assert.equal(pex!.couplings, 0);
    assert.ok(summary.bySize.some((row) => row.diameterMm === 28 && row.material === "Copper"));
  });

  it("exports UFH loops to takeoff as PEX / UFH class, not copper", () => {
    const { studio } = heatingLayoutToStudio(sampleMixedLayout());
    const ufhLinears = studio.geometries.filter(
      (geo) => geo.kind === "linear" && geo.classificationId === "cls-linear-ufh",
    );
    assert.ok(ufhLinears.length >= 2);
    for (const geo of ufhLinears) {
      if (geo.kind !== "linear") continue;
      assert.match(String(geo.material), /PEX|UFH/i);
      assert.equal(geo.pipeSpecId, "pex-16");
      assert.match(String(geo.diameter), /16/);
    }
    const copperLike = studio.geometries.filter(
      (geo) =>
        geo.kind === "linear"
        && /ufh/i.test(geo.notes || "")
        && /copper/i.test(String(geo.material || "")),
    );
    assert.equal(copperLike.length, 0);
  });
});

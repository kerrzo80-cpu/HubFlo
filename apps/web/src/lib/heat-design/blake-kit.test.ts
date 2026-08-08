import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildBlakeAncillariesKit, blakeKitMaterialAllowances, layoutCounts } from "./blake-kit";
import type { HeatingSystemLayout } from "./types";

const layout: HeatingSystemLayout = {
  systemOptionId: "opt-gas",
  emitterMode: "radiators",
  updatedAt: new Date().toISOString(),
  plants: [
    { id: "b", kind: "boiler", label: "Boiler", x: 1, y: 1, floorLevel: "ground" },
    { id: "c", kind: "cylinder", label: "Cylinder", x: 2, y: 1, floorLevel: "ground" },
    { id: "m", kind: "manifold", label: "Manifold", x: 3, y: 1, floorLevel: "ground" },
  ],
  emitters: [
    {
      id: "r1",
      kind: "radiator",
      label: "Rad 1",
      roomId: "a",
      x: 4,
      y: 2,
      widthM: 1,
      depthM: 0.1,
      rotationDeg: 0,
      floorLevel: "ground",
    },
    {
      id: "r2",
      kind: "radiator",
      label: "Rad 2",
      roomId: "b",
      x: 5,
      y: 2,
      widthM: 1,
      depthM: 0.1,
      rotationDeg: 0,
      floorLevel: "ground",
    },
  ],
  pipes: [
    {
      id: "p1",
      kind: "primary",
      label: "main",
      floorLevel: "ground",
      diameterMm: 28,
      points: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
      ],
    },
    {
      id: "p2",
      kind: "flow",
      label: "Flow → Rad 1",
      floorLevel: "ground",
      diameterMm: 15,
      points: [
        { x: 3, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 2 },
      ],
    },
  ],
};

describe("blake ancillaries kit", () => {
  it("counts plant and emitters from layout", () => {
    const counts = layoutCounts(layout);
    assert.equal(counts.rads, 2);
    assert.equal(counts.hasBoiler, true);
    assert.equal(counts.hasCylinder, true);
    assert.equal(counts.hasManifold, true);
  });

  it("includes valves, TRVs and gas condensate for a gas rad design", () => {
    const kit = buildBlakeAncillariesKit({
      systemKind: "gas",
      emitterMode: "radiators",
      layout,
      roomCount: 2,
    });
    const ids = kit.map((row) => row.id);
    assert.ok(ids.some((id) => id.includes("filling-loop")));
    assert.ok(ids.some((id) => id.includes("zone-ch")));
    assert.ok(ids.some((id) => id.includes("trv")));
    assert.ok(ids.some((id) => id.includes("condensate")));
    const trv = kit.find((row) => row.id.includes("trv"));
    assert.equal(trv?.qty, 2);
  });

  it("includes ASHP and UFH bits for heat-pump UFH", () => {
    const ufhLayout: HeatingSystemLayout = {
      ...layout,
      emitterMode: "ufh",
      emitters: [
        {
          id: "u1",
          kind: "ufh",
          label: "Kitchen UFH",
          roomId: "k",
          x: 2,
          y: 2,
          widthM: 2,
          depthM: 2,
          rotationDeg: 0,
          floorLevel: "ground",
        },
      ],
      plants: [
        { id: "ou", kind: "outdoor_unit", label: "OU", x: 0, y: 0, floorLevel: "ground" },
        { id: "c", kind: "cylinder", label: "Cylinder", x: 1, y: 1, floorLevel: "ground" },
        { id: "m", kind: "manifold", label: "Manifold", x: 2, y: 1, floorLevel: "ground" },
      ],
    };
    const kit = buildBlakeAncillariesKit({
      systemKind: "ashp",
      emitterMode: "ufh",
      layout: ufhLayout,
      roomCount: 3,
    });
    assert.ok(kit.some((row) => row.id.includes("ashp-flex")));
    assert.ok(kit.some((row) => row.id.includes("ufh-actuator")));
    assert.ok(kit.some((row) => row.id.includes("g3-tundish")));
  });

  it("maps kit lines to takeoff material allowances", () => {
    const kit = buildBlakeAncillariesKit({
      systemKind: "gas",
      emitterMode: "radiators",
      layout,
    });
    const materials = blakeKitMaterialAllowances(kit, "takeoff-1");
    assert.ok(materials.length >= 10);
    assert.ok(materials.every((row) => row.id.startsWith("studio-mat-takeoff-1-blake-")));
    assert.ok(materials.every((row) => row.blakeNote));
  });
});

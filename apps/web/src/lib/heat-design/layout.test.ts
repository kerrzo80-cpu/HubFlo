import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeBlankProject } from "./catalogue";
import {
  placePlantOnLayout,
  plantRole,
  seedHeatingLayout,
} from "./layout";

describe("placePlantOnLayout", () => {
  it("places engineer plant and replaces same role", () => {
    let layout = placePlantOnLayout(null, "boiler", 2, 3, "ground", {
      systemOptionId: "opt-gas",
    });
    assert.equal(layout.plants.length, 1);
    assert.equal(layout.plants[0]?.kind, "boiler");
    assert.equal(layout.plants[0]?.placedByUser, true);
    assert.equal(layout.plants[0]?.x, 2);
    assert.equal(layout.pipes.length, 0);

    layout = placePlantOnLayout(layout, "boiler", 4, 5, "ground");
    assert.equal(layout.plants.length, 1);
    assert.equal(layout.plants[0]?.x, 4);
    assert.equal(layout.plants[0]?.y, 5);

    layout = placePlantOnLayout(layout, "cylinder", 1, 1, "ground");
    assert.equal(layout.plants.length, 2);
    assert.ok(layout.plants.some((p) => plantRole(p.kind) === "boiler"));
    assert.ok(layout.plants.some((p) => plantRole(p.kind) === "cylinder"));
  });
});

describe("seedHeatingLayout preservePlants", () => {
  it("keeps engineer plant positions when routing pipes", () => {
    const project = makeBlankProject();
    project.rooms = [
      {
        id: "room-1",
        name: "Utility",
        roomType: "Utility",
        length: "3.2",
        width: "2.4",
        height: "2.4",
        exteriorWalls: 2,
        exteriorFlags: [true, true, false, false],
        wallType: "cavity",
        glazingType: "dg",
        windowArea: "1.2",
        floorType: "solid",
        ceilingType: "joist",
        meanWaterTemperature: "45",
        preferredRange: "k2",
        planX: 0,
        planY: 0,
        floorLevel: "ground",
        openings: [],
      },
      {
        id: "room-2",
        name: "Lounge",
        roomType: "Living room",
        length: "4.5",
        width: "3.8",
        height: "2.4",
        exteriorWalls: 2,
        exteriorFlags: [true, false, true, false],
        wallType: "cavity",
        glazingType: "dg",
        windowArea: "2.4",
        floorType: "solid",
        ceilingType: "joist",
        meanWaterTemperature: "45",
        preferredRange: "k2",
        planX: 3.5,
        planY: 0,
        floorLevel: "ground",
        openings: [],
      },
    ];
    project.chosenSystemId = "opt-gas";
    project.emitterMode = "radiators";

    const placed = placePlantOnLayout(null, "boiler", 1.1, 1.2, "ground", {
      systemOptionId: "opt-gas",
    });
    const withCylinder = placePlantOnLayout(placed, "cylinder", 1.8, 1.2, "ground");
    const withManifold = placePlantOnLayout(withCylinder, "manifold", 2.4, 1.25, "ground");

    const routed = seedHeatingLayout(project, "opt-gas", "radiators", {
      preservePlants: withManifold.plants,
    });

    const boiler = routed.plants.find((p) => plantRole(p.kind) === "boiler");
    const cylinder = routed.plants.find((p) => plantRole(p.kind) === "cylinder");
    const manifold = routed.plants.find((p) => plantRole(p.kind) === "manifold");
    assert.ok(boiler);
    assert.ok(cylinder);
    assert.ok(manifold);
    assert.equal(boiler!.x, 1.1);
    assert.equal(boiler!.y, 1.2);
    assert.equal(cylinder!.x, 1.8);
    assert.equal(manifold!.x, 2.4);
    assert.ok(routed.pipes.length > 0);
    assert.ok(routed.emitters.length > 0);
  });
});

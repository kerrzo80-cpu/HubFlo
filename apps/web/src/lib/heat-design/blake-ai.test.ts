import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyBlakePipeSizeHints,
  proposeHeatDesignWithBlake,
} from "./blake-ai";
import { placePlantOnLayout } from "./layout";
import { makeBlankProject } from "./catalogue";
import type { HeatDesignProject, HeatingSystemLayout } from "./types";

const layout: HeatingSystemLayout = {
  systemOptionId: "opt-gas",
  emitterMode: "radiators",
  updatedAt: new Date().toISOString(),
  plants: [{ id: "b", kind: "boiler", label: "Boiler", x: 1, y: 1, floorLevel: "ground" }],
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
  ],
  pipes: [
    {
      id: "p-main",
      kind: "flow",
      label: "Flow main",
      floorLevel: "ground",
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
      ],
    },
    {
      id: "p-tail",
      kind: "flow",
      label: "Rad tail",
      floorLevel: "ground",
      points: [
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
    },
  ],
};

function sampleProject(): HeatDesignProject {
  return {
    id: "hd-blake-ai-test",
    name: "Blake AI test",
    customerName: "Test",
    address: "1 Test Street",
    postcode: "AB12 3CD",
    propertyType: "Semi-detached",
    buildEra: "1990s",
    occupants: 3,
    currentFuel: "Gas",
    currentAnnualKwh: 12000,
    electricityUnitRate: 0.28,
    gasUnitRate: 0.07,
    designExternalTemp: -3,
    flowTemperature: 55,
    selectedHeatPumpId: "",
    rooms: [],
    activeFloor: "ground",
    selectedWallConstructionIds: [],
    primaryWallConstructionId: "",
    selectedRadiatorTypeIds: ["rad-k2"],
    reportOptionIds: ["opt-gas"],
    chosenSystemId: "opt-gas",
    heatingLayout: layout,
    emitterMode: "radiators",
    cylinderLitres: 210,
    dailyHotWaterLitres: 150,
    outdoorUnitDistanceM: 3,
    nearestNeighbourDistanceM: 8,
    kitExtras: [],
    updatedAt: new Date().toISOString(),
  };
}

function withoutOpenAi<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENAI_API_KEY;
  const previousNexa = process.env.NEXA_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.NEXA_OPENAI_API_KEY;
  return fn().finally(() => {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    else delete process.env.OPENAI_API_KEY;
    if (previousNexa !== undefined) process.env.NEXA_OPENAI_API_KEY = previousNexa;
    else delete process.env.NEXA_OPENAI_API_KEY;
  });
}

describe("blake-ai", () => {
  it("falls back to a rule kit when OpenAI is not connected", async () => {
    await withoutOpenAi(async () => {
      const proposal = await proposeHeatDesignWithBlake(sampleProject());
      assert.equal(proposal.aiUsed, false);
      assert.equal(proposal.connected, false);
      assert.ok(proposal.kitLines.length > 0);
      assert.ok(proposal.applySizing || proposal.regenerateLayout || proposal.kitLines.length);
      assert.match(proposal.summary, /not connected|rule/i);
    });
  });

  it("plant-only Ask Blake (no OpenAI) draws non-empty pipes linking plant", async () => {
    await withoutOpenAi(async () => {
      const project = makeBlankProject();
      project.chosenSystemId = "opt-gas";
      project.rooms = [];
      let plants = placePlantOnLayout(null, "boiler", 1, 1, "ground", { systemOptionId: "opt-gas" });
      plants = placePlantOnLayout(plants, "cylinder", 2, 1, "ground");
      plants = placePlantOnLayout(plants, "manifold", 3, 1, "ground");
      plants = placePlantOnLayout(plants, "manifold", 4, 2, "ground");
      project.heatingLayout = plants;

      const proposal = await proposeHeatDesignWithBlake(project, { regenerateLayout: true });
      assert.equal(proposal.aiUsed, false);
      assert.ok(proposal.layout?.pipes?.length, "rule fallback must draw pipes");
      assert.ok(
        proposal.layout!.pipes.some((p) => /boiler → cylinder/i.test(p.label)),
        "links boiler to cylinder",
      );
      assert.ok(
        proposal.layout!.pipes.filter((p) => /manifold/i.test(p.label)).length >= 2,
        "reaches both manifolds",
      );
      assert.ok(proposal.kitLines.length > 0);
      assert.ok(proposal.routeNotes.some((n) => /plant on plan|routes:/i.test(n)));
    });
  });

  it("rooms + plant Ask Blake draws emitter branches", async () => {
    await withoutOpenAi(async () => {
      const project = makeBlankProject();
      project.chosenSystemId = "opt-gas";
      project.emitterMode = "radiators";
      project.rooms = [
        {
          id: "room-1",
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
          planX: 0,
          planY: 0,
          floorLevel: "ground",
          openings: [],
        },
      ];
      let plants = placePlantOnLayout(null, "boiler", 1, 1, "ground", { systemOptionId: "opt-gas" });
      plants = placePlantOnLayout(plants, "manifold", 2, 1, "ground");
      project.heatingLayout = plants;

      const proposal = await proposeHeatDesignWithBlake(project, { regenerateLayout: true });
      assert.ok(proposal.layout?.emitters?.length, "places emitters in rooms");
      assert.ok(
        proposal.layout!.pipes.some((p) => /flow →|return ←|ufh flow/i.test(p.label)),
        "emitter branch runs present",
      );
    });
  });

  it("AI fail path still returns rule geometry (fetch throws)", async () => {
    const previous = process.env.OPENAI_API_KEY;
    const previousNexa = process.env.NEXA_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-blake-fail";
    delete process.env.NEXA_OPENAI_API_KEY;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("simulated OpenAI outage");
    }) as typeof fetch;

    try {
      const project = makeBlankProject();
      project.chosenSystemId = "opt-gas";
      project.rooms = [];
      let plants = placePlantOnLayout(null, "boiler", 1, 1, "ground", { systemOptionId: "opt-gas" });
      plants = placePlantOnLayout(plants, "cylinder", 2.2, 1, "ground");
      plants = placePlantOnLayout(plants, "manifold", 3.2, 1.1, "ground");
      project.heatingLayout = plants;

      const proposal = await proposeHeatDesignWithBlake(project, { regenerateLayout: true });
      assert.equal(proposal.aiUsed, false);
      assert.ok(proposal.layout?.pipes?.length, "rule fallback still draws after AI fail");
      assert.ok(proposal.kitLines.length > 0);
      assert.match(proposal.summary, /rule|network error|could not/i);
    } finally {
      globalThis.fetch = originalFetch;
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
      else delete process.env.OPENAI_API_KEY;
      if (previousNexa !== undefined) process.env.NEXA_OPENAI_API_KEY = previousNexa;
      else delete process.env.NEXA_OPENAI_API_KEY;
    }
  });

  it("applies AI pipe size hints over default tiers", () => {
    const next = applyBlakePipeSizeHints(layout, [
      { pipeId: "p-main", diameterMm: 28, reason: "main" },
      { pipeId: "p-tail", diameterMm: 15, reason: "tail" },
    ]);
    assert.equal(next.pipes.find((p) => p.id === "p-main")?.diameterMm, 28);
    assert.equal(next.pipes.find((p) => p.id === "p-tail")?.diameterMm, 15);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyBlakePipeSizeHints,
  proposeHeatDesignWithBlake,
} from "./blake-ai";
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

describe("blake-ai", () => {
  it("falls back to a rule kit when OpenAI is not connected", async () => {
    const previous = process.env.OPENAI_API_KEY;
    const previousNexa = process.env.NEXA_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NEXA_OPENAI_API_KEY;
    try {
      const proposal = await proposeHeatDesignWithBlake(sampleProject());
      assert.equal(proposal.aiUsed, false);
      assert.equal(proposal.connected, false);
      assert.ok(proposal.kitLines.length > 0);
      assert.ok(proposal.applySizing || proposal.regenerateLayout || proposal.kitLines.length);
      assert.match(proposal.summary, /not connected|rule/i);
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
      if (previousNexa !== undefined) process.env.NEXA_OPENAI_API_KEY = previousNexa;
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

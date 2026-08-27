import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  prefersExteriorRooms,
  roomAreaSelectValue,
  worksAreaSelectValue,
  WORKS_AREA_CUSTOM,
  ROOM_AREA_CUSTOM,
} from "./works-area-presets.ts";

describe("works-area-presets", () => {
  it("maps Interior Works / Exterior Work to themselves", () => {
    assert.equal(worksAreaSelectValue("Interior Works"), "Interior Works");
    assert.equal(worksAreaSelectValue("Exterior Work"), "Exterior Work");
  });

  it("treats blank works area as Interior Works default", () => {
    assert.equal(worksAreaSelectValue(""), "Interior Works");
    assert.equal(worksAreaSelectValue("  "), "Interior Works");
  });

  it("marks edited works area names as custom", () => {
    assert.equal(worksAreaSelectValue("Front elevation"), WORKS_AREA_CUSTOM);
  });

  it("maps known rooms and marks free text as custom", () => {
    assert.equal(roomAreaSelectValue("Kitchen"), "Kitchen");
    assert.equal(roomAreaSelectValue("Rainwater goods"), "Rainwater goods");
    assert.equal(roomAreaSelectValue("Plant loft"), ROOM_AREA_CUSTOM);
    assert.equal(roomAreaSelectValue(""), ROOM_AREA_CUSTOM);
  });

  it("detects exterior-leaning works area names", () => {
    assert.equal(prefersExteriorRooms("Exterior Work"), true);
    assert.equal(prefersExteriorRooms("External walls phase"), true);
    assert.equal(prefersExteriorRooms("Interior Works"), false);
    assert.equal(prefersExteriorRooms("Kitchen refurb"), false);
  });
});

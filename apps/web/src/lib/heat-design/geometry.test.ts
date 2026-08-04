import assert from "node:assert/strict";
import test from "node:test";

import { makeBlankRoom } from "./catalogue.ts";
import { autoMarkExteriorWalls, edgesShareWall, rectPolygon, syncRoomFromPolygon } from "./geometry.ts";

test("edgesShareWall detects colinear overlapping walls", () => {
  assert.equal(
    edgesShareWall({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }),
    true,
  );
  assert.equal(
    edgesShareWall({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 0.5 }, { x: 3, y: 0.5 }),
    false,
  );
});

test("autoMarkExteriorWalls marks shared walls as internal", () => {
  const left = syncRoomFromPolygon(makeBlankRoom(0, { withDefaultWindow: false }), rectPolygon(0, 0, 4, 3));
  const right = syncRoomFromPolygon(makeBlankRoom(1, { withDefaultWindow: false }), rectPolygon(4, 0, 3, 3));
  const marked = autoMarkExteriorWalls([left, right]);
  const leftWalls = marked[0]!.wallExterior!;
  const rightWalls = marked[1]!.wallExterior!;
  // left room right edge (index 1) shares with right room left edge (index 3)
  assert.equal(leftWalls[1], false);
  assert.equal(rightWalls[3], false);
  assert.equal(leftWalls[0], true);
  assert.equal(rightWalls[1], true);
});

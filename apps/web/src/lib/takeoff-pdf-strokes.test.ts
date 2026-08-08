import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStrokeRole,
  looksLikePipeRun,
  pointsFromConstructPathArgs,
  summariseStrokeRunsByRole,
} from "./takeoff-pdf-strokes";

test("classifyStrokeRole maps red/green/brown", () => {
  assert.equal(classifyStrokeRole({ r: 0.9, g: 0.1, b: 0.1 }), "hot");
  assert.equal(classifyStrokeRole({ r: 0.1, g: 0.85, b: 0.2 }), "cold");
  assert.equal(classifyStrokeRole({ r: 0.1, g: 0.35, b: 0.9 }), "cold");
  assert.equal(classifyStrokeRole({ r: 0.7, g: 0.4, b: 0.1 }), "waste");
  assert.equal(classifyStrokeRole({ r: 0.2, g: 0.2, b: 0.2 }), "other");
});

test("pointsFromConstructPathArgs reads move/line pairs", () => {
  const points = pointsFromConstructPathArgs({
    0: 0,
    1: 10,
    2: 20,
    3: 1,
    4: 110,
    5: 20,
    6: 1,
    7: 110,
    8: 80,
  });
  assert.equal(points.length, 3);
  assert.equal(points[0]?.x, 10);
  assert.equal(points[2]?.y, 80);
});

test("looksLikePipeRun rejects fat closed boxes", () => {
  const box = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 },
    { x: 0, y: 0 },
  ];
  assert.equal(looksLikePipeRun(box, 360, 800, 600), false);
  const run = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 40 },
    { x: 240, y: 40 },
  ];
  assert.equal(looksLikePipeRun(run, 280, 800, 600), true);
});

test("summariseStrokeRunsByRole totals lengths", () => {
  const summary = summariseStrokeRunsByRole([
    {
      pageNumber: 1,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      lengthPdfUnits: 100,
      colourHex: "#ff0000",
      role: "hot",
      pageWidth: 800,
      pageHeight: 600,
    },
    {
      pageNumber: 1,
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      lengthPdfUnits: 50,
      colourHex: "#00aa00",
      role: "cold",
      pageWidth: 800,
      pageHeight: 600,
    },
  ]);
  assert.equal(summary.hotPdfUnits, 100);
  assert.equal(summary.coldPdfUnits, 50);
  assert.equal(summary.hotRuns, 1);
});

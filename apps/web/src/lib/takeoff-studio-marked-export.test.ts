import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultStudioState } from "./takeoff-studio";
import {
  buildStudioMarkedDrawingSvg,
  buildStudioMarkedSnapshot,
  geometriesForStudioLayer,
  layersWithStudioMarks,
  markedDrawingFileName,
  studioLayerLabel,
} from "./takeoff-studio-marked-export";

describe("studio marked layer export", () => {
  it("labels master distinctly from service layers", () => {
    assert.equal(studioLayerLabel("all"), "Master all layers");
    assert.equal(studioLayerLabel("heating"), "Heating");
  });

  it("filters geometries by layer and builds svg with key", () => {
    const studio = createDefaultStudioState();
    const coldId = "cls-ai-P-PIPE-C";
    const flowId = "cls-linear-heating-flow";
    studio.geometries = [
      {
        id: "g1",
        classificationId: coldId,
        kind: "linear",
        documentId: "doc-1",
        page: 1,
        points: [{ x: 10, y: 10 }, { x: 80, y: 40 }],
      },
      {
        id: "g2",
        classificationId: flowId,
        kind: "linear",
        documentId: "doc-1",
        page: 1,
        points: [{ x: 20, y: 20 }, { x: 90, y: 90 }],
      },
    ];

    assert.equal(geometriesForStudioLayer(studio, "hot-cold", { documentId: "doc-1", page: 1 }).length, 1);
    assert.equal(geometriesForStudioLayer(studio, "heating", { documentId: "doc-1", page: 1 }).length, 1);
    assert.equal(geometriesForStudioLayer(studio, "all", { documentId: "doc-1", page: 1 }).length, 2);

    const layers = layersWithStudioMarks(studio, { documentId: "doc-1", page: 1 });
    assert.ok(layers.includes("all"));
    assert.ok(layers.includes("hot-cold"));
    assert.ok(layers.includes("heating"));

    const snapshot = buildStudioMarkedSnapshot(studio, "hot-cold", {
      documentId: "doc-1",
      page: 1,
      width: 800,
      height: 600,
    });
    const svg = buildStudioMarkedDrawingSvg(studio, snapshot, {
      projectReference: "TK-3007",
      drawingFileName: "plan.pdf",
    });
    assert.match(svg, /Hot & cold|Cold pipe/);
    assert.match(svg, /polyline/);
    assert.match(markedDrawingFileName("TK-3007", "plan.pdf", "Hot & cold", 1), /tk-3007-plan-p1-hot-cold\.svg/);
  });
});

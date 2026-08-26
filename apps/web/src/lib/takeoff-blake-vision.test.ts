import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visionPipesToImportRuns } from "./takeoff-blake-vision";

describe("blake vision pipe polylines", () => {
  it("converts top-left % points to bottom-left import runs", () => {
    const runs = visionPipesToImportRuns(
      [
        {
          documentId: "doc-1",
          pageNumber: 1,
          dataUrl: "data:image/jpeg;base64,xx",
          width: 1000,
          height: 800,
        },
      ],
      [
        {
          role: "cold",
          pageNumber: 1,
          pointsPct: [
            { xPct: 0.1, yPct: 0.25 },
            { xPct: 0.4, yPct: 0.25 },
            { xPct: 0.4, yPct: 0.5 },
          ],
        },
        {
          role: "hot",
          pageNumber: 1,
          pointsPct: [{ xPct: 0.2, yPct: 0.2 }],
        },
      ],
    );

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.role, "cold");
    assert.equal(runs[0]?.points.length, 3);
    assert.ok(Math.abs((runs[0]?.points[0]?.x || 0) - 100) < 0.01);
    // yPct 0.25 top-left → bottom-left y = 0.75 * 800 = 600
    assert.ok(Math.abs((runs[0]?.points[0]?.y || 0) - 600) < 0.01);
    assert.equal(runs[0]?.colourHex, "#2878c8");
  });

  it("maps heating role to hot colouring", () => {
    const runs = visionPipesToImportRuns(
      [{ documentId: "doc-1", pageNumber: 1, dataUrl: "data:image/jpeg;base64,xx", width: 100, height: 100 }],
      [
        {
          role: "heating",
          pointsPct: [
            { xPct: 0.1, yPct: 0.1 },
            { xPct: 0.2, yPct: 0.2 },
          ],
        },
      ],
    );
    assert.equal(runs[0]?.role, "hot");
    assert.equal(runs[0]?.colourHex, "#d64545");
  });
});

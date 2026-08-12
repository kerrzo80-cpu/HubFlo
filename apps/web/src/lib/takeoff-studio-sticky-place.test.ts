import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

/**
 * Regression: after Done run / finishLinear, Length must stay sticky
 * (class + pipe size selected) like Heat Design sticky place — not reset to Edit.
 */
const canvasTsx = readFileSync(
  resolve(__dirname, "../app/takeoff/studio/StudioCanvas.tsx"),
  "utf8",
);

describe("Takeoff Studio sticky Length / Count place", () => {
  it("keeps tool linear after finishLinear (Done run)", () => {
    const start = canvasTsx.indexOf("function finishLinear");
    assert.ok(start > -1, "expected finishLinear");
    const block = canvasTsx.slice(start, start + 1200);
    assert.doesNotMatch(block, /tool:\s*["']select["']/);
    assert.match(block, /tool:\s*["']linear["']/);
  });

  it("exits sticky mark-up tools on Escape", () => {
    const esc = canvasTsx.indexOf('event.key === "Escape"');
    assert.ok(esc > -1);
    const block = canvasTsx.slice(esc, esc + 900);
    assert.match(block, /studio\.tool === "linear"/);
    assert.match(block, /studio\.tool === "count"/);
    assert.match(block, /tool:\s*["']select["']/);
  });
});

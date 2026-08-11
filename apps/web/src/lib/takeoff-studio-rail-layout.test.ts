import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for Takeoff Studio left-rail layout.
 * Catches the bounce of absolute-rail / sticky-Draw-as / dropzone-over-list bugs.
 */
const root = resolve(__dirname, "..");
const studioCss = readFileSync(resolve(root, "app/takeoff/studio/studio.css"), "utf8");
const pageTsx = readFileSync(resolve(root, "app/takeoff/page.tsx"), "utf8");

function blockFor(selector: string, source: string) {
  const re = new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`, "m");
  const match = source.match(re);
  expect(match, `expected CSS block for ${selector}`).toBeTruthy();
  return match![1];
}

describe("Takeoff Studio left-rail layout contract", () => {
  it("keeps a flex body + non-absolute desktop rail with a scrollable pane", () => {
    const body = blockFor(".nexa-studio-body", studioCss);
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);

    const rail = blockFor(".nexa-studio-rail", studioCss);
    expect(rail).toMatch(/position:\s*relative/);
    expect(rail).not.toMatch(/position:\s*absolute/);
    expect(rail).toMatch(/min-height:\s*0/);
    expect(rail).toMatch(/overflow:\s*hidden/);
    expect(rail).toMatch(/flex-direction:\s*column/);

    const scroll = blockFor(".nexa-studio-rail-scroll", studioCss);
    expect(scroll).toMatch(/flex:\s*1\s+1\s+0%/);
    expect(scroll).toMatch(/min-height:\s*0/);
    expect(scroll).toMatch(/overflow-y:\s*auto/);
  });

  it("forbids sticky Draw-as outside the scroll pane", () => {
    expect(studioCss).not.toMatch(/\.nexa-studio-rail-draw-sticky\s*\{/);
    expect(pageTsx).not.toMatch(/nexa-studio-rail-draw-sticky/);
    expect(pageTsx).toMatch(/nexa-studio-rail-acc-draw/);
  });

  it("stacks drawing list above the dropzone in markup", () => {
    const drawingsStart = pageTsx.indexOf("<h2>Drawings</h2>");
    expect(drawingsStart).toBeGreaterThan(-1);
    const slice = pageTsx.slice(drawingsStart, drawingsStart + 1800);
    const listIdx = slice.indexOf("nexa-studio-doc-list");
    const dropIdx = slice.indexOf("nexa-studio-drawing-drop");
    expect(listIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeGreaterThan(-1);
    expect(listIdx).toBeLessThan(dropIdx);
  });

  it("keeps drawing dropzone in normal flow (no absolute cover)", () => {
    const drop = blockFor(".nexa-studio-drawing-drop", studioCss);
    expect(drop).toMatch(/position:\s*relative/);
    expect(drop).not.toMatch(/position:\s*absolute/);
    expect(drop).toMatch(/flex:\s*0\s+0\s+auto/);
  });

  it("wraps rail sections in a single scroll pane with wheel isolation", () => {
    expect(pageTsx).toMatch(/className="nexa-studio-rail-scroll"/);
    expect(pageTsx).toMatch(/onWheel=\{\(event\) => \{\s*[\s\S]*?event\.stopPropagation\(\);/);
    const scrollOpen = pageTsx.indexOf('className="nexa-studio-rail-scroll"');
    const scrollCloseHint = pageTsx.indexOf("</aside>", scrollOpen);
    const railChunk = pageTsx.slice(scrollOpen, scrollCloseHint);
    expect(railChunk).toMatch(/Draw as/);
    expect(railChunk).toMatch(/Drawings/);
    expect(railChunk).toMatch(/Rates/);
  });
});

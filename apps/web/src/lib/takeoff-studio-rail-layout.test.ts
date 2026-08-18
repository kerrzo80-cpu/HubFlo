import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

/**
 * Regression guard for Takeoff Studio left-rail layout.
 * Catches content-sized rail (no scrollport), sticky Draw-as, dropzone-over-list.
 */
const root = resolve(__dirname, "..");
const studioCss = readFileSync(resolve(root, "app/takeoff/studio/studio.css"), "utf8");
const pageTsx = readFileSync(resolve(root, "app/takeoff/page.tsx"), "utf8");
const globalsCss = readFileSync(resolve(root, "app/globals.css"), "utf8");

function blockFor(selector: string, source: string) {
  const re = new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`, "m");
  const match = source.match(re);
  assert.ok(match, `expected CSS block for ${selector}`);
  return match![1];
}

describe("Takeoff Studio left-rail layout contract", () => {
  it("keeps a definite-height body grid with an absolute rail scrollport (Safari-safe)", () => {
    const body = blockFor(".nexa-studio-body", studioCss);
    assert.match(body, /display:\s*grid/);
    assert.match(body, /minmax\(0,\s*1fr\)/);
    assert.match(body, /height:\s*0/);
    assert.match(body, /min-height:\s*0/);
    assert.match(body, /overflow:\s*hidden/);

    const rail = blockFor(".nexa-studio-rail", studioCss);
    assert.match(rail, /height:\s*100%/);
    assert.match(rail, /max-height:\s*100%/);
    assert.match(rail, /min-height:\s*0/);
    assert.match(rail, /overflow:\s*hidden/);
    assert.match(rail, /position:\s*relative/);

    const scroll = blockFor(".nexa-studio-rail-scroll", studioCss);
    assert.match(scroll, /position:\s*absolute/);
    assert.match(scroll, /inset:\s*6px/);
    assert.match(scroll, /min-height:\s*0/);
    assert.match(scroll, /overflow-y:\s*scroll/);
  });

  it("locks desktop document scroll whenever .nexa-studio is present", () => {
    const studioLock = globalsCss.slice(globalsCss.indexOf("Studio owns a locked"));
    assert.match(studioLock, /html:has\(\.nexa-studio\)/);
    assert.match(studioLock, /overflow:\s*hidden\s*!important/);
  });

  it("forbids sticky Draw-as outside the scroll pane", () => {
    assert.doesNotMatch(studioCss, /\.nexa-studio-rail-draw-sticky\s*\{/);
    assert.doesNotMatch(pageTsx, /nexa-studio-rail-draw-sticky/);
    assert.match(pageTsx, /nexa-studio-rail-acc-draw/);
  });

  it("stacks drawing list above the dropzone in markup", () => {
    const drawingsStart = pageTsx.indexOf("<h2>Drawings</h2>");
    assert.ok(drawingsStart > -1);
    const slice = pageTsx.slice(drawingsStart, drawingsStart + 4500);
    const listIdx = slice.indexOf("TakeoffDrawingFolders");
    const dropIdx = slice.indexOf("nexa-studio-drawing-drop");
    assert.ok(listIdx > -1);
    assert.ok(dropIdx > -1);
    assert.ok(listIdx < dropIdx);
  });

  it("orders Linked then Drawings before Draw as in the rail", () => {
    const linked = pageTsx.indexOf("<h2>Linked</h2>");
    const drawings = pageTsx.indexOf("<h2>Drawings</h2>");
    const drawAs = pageTsx.indexOf("<h2>Draw as</h2>");
    const more = pageTsx.indexOf("<h2>More</h2>");
    assert.ok(linked > -1);
    assert.ok(drawings > linked);
    assert.ok(drawAs > drawings);
    assert.ok(more > drawAs);
    assert.doesNotMatch(pageTsx, /<h2>Projects<\/h2>/);
    assert.match(pageTsx, /Takeoff records/);
  });

  it("keeps Set scale alerts in-flow above Drawings (not canvas overlay)", () => {
    const linked = pageTsx.indexOf("<h2>Linked</h2>");
    const drawings = pageTsx.indexOf("<h2>Drawings</h2>");
    const railAlert = pageTsx.indexOf("nexa-studio-rail-alert");
    assert.ok(railAlert > linked);
    assert.ok(railAlert < drawings);
    assert.match(pageTsx, /nexa-studio-rail-alert nexa-studio-boq-scale-warn/);
    // Overlay stack must not include the page-scale prompt (that covered tools).
    const bannerStack = pageTsx.slice(
      pageTsx.indexOf("nexa-studio-banner-stack"),
      pageTsx.indexOf("nexa-studio-body"),
    );
    assert.doesNotMatch(bannerStack, /Set scale before measuring/);
    assert.doesNotMatch(studioCss, /\.nexa-studio-rail-alert[^{]*\{[^}]*position:\s*absolute/);
  });

  it("keeps drawing dropzone in normal flow (no absolute cover)", () => {
    const drop = blockFor(".nexa-studio-drawing-drop", studioCss);
    assert.match(drop, /position:\s*relative/);
    assert.doesNotMatch(drop, /position:\s*absolute/);
    assert.match(drop, /flex:\s*0\s+0\s+auto/);
  });

  it("wraps rail sections in a single scroll pane with wheel isolation", () => {
    assert.match(pageTsx, /className="nexa-studio-rail-scroll"/);
    assert.match(pageTsx, /onWheel=\{\(event\) => \{\s*[\s\S]*?event\.stopPropagation\(\);/);
    const scrollOpen = pageTsx.indexOf('className="nexa-studio-rail-scroll"');
    const scrollCloseHint = pageTsx.indexOf("</aside>", scrollOpen);
    const railChunk = pageTsx.slice(scrollOpen, scrollCloseHint);
    assert.match(railChunk, /Draw as/);
    assert.match(railChunk, /Drawings/);
    assert.match(railChunk, /Rates/);
  });
});

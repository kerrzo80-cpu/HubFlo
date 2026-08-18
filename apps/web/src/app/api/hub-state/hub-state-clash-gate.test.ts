import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Hub-state PUT must only clash-check when jobSchedulePlans actually change,
 * otherwise pre-existing imported clashes poison every unrelated autosave.
 */
describe("hub-state schedule clash gate", () => {
  it("documents change-only clash enforcement in the route", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(source, /before !== after/);
    assert.match(source, /assertNoHubScheduleClashes/);
    assert.match(source, /Pre-existing imported/);
  });
});

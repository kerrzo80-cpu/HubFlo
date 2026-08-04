import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeTimelineEntry, sortTimelineEntries, timelineSortKey } from "./record-timeline";

describe("record timeline sorting", () => {
  it("parses en-GB display timestamps", () => {
    assert.equal(timelineSortKey("04 Aug 2026 14:30"), "2026-08-04T14:30:00");
    assert.equal(timelineSortKey("2026-08-04"), "2026-08-04T00:00:00");
  });

  it("sorts newest first", () => {
    const entries = sortTimelineEntries([
      makeTimelineEntry({
        id: "a",
        kind: "audit",
        stage: "lead",
        stageRef: "L-1",
        title: "older",
        detail: "",
        actor: "A",
        at: "01 Aug 2026 09:00",
      }),
      makeTimelineEntry({
        id: "b",
        kind: "communication",
        stage: "job",
        stageRef: "J-1",
        title: "newer",
        detail: "",
        actor: "B",
        at: "04 Aug 2026 14:30",
      }),
    ]);
    assert.equal(entries[0]?.id, "b");
    assert.equal(entries[1]?.id, "a");
  });
});

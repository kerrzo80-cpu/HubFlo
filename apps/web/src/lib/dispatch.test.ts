import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findDispatchClashes, rangesClashWithTravelBuffer, timeToMinutes } from "./dispatch";

describe("dispatch travel buffer", () => {
  it("treats adjacent jobs as clash when buffer does not fit", () => {
    assert.equal(
      rangesClashWithTravelBuffer(
        { start: timeToMinutes("09:00"), end: timeToMinutes("11:00") },
        { start: timeToMinutes("11:10"), end: timeToMinutes("13:00") },
        20,
      ),
      true,
    );
    assert.equal(
      rangesClashWithTravelBuffer(
        { start: timeToMinutes("09:00"), end: timeToMinutes("11:00") },
        { start: timeToMinutes("11:30"), end: timeToMinutes("13:00") },
        20,
      ),
      false,
    );
  });

  it("finds engineer-day clashes with travel buffer", () => {
    const clashes = findDispatchClashes(
      [
        {
          id: "a",
          engineerName: "Chris",
          date: "2026-08-10",
          start: "09:00",
          end: "11:00",
          label: "Job A",
        },
        {
          id: "b",
          engineerName: "Chris",
          date: "2026-08-10",
          start: "11:15",
          end: "13:00",
          label: "Job B",
        },
      ],
      20,
    );
    assert.equal(clashes.length, 1);
    assert.match(clashes[0]!.detail, /travel/i);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { previousCalendarMonth } from "./blake-core";

test("previousCalendarMonth returns an exact inclusive UTC date range", () => {
  assert.deepEqual(previousCalendarMonth(new Date("2026-08-20T12:00:00Z")), {
    from: "2026-07-01",
    to: "2026-07-31",
  });
});

test("previousCalendarMonth crosses a year boundary", () => {
  assert.deepEqual(previousCalendarMonth(new Date("2027-01-08T12:00:00Z")), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
});

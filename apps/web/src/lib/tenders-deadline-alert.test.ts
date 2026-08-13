import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alertForDeadline,
  tenderNeedsDeadlineAlert,
  type TenderStatus,
} from "@/lib/tenders-types";

describe("tender deadline alerts", () => {
  it("flags open tenders due within 7 days", () => {
    assert.equal(alertForDeadline("2026-08-15", "2026-08-13", "In Progress"), "Due this week");
    assert.equal(alertForDeadline("2026-08-15", "2026-08-13", "Not Started"), "Due this week");
    assert.equal(alertForDeadline("2026-08-15", "2026-08-13", "Needs Reviewed"), "Due this week");
  });

  it("drops Sent / Won / Lost from due-this-week and other deadline alerts", () => {
    const closed: TenderStatus[] = ["Sent", "Won", "Lost"];
    for (const status of closed) {
      assert.equal(tenderNeedsDeadlineAlert(status), false);
      assert.equal(alertForDeadline("2026-08-15", "2026-08-13", status), "");
      assert.equal(alertForDeadline("2026-08-01", "2026-08-13", status), "");
    }
  });

  it("still alerts when status is omitted (legacy callers)", () => {
    assert.equal(alertForDeadline("2026-08-15", "2026-08-13"), "Due this week");
  });
});

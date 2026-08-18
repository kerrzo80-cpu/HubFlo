import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { effectiveJobHealthTone } from "./job-health-tone";

describe("effectiveJobHealthTone", () => {
  it("keeps red blocked jobs red even when overdue", () => {
    assert.equal(
      effectiveJobHealthTone(
        { health: "red", status: "In Progress", scheduledDate: "2020-01-01" },
        "2026-08-18",
      ),
      "red",
    );
  });

  it("promotes overdue open jobs to attention", () => {
    assert.equal(
      effectiveJobHealthTone(
        { health: "green", status: "In Progress", due: "2020-01-01" },
        "2026-08-18",
      ),
      "amber",
    );
  });

  it("treats unknown health as attention, not on track", () => {
    assert.equal(
      effectiveJobHealthTone({ health: "blue", status: "Scheduled" }, "2026-08-18"),
      "amber",
    );
  });

  it("maps waiting statuses to blocked", () => {
    assert.equal(
      effectiveJobHealthTone({ health: "green", status: "Waiting on parts" }, "2026-08-18"),
      "red",
    );
  });

  it("maps approval required to attention", () => {
    assert.equal(
      effectiveJobHealthTone({ health: "green", status: "Approval required" }, "2026-08-18"),
      "amber",
    );
  });
});

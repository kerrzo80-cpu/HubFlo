import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { effectiveJobHealthTone, jobAttentionReasons, primaryJobAttentionReason } from "./job-health-tone";

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

describe("jobAttentionReasons", () => {
  it("lists approval and overdue reasons for an amber job", () => {
    const reasons = jobAttentionReasons(
      {
        health: "green",
        status: "Approval required",
        due: "2020-01-01",
        next: "Review variation V-003",
      },
      "2026-08-18",
    );
    assert.equal(reasons[0]?.code, "approval_required");
    assert.equal(reasons.some((item) => item.code === "overdue_due"), true);
    assert.equal(
      primaryJobAttentionReason(
        { health: "green", status: "Approval required", due: "2020-01-01", next: "Review variation V-003" },
        "2026-08-18",
      )?.label,
      "Approval required",
    );
  });

  it("lists waiting on parts as blocked", () => {
    const reasons = jobAttentionReasons(
      { health: "green", status: "Waiting on parts", next: "Chase pump delivery" },
      "2026-08-18",
    );
    assert.equal(reasons[0]?.code, "waiting_parts");
    assert.equal(reasons[0]?.tone, "red");
  });

  it("surfaces imported review instead of generic follow-up", () => {
    const reasons = jobAttentionReasons(
      { health: "blue", status: "In progress", next: "Review imported job" },
      "2026-08-18",
    );
    assert.equal(reasons[0]?.code, "imported_review");
    assert.equal(reasons[0]?.label, "Review imported job");
  });
});

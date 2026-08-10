import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addFaultComment,
  createFaultIssue,
  faultDashboardStats,
  getFaultIssue,
  listFaultIssues,
  updateFaultIssue,
} from "@/lib/faults-data";
import { formatFaultReference } from "@/lib/faults-types";

describe("faults-data", () => {
  it("formats permanent NX references", () => {
    assert.equal(formatFaultReference(1), "NX-001");
    assert.equal(formatFaultReference(27), "NX-027");
    assert.equal(formatFaultReference(100), "NX-100");
  });

  it("creates issues with permanent refs and activity", () => {
    const first = createFaultIssue({
      description: "Search resets when I open a customer and go back.",
      module: "Core",
      type: "fault",
      priority: "high",
      reporterName: "Brian Kerr",
      sourceRoute: "/people",
    });
    assert.match(first.reference, /^NX-\d{3,}$/);
    assert.equal(first.status, "inbox");
    assert.equal(first.originalDescription.includes("Search resets"), true);
    assert.equal(first.activity[0]?.kind, "created");
    assert.equal(getFaultIssue(first.reference)?.id, first.id);

    const second = createFaultIssue({
      description: "Add invoice date range filters",
      module: "Core",
      type: "improvement",
      reporterName: "Office",
    });
    assert.notEqual(first.reference, second.reference);
    const refs = listFaultIssues().map((issue) => issue.reference);
    assert.equal(new Set(refs).size, refs.length);
  });

  it("tracks status and priority changes in activity", () => {
    const issue = createFaultIssue({
      description: "Pipe size resets on floor change",
      module: "TakeOff",
      type: "fault",
      priority: "medium",
      reporterName: "Brian",
    });
    const updated = updateFaultIssue(
      issue.id,
      { priority: "high", status: "approved", title: "Preserve TakeOff pipe size across floors" },
      { name: "Brian" },
    );
    assert.equal(updated.priority, "high");
    assert.equal(updated.status, "approved");
    assert.equal(updated.title.includes("Preserve"), true);
    assert.ok(updated.activity.some((row) => row.kind === "priority_changed"));
    assert.ok(updated.activity.some((row) => row.kind === "status_changed"));

    const withComment = addFaultComment(issue.id, "Happens on Hot & cold layer", { name: "Brian" });
    assert.equal(withComment.comments.length >= 1, true);
  });

  it("builds dashboard stats", () => {
    createFaultIssue({
      description: "Urgent field crash",
      module: "Field",
      type: "fault",
      priority: "urgent",
      reporterName: "Tester",
    });
    const stats = faultDashboardStats();
    assert.ok(stats.openFaults >= 1);
    assert.ok(typeof stats.openByModule.Field === "number" || typeof stats.openByModule.Core === "number");
  });
});

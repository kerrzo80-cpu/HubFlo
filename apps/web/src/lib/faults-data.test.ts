import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addFaultComment,
  buildDevelopmentTaskMarkdown,
  createCustomerFeedbackRequest,
  createFaultIssue,
  faultDashboardStats,
  getFaultIssue,
  listFaultIssues,
  promoteCustomerFeedbackToIssue,
  recordFaultTestResult,
  updateFaultIssue,
} from "@/lib/faults-data";
import { formatFaultReference, guessModuleFromRoute } from "@/lib/faults-types";

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

  it("guesses module from route for quick report capture", () => {
    assert.equal(guessModuleFromRoute("/takeoffs"), "TakeOff");
    assert.equal(guessModuleFromRoute("/field/jobs"), "Field");
    assert.equal(guessModuleFromRoute("/setup"), "Setup / Admin");
  });

  it("PASS completes and FAIL returns to in progress with required note", () => {
    const issue = createFaultIssue({
      description: "Ready for test item",
      module: "Core",
      type: "fault",
      reporterName: "Brian",
      status: "ready_to_test",
    });
    assert.throws(
      () => recordFaultTestResult(issue.id, { result: "fail" }, { name: "Tester" }),
      /FAIL requires a note/,
    );
    const failed = recordFaultTestResult(
      issue.id,
      { result: "fail", note: "Still resets on back", buildVersion: "build-1" },
      { name: "Tester" },
    );
    assert.equal(failed.status, "in_progress");
    assert.equal(failed.testHistory[0]?.result, "fail");

    const ready = updateFaultIssue(failed.id, { status: "ready_to_test" }, { name: "Dev" });
    const passed = recordFaultTestResult(ready.id, { result: "pass", buildVersion: "build-2" }, { name: "Tester" });
    assert.equal(passed.status, "complete");
    assert.ok(passed.completedAt);
    assert.equal(passed.testHistory[0]?.result, "pass");
  });

  it("promotes customer feedback into a permanent NX issue", () => {
    const request = createCustomerFeedbackRequest({
      companyName: "Acme Plumbing",
      description: "Please add a date filter on invoices.",
      reporterName: "Customer",
      module: "Core",
      type: "improvement",
    });
    const { issue, request: linked } = promoteCustomerFeedbackToIssue(request.id, { name: "Brian" });
    assert.match(issue.reference, /^NX-\d{3,}$/);
    assert.equal(linked?.linkedIssueReference, issue.reference);
    assert.equal(linked?.customerStatus, "planned");
    assert.deepEqual(issue.promotedFromRequestIds, [request.id]);
    assert.ok(issue.activity.some((row) => row.kind === "promoted"));
  });

  it("builds a development task markdown package", () => {
    const issue = createFaultIssue({
      description: "Search box clears after opening a customer",
      module: "Core",
      type: "fault",
      priority: "high",
      reporterName: "Brian",
    });
    const md = buildDevelopmentTaskMarkdown(issue);
    assert.match(md, new RegExp(issue.reference));
    assert.match(md, /Acceptance criteria/i);
    assert.match(md, /Search box clears/);
  });
});

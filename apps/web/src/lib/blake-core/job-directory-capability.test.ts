import assert from "node:assert/strict";
import test from "node:test";

import { jobMatchesDirectoryBucket } from "./job-directory-capability";
import {
  contextualiseJobDirectoryFollowUp,
  looksLikeJobDirectoryFollowUp,
  looksLikeJobDirectoryQuestion,
  recentJobDirectoryBucket,
  requestedJobDirectoryBucket,
} from "../blake-job-directory";

test("In Progress directory matches the same five statuses as the NeXa Jobs screen", () => {
  for (const status of ["Scheduled", "In progress", "Waiting on parts", "Waiting on customer", "Approval required"]) {
    assert.equal(jobMatchesDirectoryBucket({ status }, "in_progress"), true, status);
  }
  for (const status of ["Pending", "Accepted", "Completed", "Ready to invoice", "Invoiced", "Closed"]) {
    assert.equal(jobMatchesDirectoryBucket({ status }, "in_progress"), false, status);
  }
});

test("ongoing and In Progress folder questions route to the In Progress directory", () => {
  assert.equal(requestedJobDirectoryBucket("Give me a list of jobs ongoing at the moment"), "in_progress");
  assert.equal(requestedJobDirectoryBucket("Are there jobs sitting in the in progress area of NeXa?"), "in_progress");
  assert.equal(requestedJobDirectoryBucket("Show jobs in the progress folder"), "in_progress");
  assert.equal(looksLikeJobDirectoryQuestion("Give me a list of jobs ongoing at the moment"), true);
});

test("job status change commands are not intercepted as directory questions", () => {
  assert.equal(requestedJobDirectoryBucket("Mark job J-1001 in progress"), "in_progress");
  assert.equal(looksLikeJobDirectoryQuestion("Mark job J-1001 in progress"), false);
  assert.equal(looksLikeJobDirectoryQuestion("Change job J-1001 to completed"), false);
});

test("active jobs stay distinct from the In Progress folder", () => {
  assert.equal(requestedJobDirectoryBucket("Show all active jobs"), "active");
  assert.equal(jobMatchesDirectoryBucket({ status: "Pending" }, "active"), true);
  assert.equal(jobMatchesDirectoryBucket({ status: "Ready to invoice" }, "active"), true);
  assert.equal(jobMatchesDirectoryBucket({ status: "Invoiced" }, "active"), false);
  assert.equal(jobMatchesDirectoryBucket({ status: "Closed" }, "active"), false);
});

test("short follow-ups retain the previously listed job folder instead of becoming a fresh search", () => {
  const history = [
    { role: "user" as const, text: "What jobs are in pending?" },
    { role: "assistant" as const, text: "There are 29 jobs in NeXa's Pending area (Accepted, Pending, Enquiry, Quoted):\n\n• J-1001 · Test customer · Pending" },
  ];

  assert.equal(recentJobDirectoryBucket(history), "pending");
  assert.equal(looksLikeJobDirectoryFollowUp("So there are waiting to be booked in?", history), true);
  assert.match(
    contextualiseJobDirectoryFollowUp("So there are waiting to be booked in?", history),
    /refers to the jobs Blake just listed from NeXa's Pending area/i,
  );
});

test("job write requests do not get swallowed by previous folder context", () => {
  const history = [
    { role: "assistant" as const, text: "There are 29 jobs in NeXa's Pending area (Accepted, Pending, Enquiry, Quoted)." },
  ];
  assert.equal(looksLikeJobDirectoryFollowUp("Book job J-1001 for tomorrow", history), false);
});

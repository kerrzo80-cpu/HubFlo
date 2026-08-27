import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("passaround status moves ignore schedule clash", () => {
  it("jobs PATCH only clash-checks when schedule fields change", () => {
    const source = readFileSync(path.join(root, "src/app/api/jobs/[id]/route.ts"), "utf8");
    assert.match(source, /scheduleFieldsChanging/);
    assert.match(
      source,
      /Status-only moves \(Complete \/ Ready to invoice\) must not re-litigate/,
    );
    assert.match(source, /if \(scheduleFieldsChanging && nextManager && nextDate && nextTime\)/);
  });

  it("CoreApp holds local jobReviews against hub poll wipe", () => {
    const source = readFileSync(path.join(root, "src/app/CoreApp.tsx"), "utf8");
    assert.match(source, /JOB_REVIEW_SERVER_SYNC_HOLD_MS/);
    assert.match(source, /markJobReviewEdited/);
    assert.match(source, /hasRecentLocalJobReviewEdit/);
    assert.match(source, /Prefer local ticks while a passaround save is in flight/);
    assert.match(source, /async function persistJobReviewsForInvoice/);
    assert.match(
      source,
      /construction: true,\s*commercial: true,\s*office: true,/s,
    );
  });
});

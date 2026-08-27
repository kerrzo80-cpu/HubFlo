import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("getJobs peeks jobReviews once instead of cloning hub per job", () => {
  const source = readFileSync(path.join(root, "src/lib/workflow-data.ts"), "utf8");
  assert.match(source, /peekHubJobReviews/);
  assert.match(source, /withEnforcedInvoiceReview\(job, reviews\)/);
  assert.doesNotMatch(
    source,
    /function withEnforcedInvoiceReview\(job: Job\): Job \{\s*if \(job\.status !== "Ready to invoice"\) return job;\s*const review = getHubDetailState\(\)\.jobReviews/,
  );
});

test("CoreApp boots live APIs in waves with 502 retry", () => {
  const source = readFileSync(path.join(root, "src/app/CoreApp.tsx"), "utf8");
  assert.match(source, /fetchWave/);
  assert.match(source, /\[502, 503, 504\]/);
  assert.match(source, /fetchWave\("\/api\/jobs"\)/);
  assert.match(source, /fetchWave\("\/api\/hub-state"\)/);
});

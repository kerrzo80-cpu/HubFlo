import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("getJobs peeks jobReviews once instead of cloning hub per job", () => {
  const source = readFileSync(path.join(root, "src/lib/workflow-data.ts"), "utf8");
  assert.match(source, /peekHubJobReviews/);
  assert.match(source, /withEnforcedInvoiceReview\(\{ \.\.\.job \}, reviews\)/);
  assert.match(source, /workflowStoreHydrated/);
  assert.doesNotMatch(source, /return clone\(getStore\(\)\.jobs\)/);
});

test("CoreApp boots live APIs sequentially with 502 retry", () => {
  const source = readFileSync(path.join(root, "src/app/CoreApp.tsx"), "utf8");
  assert.match(source, /fetchWave/);
  assert.match(source, /\[502, 503, 504\]/);
  assert.match(source, /fetchWave\("\/api\/jobs"\)/);
  assert.match(source, /fetchWave\("\/api\/hub-state"\)/);
  assert.match(source, /Fetch ONE route at a time/);
});

test("people list GETs hydrate once without deep-cloning from disk every time", () => {
  const source = readFileSync(path.join(root, "src/lib/people-data.ts"), "utf8");
  assert.match(source, /peopleStoreHydrated/);
  assert.match(source, /return peopleStore\.clients\.map/);
});

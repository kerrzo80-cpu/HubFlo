import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("passaround holds fat hub autosave", () => {
  it("CoreApp holds hub autosave during passaround and hub PUT ignores jobReviews", () => {
    const core = readFileSync(path.join(process.cwd(), "src/app/CoreApp.tsx"), "utf8");
    assert.match(core, /PASSAROUND_HOLD_MS = 20_000/);
    assert.match(core, /function markJobReviewEdited\(\)[\s\S]*hubAutosaveHoldUntilRef\.current = Math\.max/);
    assert.match(core, /if \(Date\.now\(\) < passaroundHoldUntilRef\.current\) \{\s*return;/);
    assert.match(core, /async function completeSelectedJob\(\)[\s\S]*hubAutosaveHoldUntilRef\.current = Math\.max/);
    assert.match(core, /Intentionally NOT: jobs, quotes, leads, clients, clientSites, auditEvents, jobReviewApprovals/);
    assert.match(core, /jobReviews intentionally omitted/);

    const hubRoute = readFileSync(path.join(process.cwd(), "src/app/api/hub-state/route.ts"), "utf8");
    assert.match(hubRoute, /delete \(payload as \{ jobReviews\?: unknown \}\)\.jobReviews/);
    assert.match(hubRoute, /peekHubDetailState\(\)/);
  });
});

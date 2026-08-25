import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { secretAuthCronPaths } from "./proxy";

describe("secretAuthCronPaths", () => {
  it("includes office backup and other Render cron routes", () => {
    assert.equal(secretAuthCronPaths.has("/api/office-backup/cron"), true);
    assert.equal(secretAuthCronPaths.has("/api/integrations/simpro/sync/cron"), true);
    assert.equal(secretAuthCronPaths.has("/api/integrations/simpro/import/tick"), true);
    assert.equal(secretAuthCronPaths.has("/api/reports/board-pack/cron"), true);
    assert.equal(secretAuthCronPaths.has("/api/ops/postgres-reconcile"), true);
  });

  it("does not open interactive office-backup admin APIs", () => {
    assert.equal(secretAuthCronPaths.has("/api/office-backup"), false);
    assert.equal(secretAuthCronPaths.has("/api/office-backup/restore"), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Cron auth contract (kept as a lightweight doc-test so we do not regress to
 * session/role-header gates that Read-only showFinance accidentally satisfied).
 */
describe("office-backup cron auth contract", () => {
  it("documents secret-only auth for /api/office-backup/cron", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(source, /x-nexa-backup-secret/);
    assert.match(source, /NEXA_BACKUP_CRON_SECRET/);
    assert.doesNotMatch(source, /canManage|getAccessProfileFromHeaders/);
  });
});

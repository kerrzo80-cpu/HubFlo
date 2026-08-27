import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isPassaroundBusy, markPassaroundBusy } from "@/lib/passaround-busy";

describe("passaround busy gate", () => {
  it("marks busy for hub PUT deferral", () => {
    markPassaroundBusy(5_000);
    assert.equal(isPassaroundBusy(), true);
  });

  it("wire: passaround marks busy; hub PUT checks gate; save skips clone", () => {
    const passaround = readFileSync(
      path.join(process.cwd(), "src/app/api/jobs/[id]/passaround/route.ts"),
      "utf8",
    );
    assert.match(passaround, /markPassaroundBusy/);

    const hub = readFileSync(path.join(process.cwd(), "src/app/api/hub-state/route.ts"), "utf8");
    assert.match(hub, /isPassaroundBusy/);
    assert.match(hub, /passaround_busy/);

    const store = readFileSync(path.join(process.cwd(), "src/lib/hub-detail-store.ts"), "utf8");
    assert.match(store, /isPassaroundBusy/);
    assert.doesNotMatch(store, /return safeCloneHub\(hubDetailState\)/);

    const core = readFileSync(path.join(process.cwd(), "src/app/CoreApp.tsx"), "utf8");
    assert.match(core, /function openJobDrawer\(jobId: string\)[\s\S]*hubAutosaveAbortRef\.current\?\.abort/);
  });
});

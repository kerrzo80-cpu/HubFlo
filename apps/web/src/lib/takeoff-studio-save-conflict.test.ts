import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { takeoffStudioSaveConflicts } from "@/lib/takeoff-studio-save-conflict";

describe("takeoffStudioSaveConflicts", () => {
  it("allows first save and matching tokens", () => {
    assert.equal(takeoffStudioSaveConflicts(undefined, undefined), false);
    assert.equal(takeoffStudioSaveConflicts("t1", undefined), false);
    assert.equal(takeoffStudioSaveConflicts("t1", "t1"), false);
  });

  it("flags when another session already wrote", () => {
    assert.equal(takeoffStudioSaveConflicts("t2", "t1"), true);
  });
});

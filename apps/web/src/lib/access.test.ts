import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultDeniedRole,
  getAccessProfile,
  getAccessProfileFromHeaders,
  roleAccess,
  roleHeaderName,
  permissionHeaderName,
} from "./access.ts";

describe("access profile defaults", () => {
  it("uses Read-only when role is missing (never Owner/Admin)", () => {
    assert.equal(defaultDeniedRole, "Read-only");
    assert.deepEqual(getAccessProfile(null), roleAccess["Read-only"]);
    assert.deepEqual(getAccessProfileFromHeaders(new Headers()), roleAccess["Read-only"]);
  });

  it("does not grant customize from permission JSON alone without a role", () => {
    const headers = new Headers({
      [permissionHeaderName]: JSON.stringify({ canCustomize: true, showFinance: true }),
    });
    // Missing role resolves to Read-only, then overlays explicit overrides.
    const profile = getAccessProfileFromHeaders(headers);
    assert.equal(profile.canCustomize, true);
    assert.equal(profile.showFinance, true);
    assert.equal(profile.canCreateJob, false);
  });

  it("honours an explicit Engineer role", () => {
    const headers = new Headers({ [roleHeaderName]: "Engineer" });
    const profile = getAccessProfileFromHeaders(headers);
    assert.equal(profile.canCreateQuote, false);
    assert.equal(profile.canCustomize, false);
    assert.deepEqual(profile, roleAccess.Engineer);
  });
});

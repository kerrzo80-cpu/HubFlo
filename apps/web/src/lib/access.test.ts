import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultDeniedRole,
  getAccessProfile,
  getAccessProfileFromHeaders,
  permissionHeaderName,
  roleAccess,
  roleHeaderName,
} from "@/lib/access";

describe("access ACL defaults", () => {
  it("defaults missing role to Read-only (never Owner/Admin)", () => {
    assert.equal(defaultDeniedRole, "Read-only");
    const profile = getAccessProfile(null);
    assert.deepEqual(profile, roleAccess["Read-only"]);
    assert.equal(profile.canCustomize, false);
    assert.equal(profile.canDeleteJobs, false);
    assert.equal(profile.canEditJobs, false);
  });

  it("defaults invalid role strings to Read-only", () => {
    // @ts-expect-error intentional invalid role for runtime guard
    const profile = getAccessProfile("Superuser");
    assert.deepEqual(profile, roleAccess["Read-only"]);
  });

  it("resolves missing role header to Read-only", () => {
    const headers = new Headers();
    const profile = getAccessProfileFromHeaders(headers);
    assert.deepEqual(profile, roleAccess["Read-only"]);
  });

  it("still honours an explicit Owner/Admin header when present", () => {
    const headers = new Headers({
      [roleHeaderName]: "Owner/Admin",
      [permissionHeaderName]: "{}",
    });
    const profile = getAccessProfileFromHeaders(headers);
    assert.deepEqual(profile, roleAccess["Owner/Admin"]);
    assert.equal(profile.canCustomize, true);
  });

  it("applies permission overrides on top of the denied default", () => {
    const profile = getAccessProfile(null, { canEditJobs: true });
    assert.equal(profile.canEditJobs, true);
    assert.equal(profile.canCustomize, false);
  });
});

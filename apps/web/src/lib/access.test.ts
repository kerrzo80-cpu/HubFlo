import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultDeniedRole,
  getAccessProfile,
  getAccessProfileFromHeaders,
  hasCoreOfficeAccess,
  hasFieldAppAccess,
  permissionHeaderName,
  resolveEmployeeGanttColor,
  roleAccess,
  roleHeaderName,
  toStoredAccessProfile,
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

  it("keeps Engineer Field-only by default", () => {
    const profile = getAccessProfile("Engineer");
    assert.equal(hasFieldAppAccess(profile), true);
    assert.equal(hasCoreOfficeAccess(profile), false);
    assert.equal(profile.showJobs, false);
    assert.equal(profile.showFinance, false);
  });

  it("stores a full explicit profile so Owner/Admin merge cannot reopen unticked boxes", () => {
    const stored = toStoredAccessProfile("Engineer", {
      showCore: false,
      showField: true,
      showJobs: false,
      showFinance: false,
    });
    const asIfOwner = getAccessProfile("Owner/Admin", stored);
    assert.equal(asIfOwner.showCore, false);
    assert.equal(asIfOwner.showField, true);
    assert.equal(asIfOwner.showJobs, false);
    assert.equal(asIfOwner.showFinance, false);
    assert.equal(asIfOwner.canCustomize, false);
  });

  it("resolves gantt colours from profile or a stable name hash", () => {
    assert.equal(resolveEmployeeGanttColor("Chris", "#ff00aa"), "#ff00aa");
    assert.equal(resolveEmployeeGanttColor("Chris", "not-a-colour").startsWith("#"), true);
    assert.equal(resolveEmployeeGanttColor("Chris"), resolveEmployeeGanttColor("Chris"));
  });
});

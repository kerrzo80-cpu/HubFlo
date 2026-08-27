import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import {
  denyAccessProfile,
  getAccessProfile,
  getAccessProfileFromHeaders,
  roleHeaderName,
  permissionHeaderName,
} from "./access.ts";

describe("access profile defaults", () => {
  const previous = process.env.NEXA_AUTH_MODE;

  after(() => {
    if (previous === undefined) delete process.env.NEXA_AUTH_MODE;
    else process.env.NEXA_AUTH_MODE = previous;
  });

  it("denies missing role when users auth is enabled", () => {
    process.env.NEXA_AUTH_MODE = "users";
    assert.deepEqual(getAccessProfile(null), denyAccessProfile);
    const headers = new Headers();
    assert.deepEqual(getAccessProfileFromHeaders(headers), denyAccessProfile);
  });

  it("ignores permission JSON alone under users auth without role", () => {
    process.env.NEXA_AUTH_MODE = "users";
    const headers = new Headers({
      [permissionHeaderName]: JSON.stringify({ canCustomize: true, showFinance: true }),
    });
    assert.equal(getAccessProfileFromHeaders(headers).canCustomize, false);
    assert.equal(getAccessProfileFromHeaders(headers).showFinance, false);
  });

  it("honours proxy-injected role under users auth", () => {
    process.env.NEXA_AUTH_MODE = "users";
    const headers = new Headers({
      [roleHeaderName]: "Engineer",
      "x-nexa-auth-user-id": "user-1",
    });
    const profile = getAccessProfileFromHeaders(headers);
    assert.equal(profile.canCreateQuote, false);
    assert.equal(profile.showJobs, true);
  });

  it("keeps Owner/Admin default for local/pilot without users auth", () => {
    delete process.env.NEXA_AUTH_MODE;
    assert.equal(getAccessProfile(null).canCustomize, true);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdditionalUserSession,
  createAuthUser,
  createUserSession,
  deleteAuthUser,
  getAuthUserForSession,
} from "./auth-store";

test("additional device session does not revoke existing session", () => {
  const suffix = crypto.randomUUID();
  const user = createAuthUser({
    name: `Drive Test ${suffix}`,
    username: `drive-${suffix}`,
    password: `Drive-${suffix}-secure`,
    role: "Read-only",
  });

  try {
    const mobile = createUserSession(user.id);
    const browser = createAdditionalUserSession(user.id);

    assert.equal(getAuthUserForSession(mobile.token)?.id, user.id);
    assert.equal(getAuthUserForSession(browser.token)?.id, user.id);
  } finally {
    deleteAuthUser(user.id);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdditionalUserSession,
  createAuthUser,
  createUserSession,
  deleteAuthUser,
  getAuthUserForSession,
  maximumActiveSessionsPerUser,
} from "./auth-store";

test("normal sign-ins keep existing browser and mobile sessions active", () => {
  const suffix = crypto.randomUUID();
  const user = createAuthUser({
    name: `Device Test ${suffix}`,
    username: `device-${suffix}`,
    password: `Device-${suffix}-secure`,
    role: "Read-only",
  });

  try {
    const mobile = createUserSession(user.id);
    const browser = createUserSession(user.id);
    const handoff = createAdditionalUserSession(user.id);

    assert.equal(getAuthUserForSession(mobile.token)?.id, user.id);
    assert.equal(getAuthUserForSession(browser.token)?.id, user.id);
    assert.equal(getAuthUserForSession(handoff.token)?.id, user.id);
  } finally {
    deleteAuthUser(user.id);
  }
});

test("device sessions stay bounded and prune the oldest token", () => {
  const suffix = crypto.randomUUID();
  const user = createAuthUser({
    name: `Bounded Device Test ${suffix}`,
    username: `bounded-device-${suffix}`,
    password: `Bounded-${suffix}-secure`,
    role: "Read-only",
  });

  try {
    const sessions = Array.from(
      { length: maximumActiveSessionsPerUser + 1 },
      () => createUserSession(user.id),
    );

    assert.equal(getAuthUserForSession(sessions[0].token), null);
    for (const session of sessions.slice(1)) {
      assert.equal(getAuthUserForSession(session.token)?.id, user.id);
    }
  } finally {
    deleteAuthUser(user.id);
  }
});

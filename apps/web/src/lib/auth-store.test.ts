import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticateUser,
  changeOwnPassword,
  createAuthUser,
  createUserSession,
  getAuthUserForSession,
  nexaSessionMaxAgeSeconds,
} from "./auth-store.ts";

test("sessions expire within 12 hours and new users must change password", () => {
  assert.equal(nexaSessionMaxAgeSeconds, 60 * 60 * 12);
  const username = `user-${Date.now()}`;
  const created = createAuthUser({
    name: "Test User",
    username,
    password: "temporary-password",
    role: "Office",
  });
  assert.equal(created.mustChangePassword, true);
  const user = authenticateUser(username, "temporary-password");
  assert.ok(user);
  assert.equal(user!.mustChangePassword, true);

  const changed = changeOwnPassword(user!.id, "temporary-password", "brand-new-password");
  assert.equal(changed.mustChangePassword, false);
  assert.equal(authenticateUser(username, "temporary-password"), null);
  assert.ok(authenticateUser(username, "brand-new-password"));

  const session = createUserSession(changed.id);
  assert.ok(getAuthUserForSession(session.token));
});

import assert from "node:assert/strict";
import test from "node:test";

import { consumeBlakeDriveHandoff, createBlakeDriveHandoff } from "./blake-drive-handoff";

test("Blake drive handoff is single use", () => {
  const userId = `handoff-user-${crypto.randomUUID()}`;
  const handoff = createBlakeDriveHandoff(userId);

  const first = consumeBlakeDriveHandoff(handoff.code);
  assert.equal(first?.userId, userId);
  assert.equal(consumeBlakeDriveHandoff(handoff.code), null);
});

test("unknown Blake drive handoff code is rejected", () => {
  assert.equal(consumeBlakeDriveHandoff(`unknown-${crypto.randomUUID()}`), null);
});

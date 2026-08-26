import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  acquireRecordLock,
  getActiveRecordLock,
  heartbeatRecordLock,
  releaseRecordLock,
  requestRecordLockAccess,
} from "./record-edit-locks";
import { deleteServerStore } from "./server-store";

describe("record-edit-locks", () => {
  test("second user gets viewer mode while first holds lock", () => {
    deleteServerStore("record-edit-locks-v1");
    const first = acquireRecordLock({
      recordType: "job",
      recordId: "job-1",
      holderUserId: "user-a",
      holderName: "Alice",
    });
    assert.equal(first.ok && first.mode, "editor");
    const second = acquireRecordLock({
      recordType: "job",
      recordId: "job-1",
      holderUserId: "user-b",
      holderName: "Bob",
    });
    assert.equal(second.ok && second.mode, "viewer");
    assert.equal(getActiveRecordLock("job:job-1")?.holderUserId, "user-a");
  });

  test("heartbeat extends lock for holder", () => {
    deleteServerStore("record-edit-locks-v1");
    acquireRecordLock({
      recordType: "quote",
      recordId: "q-1",
      holderUserId: "user-a",
      holderName: "Alice",
    });
    const before = getActiveRecordLock("quote:q-1")?.expiresAt;
    heartbeatRecordLock("quote:q-1", "user-a");
    const after = getActiveRecordLock("quote:q-1")?.expiresAt;
    assert.notEqual(before, after);
  });

  test("release clears lock for next editor", () => {
    deleteServerStore("record-edit-locks-v1");
    acquireRecordLock({
      recordType: "lead",
      recordId: "lead-1",
      holderUserId: "user-a",
      holderName: "Alice",
    });
    releaseRecordLock("lead:lead-1", "user-a");
    const next = acquireRecordLock({
      recordType: "lead",
      recordId: "lead-1",
      holderUserId: "user-b",
      holderName: "Bob",
    });
    assert.equal(next.ok && next.mode, "editor");
  });

  test("request access requires active foreign lock", () => {
    deleteServerStore("record-edit-locks-v1");
    acquireRecordLock({
      recordType: "invoice",
      recordId: "inv-1",
      holderUserId: "user-a",
      holderName: "Alice",
    });
    const ok = requestRecordLockAccess({
      key: "invoice:inv-1",
      requesterUserId: "user-b",
      requesterName: "Bob",
    });
    assert.equal(ok.ok, true);
  });
});

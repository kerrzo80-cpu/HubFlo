import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Documents the client save-merge rule used in heat-design/page.tsx:
 * never let a slower PUT wipe a newer local plan.
 */
function shouldKeepLocalRooms(input: {
  localUpdatedAt: string;
  savedUpdatedAt: string;
  localRoomCount: number;
  savedRoomCount: number;
}) {
  if (input.localUpdatedAt.localeCompare(input.savedUpdatedAt) > 0) return true;
  if (input.localRoomCount > input.savedRoomCount) return true;
  return false;
}

describe("heat design save merge", () => {
  it("keeps local rooms when a stale save returns fewer rooms", () => {
    assert.equal(
      shouldKeepLocalRooms({
        localUpdatedAt: "2026-08-06T21:00:02.000Z",
        savedUpdatedAt: "2026-08-06T21:00:01.000Z",
        localRoomCount: 2,
        savedRoomCount: 1,
      }),
      true,
    );
  });

  it("accepts server rooms when local is not newer", () => {
    assert.equal(
      shouldKeepLocalRooms({
        localUpdatedAt: "2026-08-06T21:00:01.000Z",
        savedUpdatedAt: "2026-08-06T21:00:02.000Z",
        localRoomCount: 1,
        savedRoomCount: 2,
      }),
      false,
    );
  });
});

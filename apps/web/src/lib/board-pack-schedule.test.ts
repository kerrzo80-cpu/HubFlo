import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldSendBoardPackNow, type BoardPackSchedule } from "./board-pack-schedule";

describe("board pack schedule", () => {
  it("fires Monday 08:00 UTC once when enabled", () => {
    const schedule: BoardPackSchedule = {
      enabled: true,
      to: "brian@example.com",
      weekday: 1,
      hourUtc: 8,
    };
    const monday = new Date("2026-08-10T08:15:00.000Z");
    assert.equal(shouldSendBoardPackNow(monday, schedule), true);
    assert.equal(
      shouldSendBoardPackNow(monday, { ...schedule, lastSentAt: "2026-08-10T08:05:00.000Z" }),
      false,
    );
    const tuesday = new Date("2026-08-11T08:15:00.000Z");
    assert.equal(shouldSendBoardPackNow(tuesday, schedule), false);
  });
});

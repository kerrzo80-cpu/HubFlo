import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimproScheduleBody,
  extractExistingScheduleId,
  parseSimproStaffId,
  parseSimproStaffMap,
  resolveDefaultScheduleRateId,
} from "@/lib/simpro-schedule-push";

describe("simpro-schedule-push helpers", () => {
  it("parses simpro-staff employee ids and plain numeric ids", () => {
    assert.equal(parseSimproStaffId("simpro-staff-12"), 12);
    assert.equal(parseSimproStaffId("SIMPRO-STAFF-99"), 99);
    assert.equal(parseSimproStaffId("45"), 45);
    assert.equal(parseSimproStaffId("emp-local"), undefined);
    assert.equal(parseSimproStaffId(""), undefined);
  });

  it("parses SIMPRO_STAFF_MAP entries by id or name", () => {
    const map = parseSimproStaffMap("emp-1:12, Alex Plumber:34, bad, :9, name:");
    assert.equal(map.get("emp-1"), 12);
    assert.equal(map.get("alex plumber"), 34);
    assert.equal(map.size, 2);
  });

  it("resolves default schedule rate from env-shaped strings", () => {
    assert.equal(resolveDefaultScheduleRateId("378"), 378);
    assert.equal(resolveDefaultScheduleRateId("  4 "), 4);
    assert.equal(resolveDefaultScheduleRateId(""), undefined);
    assert.equal(resolveDefaultScheduleRateId("rate-1"), undefined);
  });

  it("builds the simPRO schedule create/update body", () => {
    assert.deepEqual(
      buildSimproScheduleBody({
        staffId: 12,
        date: "2026-08-04T00:00:00Z",
        startTime: "08:00:00",
        endTime: "12:30:59",
        scheduleRateId: 378,
        notes: "First visit",
      }),
      {
        Staff: 12,
        Date: "2026-08-04",
        Notes: "First visit",
        IsLocked: false,
        Blocks: [
          {
            StartTime: "08:00",
            EndTime: "12:30",
            ScheduleRate: 378,
          },
        ],
      },
    );
  });

  it("extracts an existing schedule id from 422-style responses", () => {
    assert.equal(
      extractExistingScheduleId({
        errors: [
          {
            path: null,
            message: "A schedule for this job on this date already exists. Refer to schedule 46268",
            value: 46268,
          },
        ],
      }),
      46268,
    );
    assert.equal(
      extractExistingScheduleId({
        errors: [{ message: "Refer to schedule 99", value: null }],
      }),
      99,
    );
    assert.equal(extractExistingScheduleId({ errors: [] }), undefined);
  });
});

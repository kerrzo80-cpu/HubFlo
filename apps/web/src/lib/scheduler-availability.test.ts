import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { weekDays, type EmployeeAvailability } from "@/lib/access";
import {
  availabilityForDate,
  availabilityLabelForDate,
  employeeHasAnyAvailability,
  scheduleBookingChipLabel,
  weekdayFromIsoDate,
} from "@/lib/scheduler-availability";

function card(partial: Partial<EmployeeAvailability>): EmployeeAvailability {
  const base = weekDays.reduce((acc, day) => {
    acc[day] = { active: false, from: "00:00", to: "00:00" };
    return acc;
  }, {} as EmployeeAvailability);
  return { ...base, ...partial };
}

describe("scheduler availability", () => {
  it("maps ISO dates to weekday keys using noon UTC", () => {
    assert.equal(weekdayFromIsoDate("2026-08-07"), "Fri"); // Friday
    assert.equal(weekdayFromIsoDate("2026-08-03"), "Mon");
  });

  it("honours unticked Friday on the employee card (Errol case)", () => {
    const errol = card({
      Mon: { active: true, from: "08:30", to: "16:30" },
      Tue: { active: true, from: "08:30", to: "16:30" },
      Wed: { active: true, from: "08:30", to: "16:30" },
      Thu: { active: true, from: "08:30", to: "16:30" },
      Fri: { active: false, from: "00:00", to: "00:00" },
    });
    assert.equal(availabilityForDate("2026-08-07", errol).active, false);
    assert.equal(availabilityLabelForDate("2026-08-07", errol), "Unavailable");
    assert.equal(availabilityForDate("2026-08-06", errol).active, true);
  });

  it("does not invent Friday availability when the card is missing", () => {
    assert.equal(availabilityForDate("2026-08-07", null).active, false);
    assert.equal(availabilityForDate("2026-08-07", undefined).active, false);
  });

  it("defaults contractors to Mon–Fri when they have no employee card", () => {
    assert.equal(availabilityForDate("2026-08-07", null, { isContractor: true }).active, true);
    assert.equal(availabilityForDate("2026-08-08", null, { isContractor: true }).active, false); // Sat
  });

  it("treats all-off cards as unavailable (no hardcoded fallback)", () => {
    const allOff = card({});
    assert.equal(employeeHasAnyAvailability(allOff), false);
    assert.equal(availabilityForDate("2026-08-07", allOff).active, false);
  });

  it("builds readable booking chip labels", () => {
    assert.equal(
      scheduleBookingChipLabel({
        ref: "J-1042",
        customerName: "Megan Ray",
        costCentreName: "Install",
      }),
      "J-1042 · Megan Ray · Install",
    );
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertLeadSurveyAgainstPlans,
  assertNoHubScheduleClashes,
  hubAssignmentsOverlap,
  leadSurveyToAssignment,
} from "./schedule-clash.ts";
import { assertQuoteStatusTransition } from "./workflow-data.ts";

test("detects same-engineer overlaps", () => {
  assert.equal(
    hubAssignmentsOverlap(
      { id: "a", employeeId: "e1", startDate: "2026-08-18", startTime: "09:00", endDate: "2026-08-18", endTime: "12:00" },
      { id: "b", employeeId: "e1", startDate: "2026-08-18", startTime: "11:00", endDate: "2026-08-18", endTime: "15:00" },
    ),
    true,
  );
  assert.equal(
    hubAssignmentsOverlap(
      { id: "a", employeeId: "e1", startDate: "2026-08-18", startTime: "09:00", endDate: "2026-08-18", endTime: "12:00" },
      { id: "b", employeeId: "e2", startDate: "2026-08-18", startTime: "11:00", endDate: "2026-08-18", endTime: "15:00" },
    ),
    false,
  );
  assert.equal(
    hubAssignmentsOverlap(
      { id: "a", employeeName: "Sam Kerr", startDate: "2026-08-18", startTime: "09:00", endDate: "2026-08-18", endTime: "12:00" },
      { id: "b", employeeName: "Sam Kerr", startDate: "2026-08-18", startTime: "11:00", endDate: "2026-08-18", endTime: "15:00" },
    ),
    true,
  );
  // Plan with employeeId still clashes with name-only lead survey when names match
  assert.equal(
    hubAssignmentsOverlap(
      {
        id: "a",
        employeeId: "e1",
        employeeName: "Sam",
        startDate: "2026-08-18",
        startTime: "09:00",
        endDate: "2026-08-18",
        endTime: "12:00",
      },
      { id: "b", employeeName: "Sam", startDate: "2026-08-18", startTime: "11:00", endDate: "2026-08-18", endTime: "15:00" },
    ),
    true,
  );
});

test("assertNoHubScheduleClashes blocks overlapping plans", () => {
  const error = assertNoHubScheduleClashes({
    job1: [
      {
        id: "a",
        employeeId: "e1",
        employeeName: "Sam",
        startDate: "2026-08-18",
        startTime: "09:00",
        endDate: "2026-08-18",
        endTime: "12:00",
        costCentreName: "Boiler",
      },
    ],
    job2: [
      {
        id: "b",
        employeeId: "e1",
        employeeName: "Sam",
        startDate: "2026-08-18",
        startTime: "11:00",
        endDate: "2026-08-18",
        endTime: "15:00",
        costCentreName: "UFH",
      },
    ],
  });
  assert.ok(error);
  assert.match(String(error), /clash/i);
});

test("lead survey clashes with jobSchedulePlans", () => {
  const assignment = leadSurveyToAssignment({
    id: "lead-1",
    ref: "L-100",
    surveyor: "Sam",
    surveyDate: "2026-08-18",
    surveyTime: "10:00",
  });
  assert.ok(assignment);
  assert.equal(assignment!.endTime, "11:00");

  const error = assertLeadSurveyAgainstPlans(
    { id: "lead-1", ref: "L-100", surveyor: "Sam", surveyDate: "2026-08-18", surveyTime: "10:00" },
    {
      job1: [
        {
          id: "plan-a",
          employeeId: "e1",
          employeeName: "Sam",
          startDate: "2026-08-18",
          startTime: "09:30",
          endDate: "2026-08-18",
          endTime: "12:00",
          costCentreName: "Boiler",
        },
      ],
    },
  );
  assert.ok(error);
  assert.match(String(error), /clash/i);

  const clean = assertLeadSurveyAgainstPlans(
    { id: "lead-2", ref: "L-101", surveyor: "Sam", surveyDate: "2026-08-18", surveyTime: "14:00" },
    {
      job1: [
        {
          id: "plan-a",
          employeeName: "Sam",
          startDate: "2026-08-18",
          startTime: "09:30",
          endDate: "2026-08-18",
          endTime: "12:00",
          costCentreName: "Boiler",
        },
      ],
    },
  );
  assert.equal(clean, null);
});

test("quote status transitions block Accepted → Sent", () => {
  assert.ok(assertQuoteStatusTransition("Accepted", "Sent"));
  assert.equal(assertQuoteStatusTransition("Draft", "Sent"), null);
  assert.equal(assertQuoteStatusTransition("Sent", "Accepted"), null);
});

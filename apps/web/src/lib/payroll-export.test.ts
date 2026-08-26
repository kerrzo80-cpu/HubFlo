import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPayrollExportRows,
  payrollExportToCsv,
  summarizePayrollByEngineer,
} from "@/lib/payroll-export";

describe("payroll-export", () => {
  const employees = [
    {
      id: "e1",
      name: "Sam Plumber",
      profile: {
        payroll: { hourlyRate: 28 },
        bankDetails: { sortCode: "20-00-00", accountNumber: "12345678" },
      },
    },
  ];

  it("builds detail rows from approved timesheets and employee rates", () => {
    const rows = buildPayrollExportRows(
      [
        {
          id: "ts1",
          jobId: "j1",
          jobRef: "J-100",
          actor: "Sam Plumber",
          hours: 8,
          costValue: 224,
          workDate: "2026-08-10",
          createdAt: "2026-08-10T18:00:00.000Z",
          status: "Approved",
          kind: "timesheet",
        },
        {
          id: "ts2",
          jobId: "j2",
          jobRef: "J-101",
          actor: "Sam Plumber",
          hours: 0,
          createdAt: "2026-08-11T10:00:00.000Z",
          status: "Approved",
          kind: "timesheet",
        },
        {
          id: "ts3",
          jobId: "j3",
          jobRef: "J-102",
          actor: "Other",
          hours: 4,
          createdAt: "2026-08-11T10:00:00.000Z",
          status: "Submitted",
          kind: "timesheet",
        },
      ],
      employees,
      { weekEnding: "2026-08-16" },
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.engineer, "Sam Plumber");
    assert.equal(rows[0]?.hours, 8);
    assert.equal(rows[0]?.hourlyRate, 28);
    assert.equal(rows[0]?.sortCode, "20-00-00");
    assert.equal(rows[0]?.weekEnding, "2026-08-16");
  });

  it("summarises by engineer and emits CSV", () => {
    const rows = buildPayrollExportRows(
      [
        {
          id: "a",
          jobId: "j1",
          jobRef: "J-1",
          actor: "Sam Plumber",
          hours: 8,
          costValue: 224,
          workDate: "2026-08-10",
          createdAt: "2026-08-10T12:00:00.000Z",
          status: "Approved",
          kind: "timesheet",
        },
        {
          id: "b",
          jobId: "j2",
          jobRef: "J-2",
          actor: "Sam Plumber",
          hours: 4,
          costValue: 112,
          workDate: "2026-08-11",
          createdAt: "2026-08-11T12:00:00.000Z",
          status: "Approved",
          kind: "timesheet",
        },
      ],
      employees,
    );
    const summary = summarizePayrollByEngineer(rows);
    assert.equal(summary.length, 1);
    assert.equal(summary[0]?.hours, 12);
    assert.equal(summary[0]?.labourCost, 336);

    const csv = payrollExportToCsv(rows);
    assert.match(csv, /Work date,Week ending,Engineer/);
    assert.match(csv, /Sam Plumber/);
    assert.match(csv, /J-1/);
  });
});

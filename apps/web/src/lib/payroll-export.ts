/**
 * Payroll CSV export from approved timesheet delivery events.
 * Office reviews on the Payroll pane, then downloads a pay-run file for Xero/Sage/payroll bureau.
 */

export type PayrollExportEvent = {
  id: string;
  jobId: string;
  jobRef: string;
  actor: string;
  hours?: number;
  costValue?: number;
  workDate?: string;
  weekEnding?: string;
  createdAt: string;
  status?: string;
  kind: string;
};

export type PayrollExportEmployee = {
  id: string;
  name: string;
  profile?: {
    payroll?: {
      hourlyRate?: number;
      overtimeRate?: number;
    };
    bankDetails?: {
      sortCode?: string;
      accountNumber?: string;
    };
  };
};

export type PayrollExportRow = {
  workDate: string;
  weekEnding: string;
  engineer: string;
  jobRef: string;
  hours: number;
  hourlyRate: number;
  labourCost: number;
  sortCode: string;
  accountNumber: string;
  eventId: string;
};

function csvEscape(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function matchEmployee(
  actor: string,
  employees: PayrollExportEmployee[],
): PayrollExportEmployee | null {
  const name = actor.trim().toLowerCase();
  if (!name) return null;
  return (
    employees.find((employee) => employee.name.trim().toLowerCase() === name) ||
    employees.find((employee) => name.includes(employee.name.trim().toLowerCase())) ||
    null
  );
}

function weekEndingFrom(workDate: string, fallbackWeekEnd: string): string {
  if (!workDate) return fallbackWeekEnd;
  const date = new Date(`${workDate}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return fallbackWeekEnd;
  const day = date.getDay(); // 0 Sun … 6 Sat
  const toSunday = day === 0 ? 0 : 7 - day;
  date.setDate(date.getDate() + toSunday);
  return date.toISOString().slice(0, 10);
}

export function buildPayrollExportRows(
  events: PayrollExportEvent[],
  employees: PayrollExportEmployee[],
  options?: { weekEnding?: string },
): PayrollExportRow[] {
  const fallbackWeekEnd = options?.weekEnding || "";
  const rows: PayrollExportRow[] = [];

  for (const event of events) {
    if (event.kind !== "timesheet" || event.status !== "Approved") continue;
    const hours = Number(event.hours) || 0;
    if (hours <= 0) continue;

    const employee = matchEmployee(event.actor || "", employees);
    const hourlyRate =
      Number(employee?.profile?.payroll?.hourlyRate) ||
      (hours > 0 && event.costValue ? Number(event.costValue) / hours : 0) ||
      0;
    const labourCost =
      event.costValue != null && Number.isFinite(Number(event.costValue))
        ? Number(event.costValue)
        : Math.round(hours * hourlyRate * 100) / 100;
    const workDate = event.workDate || event.createdAt.slice(0, 10);
    const weekEnding =
      event.weekEnding || weekEndingFrom(workDate, fallbackWeekEnd) || fallbackWeekEnd;

    rows.push({
      workDate,
      weekEnding,
      engineer: event.actor || employee?.name || "Unknown",
      jobRef: event.jobRef || event.jobId,
      hours: Math.round(hours * 100) / 100,
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      labourCost: Math.round(labourCost * 100) / 100,
      sortCode: employee?.profile?.bankDetails?.sortCode || "",
      accountNumber: employee?.profile?.bankDetails?.accountNumber || "",
      eventId: event.id,
    });
  }

  rows.sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
    if (a.engineer !== b.engineer) return a.engineer.localeCompare(b.engineer);
    return a.jobRef.localeCompare(b.jobRef);
  });
  return rows;
}

/** Aggregate hours/cost by engineer for a compact pay-run summary sheet. */
export function summarizePayrollByEngineer(rows: PayrollExportRow[]): Array<{
  engineer: string;
  hours: number;
  labourCost: number;
  lines: number;
}> {
  const map = new Map<string, { engineer: string; hours: number; labourCost: number; lines: number }>();
  for (const row of rows) {
    const key = row.engineer.toLowerCase();
    const existing = map.get(key) || { engineer: row.engineer, hours: 0, labourCost: 0, lines: 0 };
    existing.hours += row.hours;
    existing.labourCost += row.labourCost;
    existing.lines += 1;
    map.set(key, existing);
  }
  return Array.from(map.values())
    .map((row) => ({
      ...row,
      hours: Math.round(row.hours * 100) / 100,
      labourCost: Math.round(row.labourCost * 100) / 100,
    }))
    .sort((a, b) => a.engineer.localeCompare(b.engineer));
}

export function payrollExportToCsv(rows: PayrollExportRow[]): string {
  const header = [
    "Work date",
    "Week ending",
    "Engineer",
    "Job ref",
    "Hours",
    "Hourly rate",
    "Labour cost",
    "Sort code",
    "Account number",
    "Event id",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.workDate,
        row.weekEnding,
        row.engineer,
        row.jobRef,
        row.hours.toFixed(2),
        row.hourlyRate.toFixed(2),
        row.labourCost.toFixed(2),
        row.sortCode,
        row.accountNumber,
        row.eventId,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function payrollSummaryToCsv(
  rows: ReturnType<typeof summarizePayrollByEngineer>,
  weekEnding: string,
): string {
  const header = ["Week ending", "Engineer", "Lines", "Hours", "Labour cost"];
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(
      [weekEnding, row.engineer, row.lines, row.hours.toFixed(2), row.labourCost.toFixed(2)]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function payrollExportFilename(weekStart: string, kind: "detail" | "summary" = "detail"): string {
  const stamp = weekStart || new Date().toISOString().slice(0, 10);
  return kind === "summary"
    ? `nexa-payroll-summary-wc-${stamp}.csv`
    : `nexa-payroll-detail-wc-${stamp}.csv`;
}

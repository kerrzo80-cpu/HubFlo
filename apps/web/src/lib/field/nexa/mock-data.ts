import type { DailyTimeCheck, FieldScheduleItem, TimeCheckSummary } from "@/lib/field/types";
import { hoursBetween } from "@/lib/field/format";

export const MOCK_ENGINEER = {
  id: "eng-chris",
  name: "Chris Lawson",
  trade: "Plumber / heating",
  phone: "+441224555010",
};

export const MOCK_SCHEDULE: FieldScheduleItem[] = [
  {
    scheduleId: "sched-1048-am",
    jobId: "job-1048",
    jobRef: "J-1048",
    costCentre: "Boiler service",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Heating",
    date: "2026-07-28",
    start: "08:00",
    end: "10:30",
    durationHours: 2.5,
    customer: "Northfield Properties",
    contactName: "Donna Fraser",
    phone: "+441224555102",
    address: "10 Hopetoun Court, Aberdeen, AB10 6PL",
    description: "Boiler service and remedial checks. Tenant reported intermittent hot water and noisy pump.",
    accessNotes: "Caretaker holds keys 08:00–16:00. Parking at rear lane.",
    officeNotes: [
      "Call Donna if access is delayed.",
      "Check pump valve size before requesting parts.",
    ],
    status: "Needs parts",
    attachments: [
      { id: "att-1", name: "Previous service sheet.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "21 Jun" },
      { id: "att-2", name: "Plant room layout.dwg.pdf", type: "Drawing", uploadedBy: "Office", uploadedAt: "22 Jun" },
      { id: "att-3", name: "Tenant fault photo.jpg", type: "Photo", uploadedBy: "Donna Fraser", uploadedAt: "22 Jun" },
    ],
    photos: [
      { id: "ph-1", name: "Existing boiler.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "20 Jun" },
    ],
    requirements: [
      { id: "req-1", label: "Appliance photo", status: "done" },
      { id: "req-2", label: "Data plate photo", status: "missing" },
      { id: "req-3", label: "Flue / analyser reading", status: "missing" },
      { id: "req-4", label: "Service notes", status: "optional" },
    ],
  },
  {
    scheduleId: "sched-1052-mid",
    jobId: "job-1052",
    jobRef: "J-1052",
    costCentre: "Bathroom first fix",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Plumber",
    date: "2026-07-28",
    start: "11:00",
    end: "13:00",
    durationHours: 2,
    customer: "Harbour View Homes",
    contactName: "Mark Reid",
    phone: "+441224555220",
    address: "42 Victoria Road, Aberdeen, AB11 9DR",
    description: "First-fix pipework for en-suite. Confirm soil stack position against drawing before chasing.",
    accessNotes: "Site manager on WhatsApp. Boots and hard hat required.",
    officeNotes: ["Joiner following tomorrow for boxing.", "Do not close walls until first-fix photos are on the job."],
    status: "Scheduled",
    attachments: [
      { id: "att-4", name: "En-suite GA drawing.pdf", type: "Drawing", uploadedBy: "Office", uploadedAt: "24 Jun" },
      { id: "att-5", name: "Programme week 30.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "27 Jun" },
    ],
    photos: [
      { id: "ph-2", name: "Existing bathroom.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "18 Jun" },
    ],
    requirements: [
      { id: "req-5", label: "First-fix photos", status: "missing" },
      { id: "req-6", label: "Soil stack confirmation", status: "missing" },
    ],
  },
  {
    scheduleId: "sched-1039-pm",
    jobId: "job-1039",
    jobRef: "J-1039",
    costCentre: "Door hanging / second fix",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Joiner",
    date: "2026-07-28",
    start: "14:00",
    end: "16:30",
    durationHours: 2.5,
    customer: "EWG Pilot Flat 3",
    contactName: "Site office",
    phone: "+441224555300",
    address: "3 Queens Road, Aberdeen, AB15 4ZT",
    description: "Hang internal doors and fit ironmongery per schedule. Check lining tolerances before hanging.",
    accessNotes: "Key safe 1942. Park in visitor bay.",
    officeNotes: ["Ironmongery bag is labelled Flat 3.", "Photograph latch alignment before leaving."],
    status: "Scheduled",
    attachments: [
      { id: "att-6", name: "Door schedule.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "25 Jun" },
      { id: "att-7", name: "Ironmongery list.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "25 Jun" },
    ],
    photos: [],
    requirements: [
      { id: "req-7", label: "Completion photos", status: "missing" },
      { id: "req-8", label: "Latch alignment photo", status: "optional" },
    ],
  },
];

const STORAGE_KEY = "nexa-field:time-check:v1";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarise(check: DailyTimeCheck): TimeCheckSummary {
  const scheduledHours = check.lines.reduce((sum, line) => sum + line.scheduledHours, 0);
  const actualHours = check.lines.reduce((sum, line) => sum + line.actualHours, 0);
  return {
    scheduledHours: Number(scheduledHours.toFixed(2)),
    actualHours: Number(actualHours.toFixed(2)),
    varianceHours: Number((actualHours - scheduledHours).toFixed(2)),
    pendingCount: check.lines.filter((line) => line.status === "pending").length,
    amendedCount: check.lines.filter((line) => line.status === "amended").length,
    confirmedCount: check.lines.filter((line) => line.status === "confirmed").length,
  };
}

function buildCheck(jobs: FieldScheduleItem[]): DailyTimeCheck {
  return {
    id: `time-check-${jobs[0]?.date ?? "today"}`,
    date: jobs[0]?.date ?? new Date().toISOString().slice(0, 10),
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    status: "not_started",
    lines: jobs.map((job) => ({
      scheduleId: job.scheduleId,
      jobRef: job.jobRef,
      customer: job.customer,
      costCentre: job.costCentre,
      scheduledStart: job.start,
      scheduledEnd: job.end,
      scheduledHours: job.durationHours,
      actualStart: job.start,
      actualEnd: job.end,
      breakMinutes: 0,
      actualHours: job.durationHours,
      note: "",
      status: "pending" as const,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function readCheck(jobs: FieldScheduleItem[]): DailyTimeCheck {
  if (typeof window === "undefined") return buildCheck(jobs);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildCheck(jobs);
    const parsed = JSON.parse(raw) as DailyTimeCheck;
    if (parsed.date !== jobs[0]?.date) return buildCheck(jobs);
    return parsed;
  } catch {
    return buildCheck(jobs);
  }
}

function writeCheck(check: DailyTimeCheck) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(check));
}

export function getMockTimeCheck() {
  const check = readCheck(MOCK_SCHEDULE);
  return { check: clone(check), summary: summarise(check) };
}

export function updateMockTimeLine(input: {
  scheduleId: string;
  confirmAsScheduled?: boolean;
  actualStart?: string;
  actualEnd?: string;
  breakMinutes?: number;
  note?: string;
}) {
  const check = readCheck(MOCK_SCHEDULE);
  const line = check.lines.find((item) => item.scheduleId === input.scheduleId);
  if (!line) throw new Error("Job not found on today's time check.");

  if (input.confirmAsScheduled) {
    line.actualStart = line.scheduledStart;
    line.actualEnd = line.scheduledEnd;
    line.breakMinutes = 0;
    line.actualHours = line.scheduledHours;
    line.note = input.note?.trim() || "Confirmed as scheduled.";
    line.status = "confirmed";
  } else {
    line.actualStart = input.actualStart?.trim() || line.actualStart;
    line.actualEnd = input.actualEnd?.trim() || line.actualEnd;
    line.breakMinutes = Math.max(0, Number(input.breakMinutes ?? line.breakMinutes) || 0);
    line.actualHours = hoursBetween(line.actualStart, line.actualEnd, line.breakMinutes);
    line.note = input.note?.trim() || line.note;
    const matched =
      line.actualStart === line.scheduledStart
      && line.actualEnd === line.scheduledEnd
      && line.breakMinutes === 0;
    line.status = matched ? "confirmed" : "amended";
  }

  check.status = "in_progress";
  check.updatedAt = new Date().toISOString();
  writeCheck(check);
  return { check: clone(check), summary: summarise(check) };
}

export function submitMockTimeCheck(confirmRemainingAsScheduled = false) {
  let check = readCheck(MOCK_SCHEDULE);
  if (confirmRemainingAsScheduled) {
    for (const line of check.lines) {
      if (line.status !== "pending") continue;
      const result = updateMockTimeLine({ scheduleId: line.scheduleId, confirmAsScheduled: true });
      check = result.check;
    }
  }

  const pending = check.lines.filter((line) => line.status === "pending");
  if (pending.length) {
    throw new Error(`Blake still needs a review on ${pending.length} job${pending.length === 1 ? "" : "s"}.`);
  }

  check.status = "submitted";
  check.submittedAt = new Date().toISOString();
  check.updatedAt = check.submittedAt;
  writeCheck(check);

  // Standalone mode: stash charged hours locally until NeXa is connected.
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      "nexa-field:charged-hours:v1",
      JSON.stringify({
        submittedAt: check.submittedAt,
        lines: check.lines.map((line) => ({
          scheduleId: line.scheduleId,
          jobRef: line.jobRef,
          actualHours: line.actualHours,
          note: line.note,
          status: line.status,
        })),
      }),
    );
  }

  return { check: clone(check), summary: summarise(check) };
}

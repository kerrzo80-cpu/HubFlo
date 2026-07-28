import type { DailyTimeCheck, FieldScheduleItem, TimeCheckSummary } from "@/lib/types";
import { hoursBetween } from "@/lib/format";

/** Always “today” so My Day feels live when you open the demo. */
export function demoDate() {
  return new Date().toISOString().slice(0, 10);
}

export const MOCK_ENGINEER = {
  id: "eng-chris",
  name: "Chris Lawson",
  trade: "Plumber / heating + light joinery",
  phone: "+441224555010",
};

function withToday(jobs: Omit<FieldScheduleItem, "date">[]): FieldScheduleItem[] {
  const date = demoDate();
  return jobs.map((job) => ({ ...job, date }));
}

const MOCK_SCHEDULE_BASE: Omit<FieldScheduleItem, "date">[] = [
  {
    scheduleId: "sched-1048-am",
    jobId: "job-1048",
    jobRef: "J-1048",
    costCentre: "Boiler service",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Heating",
    start: "08:00",
    end: "10:00",
    durationHours: 2,
    customer: "Northfield Properties",
    contactName: "Donna Fraser",
    phone: "+441224555102",
    address: "10 Hopetoun Court, Aberdeen, AB10 6PL",
    description:
      "Annual boiler service on Worcester Greenstar 30i. Tenant reported intermittent hot water and a noisy pump first thing.",
    accessNotes: "Caretaker holds keys 08:00–16:00. Parking at rear lane. Flat 2b entry phone #12.",
    officeNotes: [
      "Call Donna if access is delayed — she is on site until 11:00.",
      "Previous visit: pump valves looked 15mm; confirm before ordering.",
      "If parts needed, raise PO against Boiler service cost centre (not Materials float).",
      "Blake tip for play: mark this one over time later (e.g. finished 10:45) to see variance.",
    ],
    status: "Needs parts",
    attachments: [
      { id: "att-1", name: "Previous service sheet.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "21 Jun" },
      { id: "att-2", name: "Plant room layout.pdf", type: "Drawing", uploadedBy: "Office", uploadedAt: "22 Jun" },
      { id: "att-3", name: "Tenant fault photo.jpg", type: "Photo", uploadedBy: "Donna Fraser", uploadedAt: "22 Jun" },
      { id: "att-3b", name: "Manufacturer service checklist.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "22 Jun" },
    ],
    photos: [
      { id: "ph-1", name: "Existing boiler front.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "20 Jun" },
      { id: "ph-1b", name: "Pipework under boiler.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "20 Jun" },
    ],
    requirements: [
      { id: "req-1", label: "Appliance photo", status: "done" },
      { id: "req-2", label: "Data plate photo", status: "missing" },
      { id: "req-3", label: "Flue / analyser reading", status: "missing" },
      { id: "req-4", label: "Service notes", status: "optional" },
      { id: "req-4b", label: "Parts used / returned", status: "missing" },
    ],
  },
  {
    scheduleId: "sched-1107-react",
    jobId: "job-1107",
    jobRef: "J-1107",
    costCentre: "Reactive plumbing",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Plumber",
    start: "10:15",
    end: "11:15",
    durationHours: 1,
    customer: "Seafront Cafe",
    contactName: "Jamie Okoro",
    phone: "+441224555188",
    address: "7 Beach Boulevard, Aberdeen, AB24 5EG",
    description:
      "Urgent: wash-hand basin waste leaking into store cupboard. Isolate if needed and make safe. Quote follow-on if pipework is rotten.",
    accessNotes: "Ask for Jamie at the counter. Back-of-house through kitchen — mind wet floor signs.",
    officeNotes: [
      "Reactive from WhatsApp at 07:40 — customer expects morning.",
      "Van stock: 32mm trap + waste fittings already picked.",
      "If more than 1 hour, amend Blake time — office will charge extras to reactive.",
    ],
    status: "In progress",
    attachments: [
      { id: "att-r1", name: "WhatsApp leak photo.jpg", type: "Photo", uploadedBy: "Jamie Okoro", uploadedAt: "Today" },
      { id: "att-r2", name: "Cafe site plan snippet.pdf", type: "Drawing", uploadedBy: "Office", uploadedAt: "Today" },
    ],
    photos: [
      { id: "ph-r1", name: "Cupboard damp stain.jpg", type: "Photo", uploadedBy: "Customer", uploadedAt: "Today" },
    ],
    requirements: [
      { id: "req-r1", label: "Before photo", status: "done" },
      { id: "req-r2", label: "After / make-safe photo", status: "missing" },
      { id: "req-r3", label: "Materials used note", status: "missing" },
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
    start: "11:30",
    end: "13:30",
    durationHours: 2,
    customer: "Harbour View Homes",
    contactName: "Mark Reid",
    phone: "+441224555220",
    address: "42 Victoria Road, Aberdeen, AB11 9DR",
    description:
      "First-fix pipework for en-suite (hot, cold, waste). Confirm soil stack position against GA drawing before chasing. Joiner boxing tomorrow.",
    accessNotes: "Site manager on WhatsApp. Boots and hard hat required. Sign in at site cabin.",
    officeNotes: [
      "Do not close walls until first-fix photos are on the job.",
      "Soil stack was moved 150mm on latest drawing rev C — check before chasing.",
      "Materials on site: copper coil + Madelok fittings in cabin cage B.",
    ],
    status: "Scheduled",
    attachments: [
      { id: "att-4", name: "En-suite GA drawing rev C.pdf", type: "Drawing", uploadedBy: "Office", uploadedAt: "24 Jun" },
      { id: "att-5", name: "Programme week 30.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "27 Jun" },
      { id: "att-5b", name: "Pipe sizing note.pdf", type: "Note", uploadedBy: "Estimator", uploadedAt: "25 Jun" },
      { id: "att-5c", name: "Site induction sheet.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "20 Jun" },
    ],
    photos: [
      { id: "ph-2", name: "Existing bathroom strip-out.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "18 Jun" },
      { id: "ph-2b", name: "Soil stack location.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "18 Jun" },
    ],
    requirements: [
      { id: "req-5", label: "First-fix photos", status: "missing" },
      { id: "req-6", label: "Soil stack confirmation", status: "missing" },
      { id: "req-6b", label: "Pressure test note", status: "optional" },
    ],
  },
  {
    scheduleId: "sched-1088-cyl",
    jobId: "job-1088",
    jobRef: "J-1088",
    costCentre: "Cylinder swap",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Heating",
    start: "14:00",
    end: "16:00",
    durationHours: 2,
    customer: "Mrs A. Stewart",
    contactName: "Ailsa Stewart",
    phone: "+441224555401",
    address: "18 Rubislaw Den South, Aberdeen, AB15 4BD",
    description:
      "Replace vented cylinder with unvented 210L. Isolations tagged. Leave old cylinder for scrap pickup Friday.",
    accessNotes: "Side gate code 5521. Dog in house — ask owner to shut in kitchen. Driveway parking OK.",
    officeNotes: [
      "Cylinder delivered yesterday — confirm serial against PO-4412.",
      "G3 paperwork must be completed before leaving.",
      "Blake tip: this one often overruns — try amending to 3 hrs in time check.",
    ],
    status: "Scheduled",
    attachments: [
      { id: "att-c1", name: "Cylinder install method.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "26 Jun" },
      { id: "att-c2", name: "Cupboard survey photo.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "19 Jun" },
      { id: "att-c3", name: "G3 commission form.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "26 Jun" },
      { id: "att-c4", name: "PO-4412 cylinder.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "25 Jun" },
    ],
    photos: [
      { id: "ph-c1", name: "Existing cylinder.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "19 Jun" },
      { id: "ph-c2", name: "Cold feed / stopcock.jpg", type: "Photo", uploadedBy: "Survey", uploadedAt: "19 Jun" },
    ],
    requirements: [
      { id: "req-c1", label: "Before photo", status: "missing" },
      { id: "req-c2", label: "Data plate / serial photo", status: "missing" },
      { id: "req-c3", label: "G3 form complete", status: "missing" },
      { id: "req-c4", label: "Finished install photos", status: "missing" },
      { id: "req-c5", label: "Customer handover note", status: "optional" },
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
    start: "16:15",
    end: "17:45",
    durationHours: 1.5,
    customer: "EWG Pilot Flat 3",
    contactName: "Site office",
    phone: "+441224555300",
    address: "3 Queens Road, Aberdeen, AB15 4ZT",
    description:
      "Hang 3 internal doors and fit ironmongery per schedule. Check lining tolerances before hanging. Photograph latch alignment.",
    accessNotes: "Key safe 1942. Park in visitor bay. Site quiet after 17:00 — leave lights as found.",
    officeNotes: [
      "Ironmongery bag labelled Flat 3 in van cage.",
      "Door 2 lining was out last week — packers still on site.",
      "Blake tip: try confirming this one as scheduled.",
    ],
    status: "Scheduled",
    attachments: [
      { id: "att-6", name: "Door schedule.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "25 Jun" },
      { id: "att-7", name: "Ironmongery list.pdf", type: "PDF", uploadedBy: "Office", uploadedAt: "25 Jun" },
      { id: "att-7b", name: "Flat 3 floor plan.pdf", type: "Drawing", uploadedBy: "Office", uploadedAt: "24 Jun" },
    ],
    photos: [
      { id: "ph-j1", name: "Door linings in situ.jpg", type: "Photo", uploadedBy: "Joiner lead", uploadedAt: "27 Jun" },
    ],
    requirements: [
      { id: "req-7", label: "Completion photos", status: "missing" },
      { id: "req-8", label: "Latch alignment photo", status: "optional" },
      { id: "req-8b", label: "Ironmongery checklist", status: "missing" },
    ],
  },
  {
    scheduleId: "sched-1112-cb",
    jobId: "job-1112",
    jobRef: "J-1112",
    costCentre: "Callback / snag",
    engineerId: MOCK_ENGINEER.id,
    engineerName: MOCK_ENGINEER.name,
    trade: "Multi-trade",
    start: "18:00",
    end: "18:45",
    durationHours: 0.75,
    customer: "Northfield Properties",
    contactName: "Donna Fraser",
    phone: "+441224555102",
    address: "10 Hopetoun Court, Aberdeen, AB10 6PL",
    description:
      "Callback on this morning’s boiler job if parts arrived: fit pump valves and retest. If parts not in, mark needs rebook and leave.",
    accessNotes: "Same as morning visit. Caretaker may have left — use key safe if Donna confirms.",
    officeNotes: [
      "Only attend if Parts desk texts that valves are on van.",
      "Link hours to J-1048 / Boiler service when charging.",
      "Blake tip: amend down to 0.5h if parts were not ready.",
    ],
    status: "Ready to complete",
    attachments: [
      { id: "att-cb1", name: "Parts ETA note.pdf", type: "Note", uploadedBy: "Parts desk", uploadedAt: "Today" },
      { id: "att-cb2", name: "Morning job photos.zip.jpg", type: "Photo", uploadedBy: "Chris Lawson", uploadedAt: "Today" },
    ],
    photos: [
      { id: "ph-cb1", name: "Pump valves ordered.jpg", type: "Photo", uploadedBy: "Parts desk", uploadedAt: "Today" },
    ],
    requirements: [
      { id: "req-cb1", label: "Retest photo / reading", status: "missing" },
      { id: "req-cb2", label: "Customer update note", status: "optional" },
    ],
  },
];

export const MOCK_SCHEDULE: FieldScheduleItem[] = withToday(MOCK_SCHEDULE_BASE);

const STORAGE_KEY = "nexa-field:time-check:v2";
const CHARGED_KEY = "nexa-field:charged-hours:v2";
const REQUIREMENTS_KEY = "nexa-field:requirements:v1";

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
    date: jobs[0]?.date ?? demoDate(),
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
    if (parsed.date !== jobs[0]?.date || parsed.lines.length !== jobs.length) return buildCheck(jobs);
    return parsed;
  } catch {
    return buildCheck(jobs);
  }
}

function writeCheck(check: DailyTimeCheck) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(check));
}

function readRequirementOverrides(): Record<string, FieldScheduleItem["requirements"]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REQUIREMENTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FieldScheduleItem["requirements"]>) : {};
  } catch {
    return {};
  }
}

function applyRequirementOverrides(jobs: FieldScheduleItem[]): FieldScheduleItem[] {
  const overrides = readRequirementOverrides();
  return jobs.map((job) => {
    const next = overrides[job.scheduleId];
    return next ? { ...job, requirements: next } : job;
  });
}

export function getMockSchedule() {
  return applyRequirementOverrides(clone(MOCK_SCHEDULE));
}

export function getMockJob(scheduleId: string) {
  return getMockSchedule().find((job) => job.scheduleId === scheduleId) ?? null;
}

export function toggleMockRequirement(scheduleId: string, requirementId: string) {
  const jobs = getMockSchedule();
  const job = jobs.find((item) => item.scheduleId === scheduleId);
  if (!job) throw new Error("Job not found.");
  const requirements = job.requirements.map((item) => {
    if (item.id !== requirementId) return item;
    if (item.status === "optional") return item;
    const status: FieldScheduleItem["requirements"][number]["status"] = item.status === "done" ? "missing" : "done";
    return { ...item, status };
  });
  if (typeof window !== "undefined") {
    const overrides = readRequirementOverrides();
    overrides[scheduleId] = requirements;
    window.localStorage.setItem(REQUIREMENTS_KEY, JSON.stringify(overrides));
  }
  return { ...job, requirements } satisfies FieldScheduleItem;
}

export function resetMockDemo() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(CHARGED_KEY);
  window.localStorage.removeItem(REQUIREMENTS_KEY);
  // Clear legacy keys from earlier demos.
  window.localStorage.removeItem("nexa-field:time-check:v1");
  window.localStorage.removeItem("nexa-field:charged-hours:v1");
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

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      CHARGED_KEY,
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

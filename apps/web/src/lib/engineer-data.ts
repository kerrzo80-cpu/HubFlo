export type EngineerJobStatus = "Scheduled" | "Needs parts" | "Ready to complete";
export type RequirementStatus = "done" | "missing" | "optional";

export type EngineerAttachment = {
  id: string;
  name: string;
  type: "PDF" | "Photo" | "Note";
  uploadedBy: string;
  uploadedAt: string;
};

export type EngineerRequirement = {
  id: string;
  label: string;
  status: RequirementStatus;
};

export type EngineerScheduleItem = {
  scheduleId: string;
  jobId: string;
  jobRef: string;
  costCentre: string;
  engineerId: string;
  engineerName: string;
  date: string;
  start: string;
  end: string;
  durationHours: number;
  customer: string;
  contactName: string;
  phone: string;
  address: string;
  description: string;
  accessNotes: string;
  officeNotes: string[];
  status: EngineerJobStatus;
  attachments: EngineerAttachment[];
  requirements: EngineerRequirement[];
  photos: EngineerAttachment[];
};

export const engineerSchedule: EngineerScheduleItem[] = [
  {
    scheduleId: "sched-1048-am",
    jobId: "job-1048",
    jobRef: "J-1048",
    costCentre: "Boiler service",
    engineerId: "eng-scott",
    engineerName: "Scott Reid",
    date: "2026-06-23",
    start: "08:00",
    end: "10:30",
    durationHours: 2.5,
    customer: "Northfield Properties",
    contactName: "Donna Fraser",
    phone: "+441224555102",
    address: "10 Hopetoun Court, Aberdeen, AB10 6PL",
    description: "Boiler service and remedial checks. Tenant reported intermittent hot water and noisy pump during morning use.",
    accessNotes: "Caretaker holds keys between 08:00 and 16:00. Parking at rear lane.",
    officeNotes: [
      "Call Donna if access is delayed.",
      "Check whether pump valves are same size as previous visit before requesting parts.",
    ],
    status: "Needs parts",
    attachments: [
      { id: "att-1048-1", name: "Previous service sheet", type: "PDF", uploadedBy: "Office", uploadedAt: "21 Jun" },
      { id: "att-1048-2", name: "Tenant fault photo", type: "Photo", uploadedBy: "Donna Fraser", uploadedAt: "22 Jun" },
    ],
    photos: [
      { id: "photo-1048-1", name: "Pump location", type: "Photo", uploadedBy: "Scott Reid", uploadedAt: "Today 09:12" },
    ],
    requirements: [
      { id: "req-1048-plate", label: "Data plate photo", status: "done" },
      { id: "req-1048-flue", label: "Flue/analyser evidence", status: "missing" },
      { id: "req-1048-notes", label: "Service notes", status: "missing" },
    ],
  },
  {
    scheduleId: "sched-1052-mid",
    jobId: "job-1052",
    jobRef: "J-1052",
    costCentre: "Commercial heating",
    engineerId: "eng-scott",
    engineerName: "Scott Reid",
    date: "2026-06-23",
    start: "11:00",
    end: "15:00",
    durationHours: 4,
    customer: "Morrison & Co.",
    contactName: "Craig Morrison",
    phone: "+441224665220",
    address: "42 Queen's Road, Aberdeen, AB15 4YE",
    description: "Office heating upgrade continuation. Fit controls and confirm plant-room access notes before leaving site.",
    accessNotes: "Reception signs engineers in. Loading bay open before 10:00.",
    officeNotes: [
      "Customer wants a quick update before lunch.",
      "Photograph controls before closing panels.",
    ],
    status: "Scheduled",
    attachments: [
      { id: "att-1052-1", name: "Controls wiring sketch", type: "PDF", uploadedBy: "Kerry Watson", uploadedAt: "20 Jun" },
    ],
    photos: [],
    requirements: [
      { id: "req-1052-before", label: "Before photo", status: "done" },
      { id: "req-1052-controls", label: "Controls photo", status: "missing" },
      { id: "req-1052-note", label: "Engineer completion note", status: "missing" },
    ],
  },
  {
    scheduleId: "sched-1039-pm",
    jobId: "job-1039",
    jobRef: "J-1039",
    costCentre: "Reactive heating",
    engineerId: "eng-scott",
    engineerName: "Scott Reid",
    date: "2026-06-23",
    start: "15:30",
    end: "17:00",
    durationHours: 1.5,
    customer: "Aberdeen Property Care",
    contactName: "Leanne Bruce",
    phone: "+441224700880",
    address: "16 Rubislaw Park, Aberdeen, AB15 4DP",
    description: "Heating fault investigation. Occupier reports radiators cold upstairs only.",
    accessNotes: "Occupier must be called 30 mins before arrival.",
    officeNotes: ["If parts are needed, request supplier only and office will raise PO details."],
    status: "Ready to complete",
    attachments: [],
    photos: [],
    requirements: [
      { id: "req-1039-fault", label: "Fault finding note", status: "missing" },
      { id: "req-1039-photo", label: "Problem area photo", status: "optional" },
    ],
  },
];

export function getEngineerSchedule(engineerId = "eng-scott") {
  return engineerSchedule.filter((item) => item.engineerId === engineerId);
}

export function getEngineerScheduleItem(scheduleId: string) {
  return engineerSchedule.find((item) => item.scheduleId === scheduleId);
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function formatDuration(hours: number) {
  if (Number.isInteger(hours)) return `${hours}h`;
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return wholeHours ? `${wholeHours}h ${minutes}m` : `${minutes}m`;
}

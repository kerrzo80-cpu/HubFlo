import type { EngineerScheduleItem } from "@/lib/engineer-data";
import type {
  DailyTimeCheck,
  FieldAttachment,
  FieldEngineerProfile,
  FieldJobStatus,
  FieldRequirement,
  FieldScheduleItem,
  TimeCheckLine,
  TimeCheckSummary,
} from "@/lib/field/types";

function inferTrade(item: EngineerScheduleItem): FieldScheduleItem["trade"] {
  const haystack = `${item.costCentre} ${item.description}`.toLowerCase();
  if (haystack.includes("door") || haystack.includes("joinery") || haystack.includes("kitchen")) {
    return "Joiner";
  }
  if (haystack.includes("boiler") || haystack.includes("heat") || haystack.includes("cylinder")) {
    return "Heating";
  }
  if (haystack.includes("plumb") || haystack.includes("bath") || haystack.includes("pipe")) {
    return "Plumber";
  }
  return "Multi-trade";
}

function mapAttachment(item: EngineerScheduleItem["attachments"][number]): FieldAttachment {
  return {
    id: item.id,
    name: item.name,
    type:
      item.type === "Photo"
        ? "Photo"
        : item.type === "Note"
          ? "Note"
          : item.type === "Video"
            ? "Video"
            : "PDF",
    uploadedBy: item.uploadedBy,
    uploadedAt: item.uploadedAt,
  };
}

function mapRequirement(item: EngineerScheduleItem["requirements"][number]): FieldRequirement {
  return {
    id: item.id,
    label: item.label,
    status: item.status,
    evidence: item.evidence,
    stage: item.stage,
    required: item.required,
    stepId: item.stepId,
    costCentreId: item.costCentreId,
    formField: item.formField,
    validation: item.validation,
    value: item.value,
  };
}

function mapStatus(status: EngineerScheduleItem["status"]): FieldJobStatus {
  return status;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Seed engineer diary rows use a fixed demo date. Remap them to today so Field
 * My Day stays useful while Core live assignments keep their real dates.
 */
export function withLiveFieldDates(items: EngineerScheduleItem[]): EngineerScheduleItem[] {
  const today = todayIsoDate();
  return items.map((item) => (item.source === "seed" ? { ...item, date: today } : item));
}

/** Map Core engineer schedule rows into the Field app shape. */
export function engineerScheduleToFieldItem(item: EngineerScheduleItem): FieldScheduleItem {
  return {
    scheduleId: item.scheduleId,
    jobId: item.jobId,
    jobRef: item.jobRef,
    costCentre: item.costCentre,
    engineerId: item.engineerId,
    engineerName: item.engineerName,
    trade: inferTrade(item),
    date: item.date,
    start: item.start,
    end: item.end,
    durationHours: item.durationHours,
    customer: item.customer,
    contactName: item.contactName,
    phone: item.phone,
    address: item.address,
    description: item.description,
    accessNotes: item.accessNotes,
    officeNotes: item.officeNotes,
    status: mapStatus(item.status),
    attachments: item.attachments.map(mapAttachment),
    photos: item.photos.map(mapAttachment),
    requirements: item.requirements.map(mapRequirement),
  };
}

export function engineerProfileFromSchedule(
  items: EngineerScheduleItem[],
  engineerId?: string,
): FieldEngineerProfile {
  const match = engineerId
    ? items.find((item) => item.engineerId === engineerId)
    : items[0];
  if (match) {
    return {
      id: match.engineerId,
      name: match.engineerName,
      trade: inferTrade(match),
      phone: match.phone,
    };
  }
  return {
    id: engineerId || "eng-field",
    name: "Field engineer",
    trade: "Field",
    phone: "",
  };
}

type CoreTimeCheckLine = {
  scheduleId: string;
  jobRef: string;
  customer: string;
  costCentre: string;
  scheduledStart: string;
  scheduledEnd: string;
  scheduledHours: number;
  actualStart: string;
  actualEnd: string;
  breakMinutes: number;
  actualHours: number;
  note: string;
  status: string;
};

type CoreDailyTimeCheck = {
  id: string;
  date: string;
  engineerId: string;
  engineerName: string;
  status: string;
  lines: CoreTimeCheckLine[];
  submittedAt?: string;
  updatedAt: string;
};

type CoreTimeCheckSummary = {
  scheduledHours: number;
  actualHours: number;
  varianceHours: number;
  pendingCount: number;
  amendedCount: number;
  confirmedCount: number;
};

function mapLineStatus(status: string): TimeCheckLine["status"] {
  if (status === "confirmed" || status === "amended") return status;
  return "pending";
}

function mapCheckStatus(status: string): DailyTimeCheck["status"] {
  if (status === "submitted" || status === "in_progress") return status;
  return "not_started";
}

/** Normalize Core time-check payloads for Field UI. */
export function normalizeCoreTimeCheck(body: {
  check: CoreDailyTimeCheck;
  summary: CoreTimeCheckSummary;
}): { check: DailyTimeCheck; summary: TimeCheckSummary } {
  const lines: TimeCheckLine[] = (body.check.lines ?? []).map((line) => ({
    scheduleId: line.scheduleId,
    jobRef: line.jobRef,
    customer: line.customer,
    costCentre: line.costCentre,
    scheduledStart: line.scheduledStart,
    scheduledEnd: line.scheduledEnd,
    scheduledHours: line.scheduledHours,
    actualStart: line.actualStart,
    actualEnd: line.actualEnd,
    breakMinutes: line.breakMinutes,
    actualHours: line.actualHours,
    note: line.note,
    status: mapLineStatus(line.status),
  }));

  return {
    check: {
      id: body.check.id,
      date: body.check.date,
      engineerId: body.check.engineerId,
      engineerName: body.check.engineerName,
      status: mapCheckStatus(body.check.status),
      lines,
      submittedAt: body.check.submittedAt,
      updatedAt: body.check.updatedAt,
    },
    summary: {
      scheduledHours: body.summary.scheduledHours,
      actualHours: body.summary.actualHours,
      varianceHours: body.summary.varianceHours,
      pendingCount: body.summary.pendingCount,
      amendedCount: body.summary.amendedCount,
      confirmedCount: body.summary.confirmedCount,
    },
  };
}

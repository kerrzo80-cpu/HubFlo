import { randomUUID } from "node:crypto";

import { getEngineerScheduleItem, type EngineerAttachment, type EngineerRequirement } from "@/lib/engineer-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { createPurchaseRequest, getPurchaseRequests, updateJob } from "@/lib/workflow-data";

export type EngineerWorkflowNote = {
  id: string;
  text: string;
  visibility: "Office review" | "Internal team" | "Engineer private";
  createdBy: string;
  createdAt: string;
};

export type EngineerWorkflowReport = {
  id: string;
  title: string;
  body: string;
  createdBy: string;
  createdAt: string;
};

export type EngineerWorkflowPoRequest = {
  id: string;
  poNumber?: string;
  supplier: string;
  note: string;
  jobRef?: string;
  costCentreId?: string;
  costCentreName?: string;
  createdBy: string;
  createdAt: string;
  status: "Office review" | "Approved" | "Ordered" | "Rejected";
};

export type EngineerWorkflowTimeEntry = {
  id: string;
  start: string;
  end: string;
  breakMinutes: number;
  note: string;
  createdBy: string;
  createdAt: string;
  status: "Draft" | "Sent to office" | "Approved";
  source?: "Manual" | "Paper sheet scan";
};

export type EngineerWorkflowReviewItem = {
  id: string;
  type: "Note" | "Photo" | "Report" | "PO request" | "Checklist" | "Outcome" | "Time" | "Paper sheet" | "Equipment";
  title: string;
  detail: string;
  createdBy: string;
  createdAt: string;
  status: "Office review" | "Comment requested" | "Approved";
};

export type EngineerWorkflowOutcome = {
  status: "Complete" | "Needs parts" | "Needs rebooked" | "Could not access" | "Office review required";
  note: string;
  createdBy: string;
  createdAt: string;
};

export type EngineerWorkflowEquipmentEntry = {
  id: string;
  item: string;
  direction: "Booked out" | "Booked in";
  quantity: number;
  condition: string;
  createdBy: string;
  createdAt: string;
};

export type EngineerPaperSheetExtraction = {
  actualStart?: string;
  actualEnd?: string;
  breakMinutes?: number;
  equipmentOut?: string[];
  equipmentIn?: string[];
  checklistDone?: string[];
  notes?: string;
  confidence?: "High" | "Medium" | "Low";
};

export type EngineerWorkflowPaperSheetScan = {
  id: string;
  fileNames: string[];
  extractedText: string;
  extraction: EngineerPaperSheetExtraction;
  plannedHours: number;
  actualHours: number;
  varianceHours: number;
  labourCostRate: number;
  labourCostVariance: number;
  schedulerAdjustment: string;
  createdBy: string;
  createdAt: string;
};

export type EngineerJobWorkflow = {
  scheduleId: string;
  requirements: EngineerRequirement[];
  photos: EngineerAttachment[];
  notes: EngineerWorkflowNote[];
  reports: EngineerWorkflowReport[];
  poRequests: EngineerWorkflowPoRequest[];
  timeEntries: EngineerWorkflowTimeEntry[];
  equipmentEntries: EngineerWorkflowEquipmentEntry[];
  paperSheetScans: EngineerWorkflowPaperSheetScan[];
  officeReview: EngineerWorkflowReviewItem[];
  outcome?: EngineerWorkflowOutcome;
};

type EngineerWorkflowStore = {
  jobs: Record<string, EngineerJobWorkflow>;
};

export type EngineerWorkflowAction =
  | {
      action: "complete_requirement";
      payload: {
        requirementId: string;
        createdBy?: string;
      };
    }
  | {
      action: "add_photos";
      payload: {
        fileNames: string[];
        createdBy?: string;
      };
    }
  | {
      action: "add_note";
      payload: {
        text: string;
        visibility?: EngineerWorkflowNote["visibility"];
        createdBy?: string;
      };
    }
  | {
      action: "add_report";
      payload: {
        title: string;
        body: string;
        createdBy?: string;
      };
    }
  | {
      action: "request_po";
      payload: {
        supplier: string;
        note: string;
        jobRef?: string;
        costCentreId?: string;
        costCentreName?: string;
        createdBy?: string;
      };
    }
  | {
      action: "add_time_entry";
      payload: {
        start: string;
        end: string;
        breakMinutes?: number;
        note?: string;
        createdBy?: string;
      };
    }
  | {
      action: "scan_paper_sheet";
      payload: {
        fileNames?: string[];
        sheetText?: string;
        actualStart?: string;
        actualEnd?: string;
        breakMinutes?: number;
        equipmentOut?: string[];
        equipmentIn?: string[];
        checklistDone?: string[];
        notes?: string;
        aiExtraction?: EngineerPaperSheetExtraction;
        createdBy?: string;
      };
    }
  | {
      action: "set_outcome";
      payload: {
        status: EngineerWorkflowOutcome["status"];
        note: string;
        createdBy?: string;
      };
    };

const engineerWorkflowStoreSeed: EngineerWorkflowStore = {
  jobs: {},
};

const store = loadServerStore("engineer-workflow-store", engineerWorkflowStoreSeed);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date());
}

function makeId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function saveStore() {
  writeServerStore("engineer-workflow-store", store);
}

function defaultWorkflow(scheduleId: string): EngineerJobWorkflow {
  const job = getEngineerScheduleItem(scheduleId);
  return {
    scheduleId,
    requirements: clone(job?.requirements ?? []),
    photos: clone(job?.photos ?? []),
    notes: [],
    reports: [],
    poRequests: [],
    timeEntries: [],
    equipmentEntries: [],
    paperSheetScans: [],
    officeReview: [],
  };
}

function getMutableWorkflow(scheduleId: string) {
  if (!store.jobs[scheduleId]) {
    store.jobs[scheduleId] = defaultWorkflow(scheduleId);
    saveStore();
  }
  return store.jobs[scheduleId]!;
}

function normaliseWorkflow(workflow: EngineerJobWorkflow) {
  workflow.equipmentEntries ??= [];
  workflow.paperSheetScans ??= [];
  workflow.timeEntries ??= [];
  workflow.officeReview ??= [];
  workflow.requirements ??= [];
  workflow.photos ??= [];
  workflow.notes ??= [];
  workflow.reports ??= [];
  workflow.poRequests ??= [];
  return workflow;
}

function syncWorkflowPoRequestsFromCore(workflow: EngineerJobWorkflow) {
  const coreRequests = getPurchaseRequests();
  workflow.poRequests = workflow.poRequests.map((request) => {
    const coreRequest = coreRequests.find((item) => item.id === request.id);
    if (!coreRequest) return request;
    const status: EngineerWorkflowPoRequest["status"] =
      coreRequest.status === "Rejected"
        ? "Rejected"
        : coreRequest.status === "Requested"
          ? "Office review"
          : coreRequest.status === "Approved"
            ? "Approved"
            : "Ordered";
    return {
      ...request,
      poNumber: coreRequest.poNumber || request.poNumber,
      supplier: coreRequest.supplier || request.supplier,
      note: coreRequest.reason || coreRequest.item || request.note,
      status,
    };
  });
  return workflow;
}

function addReviewItem(
  workflow: EngineerJobWorkflow,
  item: Omit<EngineerWorkflowReviewItem, "id" | "createdAt" | "status"> & { createdAt?: string; status?: EngineerWorkflowReviewItem["status"] },
) {
  workflow.officeReview = [
    {
      id: makeId("engineer-review"),
      createdAt: item.createdAt ?? nowLabel(),
      status: item.status ?? "Office review",
      ...item,
    },
    ...workflow.officeReview,
  ];
}

function appendCoreJobDeliveryEvent(item: Record<string, unknown>) {
  const hubState = getHubDetailState();
  const currentEvents = Array.isArray(hubState.jobDeliveryEvents) ? hubState.jobDeliveryEvents : [];
  saveHubDetailState({
    ...hubState,
    jobDeliveryEvents: [
      {
        id: makeId("delivery"),
        createdAt: nowLabel(),
        source: "Engineer app",
        ...item,
      },
      ...currentEvents,
    ],
  });
}

export function getEngineerJobWorkflow(scheduleId: string) {
  const workflow = syncWorkflowPoRequestsFromCore(normaliseWorkflow(getMutableWorkflow(scheduleId)));
  return clone(workflow);
}

function minutesFromTime(value: string) {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function hoursBetween(start: string, end: string, breakMinutes = 0) {
  const startMinutes = minutesFromTime(start);
  const endMinutes = minutesFromTime(end);
  if (startMinutes === null || endMinutes === null) return 0;
  const rawMinutes = endMinutes >= startMinutes ? endMinutes - startMinutes : (24 * 60 - startMinutes) + endMinutes;
  return Math.max(0, (rawMinutes - Math.max(0, breakMinutes)) / 60);
}

function firstTimeRange(text: string) {
  const timeMatches = Array.from(text.matchAll(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g))
    .map((match) => `${match[1]!.padStart(2, "0")}:${match[2]}`);
  return {
    start: timeMatches[0],
    end: timeMatches[1],
  };
}

function listFromUnknown(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseSheetFallback(text: string): EngineerPaperSheetExtraction {
  const lower = text.toLowerCase();
  const range = firstTimeRange(text);
  const checklistDone = [
    lower.includes("data plate") || lower.includes("serial") ? "Data plate / serial number" : "",
    lower.includes("flue") || lower.includes("analyser") ? "Flue/analyser evidence" : "",
    lower.includes("service note") || lower.includes("defect") ? "Service notes / defects" : "",
    lower.includes("photo") ? "Arrival / before photo" : "",
  ].filter(Boolean);
  const equipmentOut = Array.from(text.matchAll(/(?:out|booked out|taken)\s*[:\-]\s*([^\n]+)/gi)).map((match) => match[1]!.trim());
  const equipmentIn = Array.from(text.matchAll(/(?:in|booked in|returned)\s*[:\-]\s*([^\n]+)/gi)).map((match) => match[1]!.trim());

  return {
    actualStart: range.start,
    actualEnd: range.end,
    equipmentOut,
    equipmentIn,
    checklistDone,
    notes: text.trim(),
    confidence: text.trim() ? "Medium" : "Low",
  };
}

function numberFromUnknown(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function engineerLabourCostRate() {
  const financeSettings = getHubDetailState().financeSettings;
  const labourRates = Array.isArray(financeSettings?.labourRates) ? financeSettings.labourRates : [];
  const firstRate = labourRates.find((rate): rate is Record<string, unknown> => Boolean(rate) && typeof rate === "object");
  return numberFromUnknown(firstRate?.costRate, 40);
}

function mergePaperSheetExtraction(
  fallback: EngineerPaperSheetExtraction,
  payload: Extract<EngineerWorkflowAction, { action: "scan_paper_sheet" }>["payload"],
): EngineerPaperSheetExtraction {
  const ai = payload.aiExtraction ?? {};
  return {
    actualStart: payload.actualStart || ai.actualStart || fallback.actualStart,
    actualEnd: payload.actualEnd || ai.actualEnd || fallback.actualEnd,
    breakMinutes: numberFromUnknown(payload.breakMinutes ?? ai.breakMinutes, fallback.breakMinutes ?? 0),
    equipmentOut: [
      ...listFromUnknown(payload.equipmentOut),
      ...listFromUnknown(ai.equipmentOut),
      ...listFromUnknown(fallback.equipmentOut),
    ],
    equipmentIn: [
      ...listFromUnknown(payload.equipmentIn),
      ...listFromUnknown(ai.equipmentIn),
      ...listFromUnknown(fallback.equipmentIn),
    ],
    checklistDone: [
      ...listFromUnknown(payload.checklistDone),
      ...listFromUnknown(ai.checklistDone),
      ...listFromUnknown(fallback.checklistDone),
    ],
    notes: payload.notes?.trim() || ai.notes || fallback.notes || payload.sheetText?.trim() || "",
    confidence: ai.confidence ?? fallback.confidence ?? "Low",
  };
}

export function applyEngineerWorkflowAction(scheduleId: string, input: EngineerWorkflowAction) {
  const workflow = normaliseWorkflow(getMutableWorkflow(scheduleId));
  const createdAt = nowLabel();
  const createdBy = input.payload.createdBy?.trim() || "Engineer";
  const job = getEngineerScheduleItem(scheduleId);

  if (input.action === "complete_requirement") {
    const requirement = workflow.requirements.find((item) => item.id === input.payload.requirementId);
    if (requirement) {
      requirement.status = "done";
      addReviewItem(workflow, {
        type: "Checklist",
        title: requirement.label,
        detail: `${requirement.label} supplied by engineer. Office can review before completion sign-off.`,
        createdBy,
        createdAt,
      });
    }
  }

  if (input.action === "add_photos") {
    const fileNames = input.payload.fileNames
      .map((fileName) => fileName.trim())
      .filter(Boolean)
      .slice(0, 10);
    const photos = fileNames.map((fileName) => ({
      id: makeId("engineer-photo"),
      name: fileName,
      type: "Photo" as const,
      uploadedBy: createdBy,
      uploadedAt: createdAt,
    }));
    workflow.photos = [...photos, ...workflow.photos];
    if (photos.length) {
      addReviewItem(workflow, {
        type: "Photo",
        title: `${photos.length} photo${photos.length === 1 ? "" : "s"} uploaded`,
        detail: photos.map((photo) => photo.name).join(", "),
        createdBy,
        createdAt,
      });
    }
  }

  if (input.action === "add_note") {
    const text = input.payload.text.trim();
    if (text) {
      const note: EngineerWorkflowNote = {
        id: makeId("engineer-note"),
        text,
        visibility: input.payload.visibility ?? "Office review",
        createdBy,
        createdAt,
      };
      workflow.notes = [note, ...workflow.notes];
      addReviewItem(workflow, {
        type: "Note",
        title: `${note.visibility} note`,
        detail: note.text,
        createdBy,
        createdAt,
      });
    }
  }

  if (input.action === "add_report") {
    const title = input.payload.title.trim() || "Engineer report";
    const body = input.payload.body.trim();
    if (body) {
      const report: EngineerWorkflowReport = {
        id: makeId("engineer-report"),
        title,
        body,
        createdBy,
        createdAt,
      };
      workflow.reports = [report, ...workflow.reports];
      addReviewItem(workflow, {
        type: "Report",
        title,
        detail: body,
        createdBy,
        createdAt,
      });
    }
  }

  if (input.action === "request_po") {
    const supplier = input.payload.supplier.trim() || "Supplier TBC";
    const note = input.payload.note.trim();
    const costCentreName = input.payload.costCentreName?.trim() || job?.costCentre || "Cost centre TBC";
    let corePurchaseRequestId = "";
    if (job?.jobId && job.jobRef) {
      const coreRequest = createPurchaseRequest({
        jobId: job.jobId,
        jobRef: job.jobRef,
        costCentreId: input.payload.costCentreId?.trim(),
        costCentreName,
        requestedBy: createdBy,
        supplier,
        item: note || "Engineer requested supplier / PO support.",
        estimatedCost: 0,
        reason: note || `Requested from engineer app for ${costCentreName}.`,
        createdAt,
      });
      corePurchaseRequestId = coreRequest.id;
      appendCoreJobDeliveryEvent({
        jobId: job.jobId,
        jobRef: job.jobRef,
        kind: "po",
        actor: createdBy,
        summary: `${supplier} PO request raised for ${costCentreName}.`,
        status: "Requested",
        costValue: 0,
      });
    }
    const request: EngineerWorkflowPoRequest = {
      id: corePurchaseRequestId || makeId("engineer-po"),
      supplier,
      note,
      jobRef: input.payload.jobRef?.trim() || job?.jobRef,
      costCentreId: input.payload.costCentreId?.trim(),
      costCentreName,
      createdBy,
      createdAt,
      status: "Office review",
    };
    workflow.poRequests = [request, ...workflow.poRequests];
    addReviewItem(workflow, {
      type: "PO request",
      title: `${supplier} · ${costCentreName}`,
      detail: note || `Engineer requested supplier / PO support for ${costCentreName}.`,
      createdBy,
      createdAt,
    });
  }

  if (input.action === "add_time_entry") {
    const breakMinutes = Math.max(0, Number(input.payload.breakMinutes ?? 0) || 0);
    const actualHours = hoursBetween(input.payload.start, input.payload.end, breakMinutes);
    const entry: EngineerWorkflowTimeEntry = {
      id: makeId("engineer-time"),
      start: input.payload.start,
      end: input.payload.end,
      breakMinutes,
      note: input.payload.note?.trim() ?? "",
      createdBy,
      createdAt,
      status: "Sent to office",
      source: "Manual",
    };
    workflow.timeEntries = [entry, ...workflow.timeEntries];
    if (job?.jobId && actualHours > 0) {
      const plannedHours = job.durationHours ?? 0;
      const varianceHours = Number((actualHours - plannedHours).toFixed(2));
      const labourCostRate = engineerLabourCostRate();
      const labourCostVariance = Number((varianceHours * labourCostRate).toFixed(2));
      updateJob(job.jobId, {
        actualStartTime: entry.start,
        actualEndTime: entry.end,
        actualDurationHours: actualHours,
        labourCostVariance,
        next: varianceHours === 0
          ? "Engineer timesheet matched schedule."
          : varianceHours < 0
            ? `Engineer timesheet shows ${Math.abs(varianceHours).toFixed(2)} hrs under schedule.`
            : `Engineer timesheet shows ${varianceHours.toFixed(2)} hrs over schedule.`,
      });
      appendCoreJobDeliveryEvent({
        jobId: job.jobId,
        jobRef: job.jobRef,
        kind: "timesheet",
        actor: createdBy,
        summary: entry.note || `${actualHours.toFixed(2)} hrs submitted by ${createdBy}.`,
        hours: actualHours,
        status: "Submitted",
      });
    }
    addReviewItem(workflow, {
      type: "Time",
      title: `${entry.start}-${entry.end}`,
      detail: entry.note || "Engineer time confirmation sent for office review.",
      createdBy,
      createdAt,
    });
  }

  if (input.action === "scan_paper_sheet") {
    const fileNames = (input.payload.fileNames ?? []).map((fileName) => fileName.trim()).filter(Boolean);
    const sheetText = input.payload.sheetText?.trim() ?? "";
    const extraction = mergePaperSheetExtraction(parseSheetFallback(sheetText), input.payload);
    const plannedHours = job?.durationHours ?? 0;
    const actualStart = extraction.actualStart || job?.start || "";
    const actualEnd = extraction.actualEnd || job?.end || "";
    const breakMinutes = Math.max(0, Number(extraction.breakMinutes ?? 0) || 0);
    const actualHours = actualStart && actualEnd ? hoursBetween(actualStart, actualEnd, breakMinutes) : 0;
    const varianceHours = Number((actualHours - plannedHours).toFixed(2));
    const labourCostRate = engineerLabourCostRate();
    const labourCostVariance = Number((varianceHours * labourCostRate).toFixed(2));
    const schedulerAdjustment = actualHours
      ? `${job?.jobRef ?? scheduleId}: scheduled ${plannedHours.toFixed(2)} hrs, actual ${actualHours.toFixed(2)} hrs (${varianceHours >= 0 ? "+" : ""}${varianceHours.toFixed(2)} hrs).`
      : "Paper sheet held for office review; actual time could not be read.";

    const scan: EngineerWorkflowPaperSheetScan = {
      id: makeId("paper-sheet"),
      fileNames,
      extractedText: sheetText,
      extraction,
      plannedHours,
      actualHours,
      varianceHours,
      labourCostRate,
      labourCostVariance,
      schedulerAdjustment,
      createdBy,
      createdAt,
    };
    workflow.paperSheetScans = [scan, ...workflow.paperSheetScans];

    if (actualStart && actualEnd && actualHours > 0) {
      const entry: EngineerWorkflowTimeEntry = {
        id: makeId("engineer-time"),
        start: actualStart,
        end: actualEnd,
        breakMinutes,
        note: extraction.notes || "Time pulled from paper job sheet scan.",
        createdBy,
        createdAt,
        status: "Sent to office",
        source: "Paper sheet scan",
      };
      workflow.timeEntries = [entry, ...workflow.timeEntries];
    }

    const equipmentEntries = [
      ...listFromUnknown(extraction.equipmentOut).map((item) => ({ item, direction: "Booked out" as const })),
      ...listFromUnknown(extraction.equipmentIn).map((item) => ({ item, direction: "Booked in" as const })),
    ].map((item) => ({
      id: makeId("engineer-equipment"),
      item: item.item,
      direction: item.direction,
      quantity: 1,
      condition: "From paper sheet scan",
      createdBy,
      createdAt,
    }));
    workflow.equipmentEntries = [...equipmentEntries, ...workflow.equipmentEntries];

    const checklistLabels = new Set(listFromUnknown(extraction.checklistDone).map((item) => item.toLowerCase()));
    workflow.requirements = workflow.requirements.map((requirement) => {
      const label = requirement.label.toLowerCase();
      const matched = Array.from(checklistLabels).some((item) => item.includes(label) || label.includes(item));
      return matched && requirement.status === "missing" ? { ...requirement, status: "done" } : requirement;
    });

    if (job?.jobId && actualHours > 0) {
      updateJob(job.jobId, {
        actualStartTime: actualStart,
        actualEndTime: actualEnd,
        actualDurationHours: actualHours,
        labourCostVariance,
        next: varianceHours === 0
          ? "Paper sheet actuals matched schedule."
          : varianceHours < 0
            ? `Paper sheet shows ${Math.abs(varianceHours).toFixed(2)} hrs under schedule. Review margin uplift.`
            : `Paper sheet shows ${varianceHours.toFixed(2)} hrs over schedule. Review cost impact.`,
      });
    }

    addReviewItem(workflow, {
      type: "Paper sheet",
      title: `Paper sheet scan · ${extraction.confidence ?? "Low"} confidence`,
      detail: `${schedulerAdjustment} Labour cost movement: ${labourCostVariance < 0 ? "-" : "+"}£${Math.abs(labourCostVariance).toFixed(2)}.`,
      createdBy,
      createdAt,
    });

    if (equipmentEntries.length) {
      addReviewItem(workflow, {
        type: "Equipment",
        title: `${equipmentEntries.length} equipment movement${equipmentEntries.length === 1 ? "" : "s"}`,
        detail: equipmentEntries.map((entry) => `${entry.direction}: ${entry.item}`).join("; "),
        createdBy,
        createdAt,
      });
    }
  }

  if (input.action === "set_outcome") {
    const outcome: EngineerWorkflowOutcome = {
      status: input.payload.status,
      note: input.payload.note.trim(),
      createdBy,
      createdAt,
    };
    workflow.outcome = outcome;
    addReviewItem(workflow, {
      type: "Outcome",
      title: outcome.status,
      detail: outcome.note || `${outcome.status} outcome set by engineer.`,
      createdBy,
      createdAt,
    });
  }

  saveStore();
  return clone(workflow);
}

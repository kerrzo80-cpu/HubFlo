import { randomUUID } from "node:crypto";

import { getEngineerScheduleItem, type EngineerAttachment, type EngineerRequirement } from "@/lib/engineer-data";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

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
  supplier: string;
  note: string;
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
};

export type EngineerWorkflowReviewItem = {
  id: string;
  type: "Note" | "Photo" | "Report" | "PO request" | "Checklist" | "Outcome" | "Time";
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

export type EngineerJobWorkflow = {
  scheduleId: string;
  requirements: EngineerRequirement[];
  photos: EngineerAttachment[];
  notes: EngineerWorkflowNote[];
  reports: EngineerWorkflowReport[];
  poRequests: EngineerWorkflowPoRequest[];
  timeEntries: EngineerWorkflowTimeEntry[];
  officeReview: EngineerWorkflowReviewItem[];
  outcome?: EngineerWorkflowOutcome;
};

type EngineerWorkflowStore = {
  jobs: Record<string, EngineerJobWorkflow>;
};

type EngineerWorkflowAction =
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

export function getEngineerJobWorkflow(scheduleId: string) {
  return clone(getMutableWorkflow(scheduleId));
}

export function applyEngineerWorkflowAction(scheduleId: string, input: EngineerWorkflowAction) {
  const workflow = getMutableWorkflow(scheduleId);
  const createdAt = nowLabel();
  const createdBy = input.payload.createdBy?.trim() || "Engineer";

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
    const request: EngineerWorkflowPoRequest = {
      id: makeId("engineer-po"),
      supplier,
      note,
      createdBy,
      createdAt,
      status: "Office review",
    };
    workflow.poRequests = [request, ...workflow.poRequests];
    addReviewItem(workflow, {
      type: "PO request",
      title: supplier,
      detail: note || "Engineer requested supplier / PO support.",
      createdBy,
      createdAt,
    });
  }

  if (input.action === "add_time_entry") {
    const entry: EngineerWorkflowTimeEntry = {
      id: makeId("engineer-time"),
      start: input.payload.start,
      end: input.payload.end,
      breakMinutes: Math.max(0, Number(input.payload.breakMinutes ?? 0) || 0),
      note: input.payload.note?.trim() ?? "",
      createdBy,
      createdAt,
      status: "Sent to office",
    };
    workflow.timeEntries = [entry, ...workflow.timeEntries];
    addReviewItem(workflow, {
      type: "Time",
      title: `${entry.start}-${entry.end}`,
      detail: entry.note || "Engineer time confirmation sent for office review.",
      createdBy,
      createdAt,
    });
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

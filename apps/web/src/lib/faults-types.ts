/** Faults & Improvements — product development backlog types. */

export const FAULT_MODULES = [
  "Core",
  "Field",
  "Survey",
  "TakeOff",
  "Estimator",
  "Heat Designer",
  "Engineer",
  "Trainer / Blake",
  "Setup / Admin",
  "Integrations",
  "Mobile",
  "Other",
] as const;

export type FaultModule = (typeof FAULT_MODULES)[number] | string;

export const FAULT_TYPES = ["fault", "improvement", "new_feature", "ui_ux"] as const;
export type FaultType = (typeof FAULT_TYPES)[number];

export const FAULT_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type FaultPriority = (typeof FAULT_PRIORITIES)[number];

export const FAULT_STATUSES = [
  "inbox",
  "idea",
  "approved",
  "ready_for_development",
  "in_progress",
  "ready_to_test",
  "complete",
  "rejected",
] as const;
export type FaultStatus = (typeof FAULT_STATUSES)[number];

export type FaultVisibility = "internal" | "customer_feedback";

export type FaultActivityKind =
  | "created"
  | "updated"
  | "status_changed"
  | "priority_changed"
  | "assigned"
  | "comment"
  | "note"
  | "attachment"
  | "test_pass"
  | "test_fail"
  | "promoted";

export type FaultActivity = {
  id: string;
  at: string;
  actorId?: string;
  actorName: string;
  kind: FaultActivityKind;
  summary: string;
  detail?: string;
  from?: string;
  to?: string;
};

export type FaultComment = {
  id: string;
  at: string;
  actorId?: string;
  actorName: string;
  body: string;
  kind: "comment" | "development" | "testing";
};

export type FaultIssue = {
  id: string;
  /** Permanent reference, e.g. NX-001 — never reused. */
  reference: string;
  title: string;
  /** Raw user wording — never discarded by AI rewrite. */
  originalDescription: string;
  /** Optional cleaned / structured description. */
  aiDescription?: string;
  module: FaultModule;
  type: FaultType;
  priority: FaultPriority;
  status: FaultStatus;
  reporterId?: string;
  reporterName: string;
  assignedToId?: string;
  assignedToName?: string;
  developmentNotes?: string;
  testingNotes?: string;
  sourcePage?: string;
  sourceRoute?: string;
  sourceCompanyId?: string;
  sourceCompanyName?: string;
  visibility: FaultVisibility;
  promotedFromRequestIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  comments: FaultComment[];
  activity: FaultActivity[];
};

export type FaultsStore = {
  version: 1;
  nextNumber: number;
  modules: string[];
  issues: FaultIssue[];
};

export const FAULT_TYPE_LABELS: Record<FaultType, string> = {
  fault: "Fault",
  improvement: "Improvement",
  new_feature: "New Feature",
  ui_ux: "UI / UX",
};

export const FAULT_PRIORITY_LABELS: Record<FaultPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const FAULT_STATUS_LABELS: Record<FaultStatus, string> = {
  inbox: "Inbox",
  idea: "Idea",
  approved: "Approved",
  ready_for_development: "Ready for Development",
  in_progress: "In Progress",
  ready_to_test: "Ready to Test",
  complete: "Complete",
  rejected: "Rejected / Closed",
};

export function formatFaultReference(n: number) {
  return `NX-${String(Math.max(1, Math.floor(n))).padStart(3, "0")}`;
}

export function isFaultType(value: unknown): value is FaultType {
  return typeof value === "string" && (FAULT_TYPES as readonly string[]).includes(value);
}

export function isFaultPriority(value: unknown): value is FaultPriority {
  return typeof value === "string" && (FAULT_PRIORITIES as readonly string[]).includes(value);
}

export function isFaultStatus(value: unknown): value is FaultStatus {
  return typeof value === "string" && (FAULT_STATUSES as readonly string[]).includes(value);
}

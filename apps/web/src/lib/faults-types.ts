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

/** Customer-facing status — never expose internal triage language. */
export const CUSTOMER_FEEDBACK_STATUSES = [
  "submitted",
  "under_review",
  "planned",
  "in_development",
  "completed",
] as const;
export type CustomerFeedbackStatus = (typeof CUSTOMER_FEEDBACK_STATUSES)[number];

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
  | "promoted"
  | "brief_generated"
  | "sent_to_development"
  | "github_synced";

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

export type FaultTestResult = {
  id: string;
  at: string;
  result: "pass" | "fail";
  testedById?: string;
  testedByName: string;
  note?: string;
  buildVersion?: string;
};

export type FaultDevelopmentBrief = {
  generatedAt: string;
  generatedBy: string;
  issueSummary: string;
  currentBehaviour: string;
  requiredBehaviour: string;
  stepsToReproduce: string;
  affectedModule: string;
  acceptanceCriteria: string[];
  attachmentsNote: string;
  technicalContext: string;
  editableMarkdown: string;
  approved?: boolean;
};

export type FaultGithubLink = {
  issueNumber?: number;
  issueUrl?: string;
  syncedAt?: string;
  lastError?: string;
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
  customerStatus?: CustomerFeedbackStatus;
  promotedFromRequestIds: string[];
  linkedRequestIds: string[];
  developmentBrief?: FaultDevelopmentBrief;
  testHistory: FaultTestResult[];
  testedByName?: string;
  testedAt?: string;
  buildVersion?: string;
  github?: FaultGithubLink;
  developmentTaskMarkdown?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  comments: FaultComment[];
  activity: FaultActivity[];
};

/** Company/tenant feedback that may later promote into an NX item. */
export type CustomerFeedbackRequest = {
  id: string;
  companyId?: string;
  companyName: string;
  title: string;
  description: string;
  module?: FaultModule;
  type?: FaultType;
  reporterId?: string;
  reporterName: string;
  customerStatus: CustomerFeedbackStatus;
  linkedIssueId?: string;
  linkedIssueReference?: string;
  sourcePage?: string;
  sourceRoute?: string;
  createdAt: string;
  updatedAt: string;
};

export type FaultsStore = {
  version: 2;
  nextNumber: number;
  modules: string[];
  issues: FaultIssue[];
  customerRequests: CustomerFeedbackRequest[];
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

export const CUSTOMER_FEEDBACK_STATUS_LABELS: Record<CustomerFeedbackStatus, string> = {
  submitted: "Submitted",
  under_review: "Under Review",
  planned: "Planned",
  in_development: "In Development",
  completed: "Completed",
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

export function customerStatusForInternal(status: FaultStatus): CustomerFeedbackStatus {
  if (status === "complete") return "completed";
  if (status === "in_progress" || status === "ready_to_test") return "in_development";
  if (status === "approved" || status === "ready_for_development") return "planned";
  if (status === "rejected") return "under_review";
  return "under_review";
}

export function guessModuleFromRoute(route?: string, page?: string): FaultModule {
  const hay = `${route || ""} ${page || ""}`.toLowerCase();
  if (hay.includes("takeoff") || hay.includes("take-off")) return "TakeOff";
  if (hay.includes("heat")) return "Heat Designer";
  if (hay.includes("survey") || hay.includes("estimator") || hay.includes("estimate")) return "Survey";
  if (hay.includes("field")) return "Field";
  if (hay.includes("train") || hay.includes("blake")) return "Trainer / Blake";
  if (hay.includes("setup") || hay.includes("settings")) return "Setup / Admin";
  if (hay.includes("engineer")) return "Engineer";
  if (hay.includes("xero") || hay.includes("simpro") || hay.includes("sumup")) return "Integrations";
  if (hay.includes("mobile")) return "Mobile";
  if (hay.includes("fault")) return "Core";
  return "Core";
}

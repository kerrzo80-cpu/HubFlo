import { randomUUID } from "node:crypto";

import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  FAULT_MODULES,
  FAULT_PRIORITY_LABELS,
  FAULT_STATUS_LABELS,
  FAULT_TYPE_LABELS,
  customerStatusForInternal,
  formatFaultReference,
  isFaultPriority,
  isFaultStatus,
  isFaultType,
  type CustomerFeedbackRequest,
  type CustomerFeedbackStatus,
  type FaultActivity,
  type FaultComment,
  type FaultDevelopmentBrief,
  type FaultGithubLink,
  type FaultIssue,
  type FaultModule,
  type FaultPriority,
  type FaultStatus,
  type FaultTestResult,
  type FaultType,
  type FaultsStore,
  type FaultVisibility,
} from "@/lib/faults-types";

export const FAULTS_STORE_NAME = "nexa-faults-v1";

const defaultStore = (): FaultsStore => ({
  version: 2,
  nextNumber: 1,
  modules: [...FAULT_MODULES],
  issues: [],
  customerRequests: [],
});

function normalizeIssue(raw: FaultIssue): FaultIssue {
  return {
    ...raw,
    promotedFromRequestIds: Array.isArray(raw.promotedFromRequestIds) ? raw.promotedFromRequestIds : [],
    linkedRequestIds: Array.isArray(raw.linkedRequestIds) ? raw.linkedRequestIds : [],
    testHistory: Array.isArray(raw.testHistory) ? raw.testHistory : [],
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    activity: Array.isArray(raw.activity) ? raw.activity : [],
  };
}

function readStore(): FaultsStore {
  const loaded = loadServerStore<FaultsStore>(FAULTS_STORE_NAME, defaultStore());
  if (!loaded || typeof loaded !== "object") return defaultStore();
  return {
    version: 2,
    nextNumber: Math.max(1, Number(loaded.nextNumber) || 1),
    modules: Array.isArray(loaded.modules) && loaded.modules.length ? loaded.modules.map(String) : [...FAULT_MODULES],
    issues: Array.isArray(loaded.issues) ? loaded.issues.map((issue) => normalizeIssue(issue as FaultIssue)) : [],
    customerRequests: Array.isArray(loaded.customerRequests) ? loaded.customerRequests : [],
  };
}

function persist(store: FaultsStore) {
  writeServerStore(FAULTS_STORE_NAME, store);
}

function nowIso() {
  return new Date().toISOString();
}

function activity(
  actorName: string,
  kind: FaultActivity["kind"],
  summary: string,
  extra?: Partial<FaultActivity>,
): FaultActivity {
  return {
    id: `act-${randomUUID()}`,
    at: nowIso(),
    actorName,
    kind,
    summary,
    ...extra,
  };
}

export function listFaultModules() {
  return readStore().modules;
}

export function listFaultIssues(options?: { visibility?: FaultVisibility; companyId?: string }) {
  let issues = [...readStore().issues].map(normalizeIssue).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (options?.visibility) issues = issues.filter((issue) => issue.visibility === options.visibility);
  if (options?.companyId) {
    issues = issues.filter(
      (issue) => issue.sourceCompanyId === options.companyId || issue.visibility === "customer_feedback",
    );
  }
  return issues;
}

export function listCustomerFeedbackRequests(companyId?: string) {
  const rows = [...readStore().customerRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!companyId) return rows;
  return rows.filter((row) => row.companyId === companyId);
}

export function getFaultIssue(idOrRef: string) {
  const key = idOrRef.trim();
  const found =
    readStore().issues.find((issue) => issue.id === key || issue.reference.toLowerCase() === key.toLowerCase()) ?? null;
  return found ? normalizeIssue(found) : null;
}

export function createFaultIssue(input: {
  title?: string;
  description: string;
  module?: FaultModule;
  type?: FaultType;
  priority?: FaultPriority;
  status?: FaultStatus;
  reporterId?: string;
  reporterName: string;
  assignedToId?: string;
  assignedToName?: string;
  sourcePage?: string;
  sourceRoute?: string;
  sourceCompanyId?: string;
  sourceCompanyName?: string;
  visibility?: FaultVisibility;
  developmentNotes?: string;
  testingNotes?: string;
  aiDescription?: string;
  customerStatus?: CustomerFeedbackStatus;
}) {
  const description = String(input.description || "").trim();
  if (!description) throw new Error("description required");

  const store = readStore();
  const reference = formatFaultReference(store.nextNumber);
  store.nextNumber += 1;

  const title =
    String(input.title || "").trim() ||
    description
      .split(/[\n.!?]/)
      .map((part) => part.trim())
      .find(Boolean)
      ?.slice(0, 100) ||
    "Untitled issue";

  const type: FaultType = isFaultType(input.type) ? input.type : "fault";
  const priority: FaultPriority = isFaultPriority(input.priority) ? input.priority : "medium";
  const status: FaultStatus = isFaultStatus(input.status) ? input.status : "inbox";
  const moduleName = String(input.module || "Other").trim() || "Other";
  if (!store.modules.includes(moduleName)) store.modules = [...store.modules, moduleName];

  const createdAt = nowIso();
  const visibility = input.visibility === "customer_feedback" ? "customer_feedback" : "internal";
  const issue: FaultIssue = {
    id: `fault-${randomUUID()}`,
    reference,
    title,
    originalDescription: description,
    aiDescription: input.aiDescription,
    module: moduleName,
    type,
    priority,
    status,
    reporterId: input.reporterId,
    reporterName: String(input.reporterName || "NeXa user").trim() || "NeXa user",
    assignedToId: input.assignedToId,
    assignedToName: input.assignedToName,
    developmentNotes: input.developmentNotes,
    testingNotes: input.testingNotes,
    sourcePage: input.sourcePage,
    sourceRoute: input.sourceRoute,
    sourceCompanyId: input.sourceCompanyId,
    sourceCompanyName: input.sourceCompanyName,
    visibility,
    customerStatus: input.customerStatus || (visibility === "customer_feedback" ? "submitted" : undefined),
    promotedFromRequestIds: [],
    linkedRequestIds: [],
    testHistory: [],
    createdAt,
    updatedAt: createdAt,
    comments: [],
    activity: [
      activity(input.reporterName || "NeXa user", "created", `${input.reporterName || "NeXa user"} created ${reference}`, {
        actorId: input.reporterId,
      }),
    ],
  };

  store.issues = [issue, ...store.issues];
  persist(store);
  return issue;
}

export function updateFaultIssue(
  id: string,
  patch: Partial<{
    title: string;
    originalDescription: string;
    aiDescription: string;
    module: FaultModule;
    type: FaultType;
    priority: FaultPriority;
    status: FaultStatus;
    assignedToId: string | null;
    assignedToName: string | null;
    developmentNotes: string;
    testingNotes: string;
    sourcePage: string;
    sourceRoute: string;
    visibility: FaultVisibility;
    customerStatus: CustomerFeedbackStatus;
    developmentBrief: FaultDevelopmentBrief;
    developmentTaskMarkdown: string;
    github: FaultGithubLink;
    buildVersion: string;
  }>,
  actor: { id?: string; name: string },
) {
  const store = readStore();
  const index = store.issues.findIndex((issue) => issue.id === id);
  const existing = index >= 0 ? store.issues[index] : undefined;
  if (!existing) throw new Error("Issue not found");

  const current = normalizeIssue(existing);
  const next: FaultIssue = { ...current };
  const events: FaultActivity[] = [];
  const actorName = actor.name || "NeXa user";

  if (typeof patch.title === "string" && patch.title.trim() && patch.title.trim() !== current.title) {
    next.title = patch.title.trim();
    events.push(activity(actorName, "updated", "Title updated", { actorId: actor.id, detail: next.title }));
  }
  if (typeof patch.originalDescription === "string" && patch.originalDescription.trim()) {
    next.originalDescription = patch.originalDescription.trim();
    events.push(activity(actorName, "updated", "Description updated", { actorId: actor.id }));
  }
  if (typeof patch.aiDescription === "string") {
    next.aiDescription = patch.aiDescription;
    events.push(activity(actorName, "updated", "Structured description updated", { actorId: actor.id }));
  }
  if (typeof patch.module === "string" && patch.module.trim() && patch.module !== current.module) {
    next.module = patch.module.trim();
    if (!store.modules.includes(next.module)) store.modules = [...store.modules, next.module];
    events.push(
      activity(actorName, "updated", `Module ${current.module} → ${next.module}`, {
        actorId: actor.id,
        from: current.module,
        to: next.module,
      }),
    );
  }
  if (isFaultType(patch.type) && patch.type !== current.type) {
    next.type = patch.type;
    events.push(
      activity(actorName, "updated", `Type ${FAULT_TYPE_LABELS[current.type]} → ${FAULT_TYPE_LABELS[next.type]}`, {
        actorId: actor.id,
        from: current.type,
        to: next.type,
      }),
    );
  }
  if (isFaultPriority(patch.priority) && patch.priority !== current.priority) {
    next.priority = patch.priority;
    events.push(
      activity(
        actorName,
        "priority_changed",
        `Priority ${FAULT_PRIORITY_LABELS[current.priority]} → ${FAULT_PRIORITY_LABELS[next.priority]}`,
        { actorId: actor.id, from: current.priority, to: next.priority },
      ),
    );
  }
  if (isFaultStatus(patch.status) && patch.status !== current.status) {
    next.status = patch.status;
    if (patch.status === "complete") next.completedAt = nowIso();
    if (current.status === "complete" && patch.status !== "complete") next.completedAt = undefined;
    if (next.visibility === "customer_feedback" || next.customerStatus) {
      next.customerStatus = customerStatusForInternal(patch.status);
    }
    events.push(
      activity(
        actorName,
        "status_changed",
        `Status ${FAULT_STATUS_LABELS[current.status]} → ${FAULT_STATUS_LABELS[next.status]}`,
        { actorId: actor.id, from: current.status, to: next.status },
      ),
    );
  }
  if (patch.assignedToId !== undefined || patch.assignedToName !== undefined) {
    next.assignedToId = patch.assignedToId === null ? undefined : patch.assignedToId ?? next.assignedToId;
    next.assignedToName = patch.assignedToName === null ? undefined : patch.assignedToName ?? next.assignedToName;
    events.push(
      activity(actorName, "assigned", next.assignedToName ? `Assigned to ${next.assignedToName}` : "Assignment cleared", {
        actorId: actor.id,
        to: next.assignedToName,
      }),
    );
  }
  if (typeof patch.developmentNotes === "string") {
    next.developmentNotes = patch.developmentNotes;
    events.push(activity(actorName, "note", "Development notes updated", { actorId: actor.id }));
  }
  if (typeof patch.testingNotes === "string") {
    next.testingNotes = patch.testingNotes;
    events.push(activity(actorName, "note", "Testing notes updated", { actorId: actor.id }));
  }
  if (typeof patch.sourcePage === "string") next.sourcePage = patch.sourcePage;
  if (typeof patch.sourceRoute === "string") next.sourceRoute = patch.sourceRoute;
  if (patch.visibility === "internal" || patch.visibility === "customer_feedback") next.visibility = patch.visibility;
  if (patch.customerStatus) next.customerStatus = patch.customerStatus;
  if (patch.developmentBrief) {
    next.developmentBrief = patch.developmentBrief;
    events.push(activity(actorName, "brief_generated", "Development brief updated", { actorId: actor.id }));
  }
  if (typeof patch.developmentTaskMarkdown === "string") {
    next.developmentTaskMarkdown = patch.developmentTaskMarkdown;
    events.push(activity(actorName, "sent_to_development", "Development task package prepared", { actorId: actor.id }));
  }
  if (patch.github) {
    next.github = { ...next.github, ...patch.github };
    if (patch.github.issueUrl) {
      events.push(
        activity(actorName, "github_synced", `Synced to GitHub${patch.github.issueNumber ? ` #${patch.github.issueNumber}` : ""}`, {
          actorId: actor.id,
          detail: patch.github.issueUrl,
        }),
      );
    }
  }
  if (typeof patch.buildVersion === "string") next.buildVersion = patch.buildVersion;

  next.updatedAt = nowIso();
  next.activity = [...events, ...current.activity];
  store.issues[index] = next;
  persist(store);
  return next;
}

export function addFaultComment(
  id: string,
  body: string,
  actor: { id?: string; name: string },
  kind: FaultComment["kind"] = "comment",
) {
  const text = body.trim();
  if (!text) throw new Error("comment required");
  const store = readStore();
  const index = store.issues.findIndex((issue) => issue.id === id);
  const existing = index >= 0 ? store.issues[index] : undefined;
  if (!existing) throw new Error("Issue not found");
  const current = normalizeIssue(existing);
  const comment: FaultComment = {
    id: `cmt-${randomUUID()}`,
    at: nowIso(),
    actorId: actor.id,
    actorName: actor.name || "NeXa user",
    body: text,
    kind,
  };
  const next: FaultIssue = {
    ...current,
    updatedAt: nowIso(),
    comments: [comment, ...current.comments],
    activity: [
      activity(actor.name || "NeXa user", "comment", `${actor.name || "NeXa user"} added a ${kind} note`, {
        actorId: actor.id,
        detail: text.slice(0, 240),
      }),
      ...current.activity,
    ],
  };
  store.issues[index] = next;
  persist(store);
  return next;
}

export function recordFaultTestResult(
  id: string,
  input: {
    result: "pass" | "fail";
    note?: string;
    buildVersion?: string;
  },
  actor: { id?: string; name: string },
) {
  const store = readStore();
  const index = store.issues.findIndex((issue) => issue.id === id);
  const existing = index >= 0 ? store.issues[index] : undefined;
  if (!existing) throw new Error("Issue not found");
  const current = normalizeIssue(existing);
  if (input.result === "fail" && !String(input.note || "").trim()) {
    throw new Error("FAIL requires a note explaining what failed");
  }

  const entry: FaultTestResult = {
    id: `test-${randomUUID()}`,
    at: nowIso(),
    result: input.result,
    testedById: actor.id,
    testedByName: actor.name || "NeXa user",
    note: input.note?.trim() || undefined,
    buildVersion: input.buildVersion?.trim() || current.buildVersion,
  };

  const nextStatus: FaultStatus = input.result === "pass" ? "complete" : "in_progress";
  const next: FaultIssue = {
    ...current,
    status: nextStatus,
    testedByName: entry.testedByName,
    testedAt: entry.at,
    buildVersion: entry.buildVersion,
    completedAt: input.result === "pass" ? entry.at : undefined,
    testingNotes:
      input.result === "fail"
        ? [current.testingNotes, `FAIL: ${entry.note}`].filter(Boolean).join("\n\n")
        : current.testingNotes,
    customerStatus:
      current.visibility === "customer_feedback" || current.customerStatus
        ? customerStatusForInternal(nextStatus)
        : current.customerStatus,
    testHistory: [entry, ...current.testHistory],
    updatedAt: entry.at,
    activity: [
      activity(
        actor.name || "NeXa user",
        input.result === "pass" ? "test_pass" : "test_fail",
        input.result === "pass"
          ? `${actor.name || "NeXa user"}: PASS — moved to Complete`
          : `${actor.name || "NeXa user"}: FAIL — returned to In Progress`,
        { actorId: actor.id, detail: entry.note, to: nextStatus },
      ),
      ...current.activity,
    ],
  };
  store.issues[index] = next;
  persist(store);
  return next;
}

export function createCustomerFeedbackRequest(input: {
  companyId?: string;
  companyName: string;
  title?: string;
  description: string;
  module?: FaultModule;
  type?: FaultType;
  reporterId?: string;
  reporterName: string;
  sourcePage?: string;
  sourceRoute?: string;
}) {
  const description = String(input.description || "").trim();
  if (!description) throw new Error("description required");
  const store = readStore();
  const createdAt = nowIso();
  const request: CustomerFeedbackRequest = {
    id: `fb-${randomUUID()}`,
    companyId: input.companyId,
    companyName: String(input.companyName || "Company").trim() || "Company",
    title:
      String(input.title || "").trim() ||
      description.split(/[\n.!?]/).map((part) => part.trim()).find(Boolean)?.slice(0, 100) ||
      "Customer feedback",
    description,
    module: input.module,
    type: isFaultType(input.type) ? input.type : "improvement",
    reporterId: input.reporterId,
    reporterName: input.reporterName || "Customer",
    customerStatus: "submitted",
    sourcePage: input.sourcePage,
    sourceRoute: input.sourceRoute,
    createdAt,
    updatedAt: createdAt,
  };
  store.customerRequests = [request, ...store.customerRequests];
  persist(store);
  return request;
}

export function promoteCustomerFeedbackToIssue(
  requestId: string,
  actor: { id?: string; name: string },
  options?: { linkToIssueId?: string },
) {
  const store = readStore();
  const requestIndex = store.customerRequests.findIndex((row) => row.id === requestId);
  const request = requestIndex >= 0 ? store.customerRequests[requestIndex] : undefined;
  if (!request) throw new Error("Customer request not found");

  if (options?.linkToIssueId) {
    const issueIndex = store.issues.findIndex((issue) => issue.id === options.linkToIssueId);
    const existingIssue = issueIndex >= 0 ? store.issues[issueIndex] : undefined;
    if (!existingIssue) throw new Error("Issue not found");
    const issue = normalizeIssue(existingIssue);
    const nextIssue: FaultIssue = {
      ...issue,
      linkedRequestIds: Array.from(new Set([...issue.linkedRequestIds, request.id])),
      promotedFromRequestIds: Array.from(new Set([...issue.promotedFromRequestIds, request.id])),
      updatedAt: nowIso(),
      activity: [
        activity(actor.name, "promoted", `Linked customer request from ${request.companyName}`, {
          actorId: actor.id,
          detail: request.title,
        }),
        ...issue.activity,
      ],
    };
    store.issues[issueIndex] = nextIssue;
    const linkedRequest: CustomerFeedbackRequest = {
      ...request,
      linkedIssueId: nextIssue.id,
      linkedIssueReference: nextIssue.reference,
      customerStatus: "planned",
      updatedAt: nowIso(),
    };
    store.customerRequests[requestIndex] = linkedRequest;
    persist(store);
    return { issue: nextIssue, request: linkedRequest };
  }

  const issue = createFaultIssue({
    title: request.title,
    description: request.description,
    module: request.module || "Other",
    type: request.type || "improvement",
    priority: "medium",
    status: "inbox",
    reporterId: request.reporterId,
    reporterName: request.reporterName,
    sourcePage: request.sourcePage,
    sourceRoute: request.sourceRoute,
    sourceCompanyId: request.companyId,
    sourceCompanyName: request.companyName,
    visibility: "internal",
  });

  // createFaultIssue persisted a new store — re-read and patch links
  const refreshed = readStore();
  const issueIndex = refreshed.issues.findIndex((row) => row.id === issue.id);
  const reqIndex = refreshed.customerRequests.findIndex((row) => row.id === requestId);
  const linkedIssueRaw = issueIndex >= 0 ? refreshed.issues[issueIndex] : undefined;
  if (linkedIssueRaw) {
    const linked = normalizeIssue(linkedIssueRaw);
    refreshed.issues[issueIndex] = {
      ...linked,
      promotedFromRequestIds: [request.id],
      linkedRequestIds: [request.id],
      activity: [
        activity(actor.name, "promoted", `Promoted from ${request.companyName} feedback`, {
          actorId: actor.id,
          detail: request.id,
        }),
        ...linked.activity,
      ],
    };
  }
  const existingRequest = reqIndex >= 0 ? refreshed.customerRequests[reqIndex] : undefined;
  let finalRequest: CustomerFeedbackRequest = request;
  if (existingRequest) {
    finalRequest = {
      ...existingRequest,
      linkedIssueId: issue.id,
      linkedIssueReference: issue.reference,
      customerStatus: "planned",
      updatedAt: nowIso(),
    };
    refreshed.customerRequests[reqIndex] = finalRequest;
  }
  persist(refreshed);
  const finalIssueRaw = issueIndex >= 0 ? refreshed.issues[issueIndex] : undefined;
  return {
    issue: finalIssueRaw ? normalizeIssue(finalIssueRaw) : issue,
    request: finalRequest,
  };
}

export function deleteFaultIssue(id: string, actor: { id?: string; name: string }) {
  const store = readStore();
  const existing = store.issues.find((issue) => issue.id === id);
  if (!existing) throw new Error("Issue not found");
  store.issues = store.issues.filter((issue) => issue.id !== id);
  persist(store);
  return { ok: true as const, reference: existing.reference, deletedBy: actor.name };
}

export function buildDevelopmentTaskMarkdown(issue: FaultIssue) {
  const brief = issue.developmentBrief;
  const criteria = brief?.acceptanceCriteria?.length
    ? brief.acceptanceCriteria.map((item) => `- [ ] ${item}`).join("\n")
    : "- [ ] Reproduce the reported behaviour\n- [ ] Implement required behaviour\n- [ ] Verify on desktop and mobile";
  return [
    `# ${issue.reference} — ${issue.title}`,
    "",
    `**Module:** ${issue.module}`,
    `**Type:** ${FAULT_TYPE_LABELS[issue.type]}`,
    `**Priority:** ${FAULT_PRIORITY_LABELS[issue.priority]}`,
    `**Status:** ${FAULT_STATUS_LABELS[issue.status]}`,
    `**Reporter:** ${issue.reporterName}`,
    issue.assignedToName ? `**Assigned:** ${issue.assignedToName}` : "",
    "",
    "## Issue",
    brief?.issueSummary || issue.aiDescription || issue.title,
    "",
    "## Original report",
    issue.originalDescription,
    "",
    "## Current behaviour",
    brief?.currentBehaviour || "_To be confirmed_",
    "",
    "## Required behaviour",
    brief?.requiredBehaviour || "_To be confirmed_",
    "",
    "## Steps to reproduce",
    brief?.stepsToReproduce || issue.sourceRoute || "_Not provided_",
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "## Technical context",
    brief?.technicalContext || `Source route: ${issue.sourceRoute || "n/a"} · Page: ${issue.sourcePage || "n/a"}`,
    "",
    "## Attachments",
    brief?.attachmentsNote || `Use record-documents scope fault / ${issue.reference}`,
    "",
    "## Development notes",
    issue.developmentNotes || "_None yet_",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function faultDashboardStats(issues = listFaultIssues()) {
  const openStatuses = new Set<FaultStatus>([
    "inbox",
    "idea",
    "approved",
    "ready_for_development",
    "in_progress",
    "ready_to_test",
  ]);
  const openFaults = issues.filter((issue) => issue.type === "fault" && openStatuses.has(issue.status));
  const urgent = issues.filter((issue) => issue.priority === "urgent" && openStatuses.has(issue.status));
  const inDevelopment = issues.filter((issue) => issue.status === "in_progress");
  const waitingTest = issues.filter((issue) => issue.status === "ready_to_test");
  const completed = issues.filter((issue) => issue.status === "complete").slice(0, 12);
  const byModule: Record<string, number> = {};
  for (const issue of issues.filter((row) => openStatuses.has(row.status))) {
    byModule[issue.module] = (byModule[issue.module] || 0) + 1;
  }
  return {
    openFaults: openFaults.length,
    urgentFaults: urgent.length,
    inDevelopment: inDevelopment.length,
    waitingForTesting: waitingTest.length,
    completedRecent: completed,
    openByModule: byModule,
    customerFeedbackOpen: listCustomerFeedbackRequests().filter((row) => row.customerStatus !== "completed").length,
  };
}

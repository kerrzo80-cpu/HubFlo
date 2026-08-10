import { randomUUID } from "node:crypto";

import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  FAULT_MODULES,
  FAULT_PRIORITY_LABELS,
  FAULT_STATUS_LABELS,
  FAULT_TYPE_LABELS,
  formatFaultReference,
  isFaultPriority,
  isFaultStatus,
  isFaultType,
  type FaultActivity,
  type FaultComment,
  type FaultIssue,
  type FaultModule,
  type FaultPriority,
  type FaultStatus,
  type FaultType,
  type FaultsStore,
  type FaultVisibility,
} from "@/lib/faults-types";

export const FAULTS_STORE_NAME = "nexa-faults-v1";

const defaultStore = (): FaultsStore => ({
  version: 1,
  nextNumber: 1,
  modules: [...FAULT_MODULES],
  issues: [],
});

function readStore(): FaultsStore {
  const loaded = loadServerStore<FaultsStore>(FAULTS_STORE_NAME, defaultStore());
  if (!loaded || typeof loaded !== "object") return defaultStore();
  return {
    version: 1,
    nextNumber: Math.max(1, Number(loaded.nextNumber) || 1),
    modules: Array.isArray(loaded.modules) && loaded.modules.length ? loaded.modules.map(String) : [...FAULT_MODULES],
    issues: Array.isArray(loaded.issues) ? loaded.issues : [],
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

export function listFaultIssues() {
  return [...readStore().issues].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getFaultIssue(idOrRef: string) {
  const key = idOrRef.trim();
  return (
    readStore().issues.find((issue) => issue.id === key || issue.reference.toLowerCase() === key.toLowerCase()) ?? null
  );
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
  if (!store.modules.includes(moduleName)) {
    store.modules = [...store.modules, moduleName];
  }

  const createdAt = nowIso();
  const issue: FaultIssue = {
    id: `fault-${randomUUID()}`,
    reference,
    title,
    originalDescription: description,
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
    visibility: input.visibility === "customer_feedback" ? "customer_feedback" : "internal",
    promotedFromRequestIds: [],
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
  }>,
  actor: { id?: string; name: string },
) {
  const store = readStore();
  const index = store.issues.findIndex((issue) => issue.id === id);
  if (index < 0) throw new Error("Issue not found");

  const current = store.issues[index];
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
  if (patch.visibility === "internal" || patch.visibility === "customer_feedback") {
    next.visibility = patch.visibility;
  }

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
  if (index < 0) throw new Error("Issue not found");
  const current = store.issues[index];
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

export function deleteFaultIssue(id: string, actor: { id?: string; name: string }) {
  const store = readStore();
  const existing = store.issues.find((issue) => issue.id === id);
  if (!existing) throw new Error("Issue not found");
  store.issues = store.issues.filter((issue) => issue.id !== id);
  persist(store);
  return { ok: true as const, reference: existing.reference, deletedBy: actor.name };
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
  };
}

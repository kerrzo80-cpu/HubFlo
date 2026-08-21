import { randomUUID } from "node:crypto";

import { appendAuditEvent } from "@/lib/people-data";
import { readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
import { getJobs, type Job } from "@/lib/workflow-data";

export const jobNoteTypes = [
  "General",
  "Customer request",
  "Site issue",
  "Supplier",
  "Follow-up",
  "Variation",
] as const;
export type JobNoteType = (typeof jobNoteTypes)[number];

export const jobUpdatePriorities = ["Low", "Medium", "High"] as const;
export type JobUpdatePriority = (typeof jobUpdatePriorities)[number];

export type JobOfficeNote = {
  id: string;
  tenantId: string;
  jobId: string;
  jobRef: string;
  customer: string;
  site: string;
  text: string;
  noteType: JobNoteType;
  priority: JobUpdatePriority;
  followUpRequired: boolean;
  attentionStatus: "Open" | "Resolved" | "None";
  createdBy: string;
  source: "Blake" | "Core" | "Field";
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
};

export type JobVariationDraft = {
  id: string;
  ref: string;
  tenantId: string;
  jobId: string;
  jobRef: string;
  customer: string;
  site: string;
  description: string;
  priority: JobUpdatePriority;
  estimatedValue?: number;
  officeNote?: string;
  status: "Draft" | "In review" | "Approved" | "Rejected" | "Cancelled";
  attentionStatus: "Open" | "Resolved";
  createdBy: string;
  source: "Blake" | "Core" | "Field";
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type OfficeAttentionType =
  | "PO requested"
  | "Parts needed"
  | "Variation detected"
  | "Rebook required"
  | "Could not access"
  | "Missing daily time check"
  | "Stop/go missing"
  | "Job note";

export type OfficeAttentionItem = {
  id: string;
  type: OfficeAttentionType;
  priority: JobUpdatePriority;
  engineerName: string;
  jobRef?: string;
  jobId?: string;
  customer?: string;
  address?: string;
  detail: string;
  createdAt: string;
  status: "New" | "In review" | "Approved" | "Chased";
  href?: string;
  attentionKind?: "note" | "variation";
  entityId?: string;
};

type JobOfficeUpdateStore = {
  notes: JobOfficeNote[];
  variations: JobVariationDraft[];
};

const STORE_NAME = "job-office-updates-v1";
const emptyStore: JobOfficeUpdateStore = { notes: [], variations: [] };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readStore(): JobOfficeUpdateStore {
  const snapshot = readServerStoreSnapshot(STORE_NAME) as Partial<JobOfficeUpdateStore> | null;
  return {
    notes: Array.isArray(snapshot?.notes) ? clone(snapshot.notes) : [],
    variations: Array.isArray(snapshot?.variations) ? clone(snapshot.variations) : [],
  };
}

function saveStore(store: JobOfficeUpdateStore) {
  if (!writeServerStore(STORE_NAME, store)) {
    throw new Error("NeXa could not save the job update.");
  }
}

function normal(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function requiredText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function dateLabel(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function normaliseJobNoteType(value: unknown): JobNoteType {
  const text = normal(value);
  return jobNoteTypes.find((item) => item.toLowerCase() === text) ?? "General";
}

export function normaliseJobUpdatePriority(value: unknown): JobUpdatePriority {
  const text = normal(value);
  return jobUpdatePriorities.find((item) => item.toLowerCase() === text) ?? "Medium";
}

export function resolveJobForOfficeUpdate(identifier: string): Job {
  const target = normal(identifier).replace(/\s+/g, "-");
  const jobs = getJobs();
  const exact = jobs.find((job) => normal(job.id) === normal(identifier) || normal(job.ref).replace(/\s+/g, "-") === target);
  if (exact) return exact;

  const byHumanLabel = jobs.filter((job) =>
    [job.customer, job.site, job.description].some((value) => normal(value) === normal(identifier)),
  );
  if (byHumanLabel.length === 1) return byHumanLabel[0]!;

  throw new Error(`I cannot identify a single NeXa job from “${identifier}”. Use the job reference, or let Blake search for the job first.`);
}

function nextVariationRef(variations: JobVariationDraft[]) {
  const max = variations.reduce((highest, item) => {
    const match = item.ref.match(/^V-(\d+)$/i);
    return match ? Math.max(highest, Number(match[1]) || 0) : highest;
  }, 0);
  return `V-${String(max + 1).padStart(4, "0")}`;
}

export function addJobOfficeNote(input: {
  tenantId: string;
  jobIdentifier: string;
  text: string;
  noteType?: JobNoteType | string;
  priority?: JobUpdatePriority | string;
  followUpRequired?: boolean;
  createdBy: string;
  source?: JobOfficeNote["source"];
}) {
  const job = resolveJobForOfficeUpdate(input.jobIdentifier);
  const store = readStore();
  const now = new Date().toISOString();
  const followUpRequired = input.followUpRequired !== false;
  const note: JobOfficeNote = {
    id: `job-note-${randomUUID()}`,
    tenantId: requiredText(input.tenantId, "Workspace"),
    jobId: job.id,
    jobRef: job.ref,
    customer: job.customer,
    site: job.site,
    text: requiredText(input.text, "Note"),
    noteType: normaliseJobNoteType(input.noteType),
    priority: normaliseJobUpdatePriority(input.priority),
    followUpRequired,
    attentionStatus: followUpRequired ? "Open" : "None",
    createdBy: requiredText(input.createdBy, "Created by"),
    source: input.source ?? "Core",
    createdAt: now,
  };
  store.notes.unshift(note);
  saveStore(store);
  appendAuditEvent({
    actor: note.createdBy,
    action: "added job note",
    recordType: "job",
    recordId: job.id,
    summary: `${job.ref} · ${note.noteType}: ${note.text.slice(0, 180)}${followUpRequired ? " · Attention raised" : ""}`,
    source: note.source === "Blake" ? "Blake" : "Jobs",
    importance: note.priority === "High" ? "high" : "normal",
  });
  return clone(note);
}

export function createJobVariationDraft(input: {
  tenantId: string;
  jobIdentifier: string;
  description: string;
  priority?: JobUpdatePriority | string;
  estimatedValue?: number;
  officeNote?: string;
  createdBy: string;
  source?: JobVariationDraft["source"];
}) {
  const job = resolveJobForOfficeUpdate(input.jobIdentifier);
  const store = readStore();
  const estimatedValue = input.estimatedValue;
  if (estimatedValue !== undefined && (!Number.isFinite(estimatedValue) || estimatedValue < 0)) {
    throw new TypeError("Estimated variation value must be zero or a positive number.");
  }
  const variation: JobVariationDraft = {
    id: `job-variation-${randomUUID()}`,
    ref: nextVariationRef(store.variations),
    tenantId: requiredText(input.tenantId, "Workspace"),
    jobId: job.id,
    jobRef: job.ref,
    customer: job.customer,
    site: job.site,
    description: requiredText(input.description, "Variation description"),
    priority: normaliseJobUpdatePriority(input.priority),
    estimatedValue,
    officeNote: typeof input.officeNote === "string" && input.officeNote.trim() ? input.officeNote.trim() : undefined,
    status: "Draft",
    attentionStatus: "Open",
    createdBy: requiredText(input.createdBy, "Created by"),
    source: input.source ?? "Core",
    createdAt: new Date().toISOString(),
  };
  store.variations.unshift(variation);
  saveStore(store);
  appendAuditEvent({
    actor: variation.createdBy,
    action: "created draft job variation",
    recordType: "job",
    recordId: job.id,
    summary: `${variation.ref} on ${job.ref}: ${variation.description.slice(0, 180)} · Attention raised for office review`,
    source: variation.source === "Blake" ? "Blake" : "Jobs",
    importance: variation.priority === "High" ? "high" : "normal",
  });
  return clone(variation);
}

export function getJobOfficeUpdates(tenantId: string, jobIdentifier: string) {
  const job = resolveJobForOfficeUpdate(jobIdentifier);
  const store = readStore();
  return {
    job: clone(job),
    notes: store.notes.filter((item) => item.tenantId === tenantId && item.jobId === job.id),
    variations: store.variations.filter((item) => item.tenantId === tenantId && item.jobId === job.id),
  };
}

export function resolveJobAttention(input: {
  tenantId: string;
  kind: "note" | "variation";
  id: string;
  actor: string;
}) {
  const store = readStore();
  const now = new Date().toISOString();

  if (input.kind === "note") {
    const note = store.notes.find((item) => item.id === input.id && item.tenantId === input.tenantId);
    if (!note) throw new Error("That job note could not be found in this NeXa workspace.");
    note.attentionStatus = note.followUpRequired ? "Resolved" : "None";
    note.resolvedBy = input.actor;
    note.resolvedAt = now;
    saveStore(store);
    appendAuditEvent({
      actor: input.actor,
      action: "resolved job note attention",
      recordType: "job",
      recordId: note.jobId,
      summary: `${note.jobRef} · ${note.noteType} marked dealt with`,
      source: "Jobs",
      importance: "normal",
    });
    return clone(note);
  }

  const variation = store.variations.find((item) => item.id === input.id && item.tenantId === input.tenantId);
  if (!variation) throw new Error("That draft variation could not be found in this NeXa workspace.");
  variation.attentionStatus = "Resolved";
  if (variation.status === "Draft") variation.status = "In review";
  variation.reviewedBy = input.actor;
  variation.reviewedAt = now;
  saveStore(store);
  appendAuditEvent({
    actor: input.actor,
    action: "reviewed draft job variation",
    recordType: "job",
    recordId: variation.jobId,
    summary: `${variation.ref} on ${variation.jobRef} moved into office review`,
    source: "Jobs",
    importance: "normal",
  });
  return clone(variation);
}

export function getJobAttentionAlerts(tenantId: string): OfficeAttentionItem[] {
  const store = readStore();
  const noteAlerts: OfficeAttentionItem[] = store.notes
    .filter((item) => item.tenantId === tenantId && item.attentionStatus === "Open")
    .map((item) => ({
      id: `attention-${item.id}`,
      type: "Job note",
      priority: item.priority,
      engineerName: item.createdBy,
      jobRef: item.jobRef,
      jobId: item.jobId,
      customer: item.customer,
      address: item.site,
      detail: `${item.noteType}: ${item.text}`,
      createdAt: dateLabel(item.createdAt),
      status: "New",
      href: `/jobs/${encodeURIComponent(item.jobId)}/updates`,
      attentionKind: "note",
      entityId: item.id,
    }));

  const variationAlerts: OfficeAttentionItem[] = store.variations
    .filter((item) => item.tenantId === tenantId && item.attentionStatus === "Open")
    .map((item) => ({
      id: `attention-${item.id}`,
      type: "Variation detected",
      priority: item.priority,
      engineerName: item.createdBy,
      jobRef: item.jobRef,
      jobId: item.jobId,
      customer: item.customer,
      address: item.site,
      detail: `${item.ref}: ${item.description}`,
      createdAt: dateLabel(item.createdAt),
      status: "New",
      href: `/jobs/${encodeURIComponent(item.jobId)}/updates`,
      attentionKind: "variation",
      entityId: item.id,
    }));

  return [...noteAlerts, ...variationAlerts];
}

export function resetJobOfficeUpdatesForTests() {
  writeServerStore(STORE_NAME, emptyStore);
}

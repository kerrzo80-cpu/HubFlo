import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type VariationPortalStatus = "Pending" | "Viewed" | "Approved" | "Declined";

export type VariationPortalRecord = {
  id: string;
  token: string;
  variationEventId: string;
  jobId: string;
  jobRef: string;
  summary: string;
  description: string;
  costValue: number;
  sellValue: number;
  actor: string;
  clientEmail?: string;
  requiresClientApproval?: boolean;
  status: VariationPortalStatus;
  createdAt: string;
  updatedAt: string;
  actionedAt?: string;
};

type VariationPortalStore = {
  requests: VariationPortalRecord[];
};

type VariationPortalInput = {
  variationEventId: string;
  jobId: string;
  jobRef: string;
  summary: string;
  description: string;
  costValue: number;
  sellValue: number;
  actor: string;
  clientEmail?: string;
  requiresClientApproval?: boolean;
};

const variationPortalStoreSeed: VariationPortalStore = {
  requests: [],
};

const variationPortalStore = loadServerStore("variation-portal-store", variationPortalStoreSeed);

function persistVariationPortalStore() {
  writeServerStore("variation-portal-store", variationPortalStore);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function generateToken() {
  const salt = Math.round(Math.random() * 9999).toString(16).padStart(4, "0");
  return `v-${Date.now().toString(16)}-${salt}`;
}

function mapNow() {
  return new Date().toISOString();
}

export function getVariationPortalRequestByToken(token: string) {
  return clone(variationPortalStore.requests.find((request) => request.token === token) ?? null);
}

export function getVariationPortalRequestsByJob(jobId: string) {
  return clone(variationPortalStore.requests.filter((request) => request.jobId === jobId));
}

export function getVariationPortalRequestsByVariationEvent(variationEventId: string) {
  return clone(variationPortalStore.requests.find((request) => request.variationEventId === variationEventId) ?? null);
}

export function upsertVariationPortalRequest(input: VariationPortalInput) {
  const now = mapNow();
  const existing = variationPortalStore.requests.find((request) =>
    request.variationEventId === input.variationEventId && request.jobId === input.jobId,
  );

  if (existing) {
    existing.summary = input.summary;
    existing.description = input.description;
    existing.costValue = input.costValue;
    existing.sellValue = input.sellValue;
    existing.actor = input.actor;
    existing.clientEmail = input.clientEmail;
    existing.requiresClientApproval = input.requiresClientApproval ?? existing.requiresClientApproval;
    existing.status = "Pending";
    existing.updatedAt = now;
    persistVariationPortalStore();
    return clone(existing);
  }

  const created: VariationPortalRecord = {
    id: `var-portal-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    token: generateToken(),
    variationEventId: input.variationEventId,
    jobId: input.jobId,
    jobRef: input.jobRef,
    summary: input.summary,
    description: input.description,
    costValue: input.costValue,
    sellValue: input.sellValue,
    actor: input.actor,
    clientEmail: input.clientEmail,
    requiresClientApproval: input.requiresClientApproval ?? true,
    status: "Pending",
    createdAt: now,
    updatedAt: now,
  };

  variationPortalStore.requests = [created, ...variationPortalStore.requests];
  persistVariationPortalStore();
  return clone(created);
}

export function markVariationPortalRequestViewed(token: string) {
  const request = variationPortalStore.requests.find((entry) => entry.token === token);
  if (!request) return null;
  if (request.status !== "Approved" && request.status !== "Declined") {
    request.status = "Viewed";
    request.updatedAt = mapNow();
    persistVariationPortalStore();
  }
  return clone(request);
}

export function setVariationPortalResponse(
  token: string,
  status: Exclude<VariationPortalStatus, "Pending" | "Viewed">,
) {
  const request = variationPortalStore.requests.find((entry) => entry.token === token);
  if (!request) return null;

  request.status = status;
  request.updatedAt = mapNow();
  request.actionedAt = mapNow();
  persistVariationPortalStore();
  return clone(request);
}

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { getClients } from "@/lib/people-data";
import { getJobs, type Job } from "@/lib/workflow-data";

export type InboundCommsMatchInput = {
  jobId?: string;
  jobRef?: string;
  subject?: string;
  fromEmail?: string;
  fromPhone?: string;
  body?: string;
};

export type InboundCommsMatch = {
  job: Job | null;
  matchReason: string;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, "");
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function extractJobRef(text: string) {
  const match = text.match(/\b(?:JOB|J)[- ]?(\d{3,})\b/i) || text.match(/\b([A-Z]{1,4}-\d{3,})\b/);
  return match?.[0]?.trim() || "";
}

/** Exported for unit tests. */
export function extractJobRefForTest(text: string) {
  return extractJobRef(text);
}

export function matchInboundToJob(input: InboundCommsMatchInput): InboundCommsMatch {
  const jobs = getJobs();
  const clients = getClients();

  if (input.jobId?.trim()) {
    const job = jobs.find((item) => item.id === input.jobId?.trim()) ?? null;
    if (job) return { job, matchReason: "jobId" };
  }

  const explicitRef = input.jobRef?.trim() || extractJobRef(`${input.subject ?? ""} ${input.body ?? ""}`);
  if (explicitRef) {
    const needle = explicitRef.toLowerCase();
    const job = jobs.find((item) => item.ref.toLowerCase() === needle || item.ref.toLowerCase().includes(needle)) ?? null;
    if (job) return { job, matchReason: "jobRef" };
  }

  const fromEmail = normalizeEmail(input.fromEmail ?? "");
  if (fromEmail) {
    const client = clients.find((item) => normalizeEmail(item.email) === fromEmail);
    if (client) {
      const openJobs = jobs.filter((job) => job.clientId === client.id && !/complete|invoiced|cancelled/i.test(job.status));
      const job = openJobs[0] ?? jobs.find((item) => item.clientId === client.id) ?? null;
      if (job) return { job, matchReason: "clientEmail" };
    }
  }

  const fromPhone = normalizePhone(input.fromPhone ?? "");
  if (fromPhone.length >= 8) {
    const client = clients.find((item) => {
      const phone = normalizePhone(item.phone);
      return phone && (phone.endsWith(fromPhone) || fromPhone.endsWith(phone));
    });
    if (client) {
      const openJobs = jobs.filter((job) => job.clientId === client.id && !/complete|invoiced|cancelled/i.test(job.status));
      const job = openJobs[0] ?? jobs.find((item) => item.clientId === client.id) ?? null;
      if (job) return { job, matchReason: "clientPhone" };
    }
  }

  return { job: null, matchReason: "unmatched" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestamp() {
  return new Date()
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");
}

export type StoredCommunicationInput = {
  id?: string;
  recordType?: "lead" | "quote" | "job" | "invoice" | "client";
  recordId?: string;
  relatedJobId?: string;
  direction: "outbound" | "inbound";
  channel: "Outlook" | "Client portal" | "WhatsApp";
  subject: string;
  body: string;
  from: string;
  to: string;
  cc?: string;
  messageId?: string;
  status?: "Sent" | "Received" | "Captured";
  actorEmployeeId?: string;
  actorName?: string;
};

export function appendJobCommunication(input: StoredCommunicationInput) {
  const state = getHubDetailState();
  const currentItems = Array.isArray(state.communications) ? state.communications : [];
  const itemId = input.id?.trim() || input.messageId?.trim() || crypto.randomUUID();
  const existing = currentItems.find((current) => isObject(current) && (current.id === itemId || current.messageId === itemId));
  if (existing) return existing;

  const created = {
    ...input,
    id: itemId,
    recordType: input.recordType ?? (input.relatedJobId || input.recordId ? "job" : "job"),
    recordId: input.recordId ?? input.relatedJobId ?? "unmatched",
    status: input.status ?? (input.direction === "inbound" ? "Received" : "Sent"),
    createdAt: timestamp(),
  };

  saveHubDetailState({
    ...state,
    communications: [created, ...currentItems],
  });
  return created;
}

import type { AccessProfile } from "@/lib/access";
import { blakeCore } from "@/lib/blake-core";
import {
  JOB_DIRECTORY_LABELS,
  JOB_DIRECTORY_STATUSES,
  type JobDirectoryBucket,
} from "@/lib/blake-core/job-directory-capability";

export type BlakeJobDirectoryActor = {
  id: string;
  name: string;
  tenantId: string;
  channel: "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
};

type JobDirectoryHistoryMessage = { role: "assistant" | "user"; text: string };

type JobDirectoryData = {
  bucket: JobDirectoryBucket;
  label: string;
  count: number;
  scheduledCount: number;
  unscheduledCount: number;
  statuses: string[];
  rows: Array<{
    ref: string;
    customer: string;
    site: string;
    description: string;
    status: string;
    manager: string;
    value: number;
    due: string;
    next: string;
    scheduledDate?: string;
    scheduledTime?: string;
  }>;
};

export function requestedJobDirectoryBucket(message: string): JobDirectoryBucket | null {
  const lower = message.toLowerCase();
  if (!/\bjobs?\b/.test(lower)) return null;
  if (/\bready\s+to\s+invoice\b/.test(lower)) return "ready_to_invoice";
  if (/\b(invoiced|closed)\b/.test(lower)) return "invoiced";
  if (/\b(completed?|complete|sign[ -]?off)\b/.test(lower)) return "complete";
  if (/\b(pending|awaiting start|not started)\b/.test(lower)) return "pending";
  if (/\b(in progress|progress (?:folder|area)|ongoing|underway|being worked on|currently being worked)\b/.test(lower)) return "in_progress";
  if (/\b(active|open)\b/.test(lower)) return "active";
  if (/\b(all jobs|every job)\b/.test(lower)) return "all";
  return null;
}

export function looksLikeJobDirectoryQuestion(message: string) {
  const bucket = requestedJobDirectoryBucket(message);
  if (!bucket) return false;
  if (/\b(?:mark|change|update|edit|amend|set|move)\b/i.test(message)) return false;
  return /\b(list|show|give|which|what|how many|are there|there are|currently|at the moment|sitting|folder|area)\b/i.test(message);
}

export function recentJobDirectoryBucket(history: JobDirectoryHistoryMessage[]): JobDirectoryBucket | null {
  const assistantMessages = [...history].reverse().filter((item) => item.role === "assistant");
  for (const item of assistantMessages) {
    const text = item.text.toLowerCase();
    for (const [bucket, label] of Object.entries(JOB_DIRECTORY_LABELS) as Array<[JobDirectoryBucket, string]>) {
      const normalLabel = label.toLowerCase();
      if (text.includes(`nexa's ${normalLabel.toLowerCase()} area`)
        || text.includes(`nexa’s ${normalLabel.toLowerCase()} area`)
        || text.includes(`${normalLabel.toLowerCase()} area`)) {
        return bucket;
      }
    }
  }
  return null;
}

function isWriteStyleJobMessage(message: string) {
  return /\b(?:mark|change|update|edit|amend|set|move|create|add|delete|remove|book|schedule|assign)\b/i.test(message)
    && /\b(?:job|J[-\s]?\d{3,6})\b/i.test(message);
}

export function looksLikeJobDirectoryFollowUp(message: string, history: JobDirectoryHistoryMessage[]) {
  if (!recentJobDirectoryBucket(history) || isWriteStyleJobMessage(message)) return false;
  if (message.length > 300) return false;
  return /\b(?:they|them|those|these|there|that|this|it|same|ones?)\b/i.test(message)
    || /\b(?:waiting to be booked|booked in|booked|scheduled|unscheduled|what does that mean|what do they mean|why are they|are all|are any|how many of them)\b/i.test(message);
}

export function contextualiseJobDirectoryFollowUp(message: string, history: JobDirectoryHistoryMessage[]) {
  const bucket = recentJobDirectoryBucket(history);
  if (!bucket || !looksLikeJobDirectoryFollowUp(message, history)) return message;
  const label = JOB_DIRECTORY_LABELS[bucket];
  const statuses = bucket === "active" || bucket === "all" ? [] : [...JOB_DIRECTORY_STATUSES[bucket]];
  return `${message}\n\nConversation context: "they/those/these" refers to the jobs Blake just listed from NeXa's ${label} area${statuses.length ? `, which groups statuses ${statuses.join(", ")}` : ""}. Do not treat this as a fresh text search.`;
}

function wantsBookingState(message: string) {
  return /\b(?:waiting to be booked|booked in|booked|scheduled|unscheduled|need(?:s|ing)? to be booked|waiting for booking)\b/i.test(message);
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

function folderDefinition(data: JobDirectoryData) {
  if (!data.statuses.length) return "";
  return ` NeXa's ${data.label} area groups these statuses: ${data.statuses.join(", ")}.`;
}

function bookingStateReply(data: JobDirectoryData) {
  if (!data.count) return `There are no jobs in NeXa's ${data.label} area.`;
  if (data.unscheduledCount === data.count) {
    return `Yes — all ${data.count} jobs in that ${data.label} list currently have no scheduled date, so none of them are booked into the diary yet.${folderDefinition(data)}`;
  }
  if (data.unscheduledCount === 0) {
    return `No — all ${data.count} jobs in that ${data.label} list already have a scheduled date.${folderDefinition(data)}`;
  }
  return `${data.unscheduledCount} of the ${data.count} jobs in that ${data.label} list currently have no scheduled date, so they are not booked into the diary yet. ${data.scheduledCount} already have a scheduled date.${folderDefinition(data)}`;
}

async function readJobDirectory(bucket: JobDirectoryBucket, actor: BlakeJobDirectoryActor, access: AccessProfile) {
  return blakeCore.execute<JobDirectoryData>("list_jobs", { bucket, limit: 100 }, {
    actor,
    access,
  });
}

export async function handleBlakeJobDirectoryMessage(
  message: string,
  actor: BlakeJobDirectoryActor,
  access: AccessProfile,
  history: JobDirectoryHistoryMessage[] = [],
) {
  if (!access.showJobs) return null;

  const explicitBucket = looksLikeJobDirectoryQuestion(message) ? requestedJobDirectoryBucket(message) : null;
  const contextualBucket = !explicitBucket && looksLikeJobDirectoryFollowUp(message, history)
    ? recentJobDirectoryBucket(history)
    : null;
  const bucket = explicitBucket ?? contextualBucket;
  if (!bucket) return null;

  const result = await readJobDirectory(bucket, actor, access);
  if (!result.ok || !result.data) {
    return {
      reply: result.error?.message || "Blake could not read the NeXa jobs list.",
      intent: { action: "chat" as const },
      aiUsed: false,
    };
  }

  const data = result.data;
  if (contextualBucket && wantsBookingState(message)) {
    return {
      reply: bookingStateReply(data),
      intent: { action: "chat" as const },
      aiUsed: false,
    };
  }

  if (contextualBucket && /\b(?:what does that mean|what do they mean|why are they there|why are those there)\b/i.test(message)) {
    return {
      reply: `You're referring to the ${data.count} jobs in NeXa's ${data.label} area.${folderDefinition(data)} ${data.unscheduledCount} currently have no scheduled date and ${data.scheduledCount} have a scheduled date.`,
      intent: { action: "chat" as const },
      aiUsed: false,
    };
  }

  const folderRule = data.statuses.length ? ` (${data.statuses.join(", ")})` : "";
  if (!data.count) {
    return {
      reply: `There are no jobs in NeXa's ${data.label} area${folderRule}.`,
      intent: { action: "chat" as const },
      aiUsed: false,
    };
  }

  const rows = data.rows.map((job) => {
    const place = job.site ? ` · ${job.site}` : "";
    const status = job.status ? ` · ${job.status}` : "";
    const value = job.value ? ` · ${money(job.value)}` : "";
    return `• ${job.ref} · ${job.customer}${place}${status}${value}`;
  });
  const shown = data.rows.length < data.count ? `\n\nShowing ${data.rows.length} of ${data.count}.` : "";

  return {
    reply: `There are ${data.count} jobs in NeXa's ${data.label} area${folderRule}:\n\n${rows.join("\n")}${shown}`,
    intent: { action: "chat" as const },
    aiUsed: false,
  };
}

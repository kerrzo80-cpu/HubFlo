import type { AccessProfile } from "@/lib/access";
import { blakeCore } from "@/lib/blake-core";
import type { JobDirectoryBucket } from "@/lib/blake-core/job-directory-capability";

export type BlakeJobDirectoryActor = {
  id: string;
  name: string;
  tenantId: string;
  channel: "web_text" | "web_voice" | "mobile_text" | "mobile_voice";
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

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
}

export async function handleBlakeJobDirectoryMessage(
  message: string,
  actor: BlakeJobDirectoryActor,
  access: AccessProfile,
) {
  if (!access.showJobs || !looksLikeJobDirectoryQuestion(message)) return null;
  const bucket = requestedJobDirectoryBucket(message);
  if (!bucket) return null;

  const result = await blakeCore.execute<{
    bucket: JobDirectoryBucket;
    label: string;
    count: number;
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
    }>;
  }>("list_jobs", { bucket, limit: 100 }, {
    actor,
    access,
  });

  if (!result.ok || !result.data) {
    return {
      reply: result.error?.message || "Blake could not read the NeXa jobs list.",
      intent: { action: "chat" as const },
      aiUsed: false,
    };
  }

  const data = result.data;
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

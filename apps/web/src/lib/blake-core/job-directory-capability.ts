import type { BlakeCapabilityDefinition } from "@hubflo/domain";

import { getJobs, type Job } from "@/lib/workflow-data";

import type { BlakeCapability } from "./types";

export type JobDirectoryBucket =
  | "pending"
  | "in_progress"
  | "complete"
  | "ready_to_invoice"
  | "invoiced"
  | "active"
  | "all";

export const JOB_DIRECTORY_STATUSES: Record<Exclude<JobDirectoryBucket, "active" | "all">, readonly string[]> = {
  pending: ["Accepted", "Pending", "Enquiry", "Quoted"],
  in_progress: ["Scheduled", "In progress", "Waiting on parts", "Waiting on customer", "Approval required"],
  complete: ["Completed"],
  ready_to_invoice: ["Ready to invoice"],
  invoiced: ["Invoiced", "Closed"],
};

export const JOB_DIRECTORY_LABELS: Record<JobDirectoryBucket, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  complete: "Complete",
  ready_to_invoice: "Ready to invoice",
  invoiced: "Invoiced / Closed",
  active: "Active jobs",
  all: "All jobs",
};

export function jobMatchesDirectoryBucket(job: Pick<Job, "status">, bucket: JobDirectoryBucket) {
  if (bucket === "all") return true;
  if (bucket === "active") return !["Invoiced", "Closed"].includes(job.status);
  return JOB_DIRECTORY_STATUSES[bucket].includes(job.status);
}

function definition(input: Omit<BlakeCapabilityDefinition, "version">): BlakeCapabilityDefinition {
  return { ...input, version: 1 };
}

function objectInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Capability input must be an object.");
  return value as Record<string, unknown>;
}

const buckets: JobDirectoryBucket[] = ["pending", "in_progress", "complete", "ready_to_invoice", "invoiced", "active", "all"];

export const listJobsCapability: BlakeCapability<
  { bucket: JobDirectoryBucket; limit: number },
  {
    bucket: JobDirectoryBucket;
    label: string;
    count: number;
    scheduledCount: number;
    unscheduledCount: number;
    statuses: string[];
    rows: Array<{
      id: string;
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
  }
> = {
  definition: definition({
    name: "list_jobs",
    description: "List NeXa jobs using the same job-directory folders as the Jobs screen, including Pending, In Progress, Complete, Ready to invoice, Invoiced/Closed, Active jobs or All jobs.",
    mode: "read",
    risk: "low",
    requiredPermissions: ["showJobs"],
    requiresConfirmation: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        bucket: { enum: buckets },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["bucket"],
    },
  }),
  parse(input) {
    const raw = objectInput(input);
    const bucket = buckets.includes(raw.bucket as JobDirectoryBucket) ? raw.bucket as JobDirectoryBucket : "all";
    const limit = Math.max(1, Math.min(100, Number(raw.limit) || 50));
    return { bucket, limit };
  },
  execute(input) {
    const jobs = getJobs().filter((job) => jobMatchesDirectoryBucket(job, input.bucket));
    const statuses = input.bucket === "active" || input.bucket === "all"
      ? Array.from(new Set(jobs.map((job) => job.status))).sort()
      : [...JOB_DIRECTORY_STATUSES[input.bucket]];
    const scheduledCount = jobs.filter((job) => Boolean(job.scheduledDate)).length;
    return {
      bucket: input.bucket,
      label: JOB_DIRECTORY_LABELS[input.bucket],
      count: jobs.length,
      scheduledCount,
      unscheduledCount: jobs.length - scheduledCount,
      statuses,
      rows: jobs.slice(0, input.limit).map((job) => ({
        id: job.id,
        ref: job.ref,
        customer: job.customer,
        site: job.site,
        description: job.description,
        status: job.status,
        manager: job.manager,
        value: Number(job.value) || 0,
        due: job.due,
        next: job.next,
        scheduledDate: job.scheduledDate,
        scheduledTime: job.scheduledTime,
      })),
    };
  },
};

export const jobDirectoryCapabilities: BlakeCapability[] = [listJobsCapability];

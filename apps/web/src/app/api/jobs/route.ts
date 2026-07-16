import { NextResponse } from "next/server";

import {
  createJob,
  type Job,
  getJobs,
} from "@/lib/workflow-data";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { getLeads, type LeadRecord } from "@/lib/lead-store";
import { parseJsonRequestBody } from "@/lib/http";

const defaultJobScheduleDurationMinutes = 60;

function toMinutes(value: string) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function overlap(
  firstStart: string,
  secondStart: string,
  firstDurationMinutes = defaultJobScheduleDurationMinutes,
  secondDurationMinutes = defaultJobScheduleDurationMinutes,
) {
  const first = toMinutes(firstStart);
  const second = toMinutes(secondStart);
  return first < second + secondDurationMinutes && first + firstDurationMinutes > second;
}

type JobScheduleBooking = {
  jobId?: string;
  manager: string;
  scheduledDate: string;
  scheduledTime: string;
  scheduledDurationHours?: number;
};

function findJobOverlappingLead(booking: JobScheduleBooking, leads: LeadRecord[]) {
  if (!booking.scheduledDate || !booking.scheduledTime) return null;
  return (
    leads.find(
      (lead) =>
        Boolean(lead.surveyTime) &&
        lead.status !== "Lost" &&
        lead.surveyor === booking.manager &&
        lead.surveyDate === booking.scheduledDate &&
        overlap(
          booking.scheduledTime,
          lead.surveyTime,
          (booking.scheduledDurationHours ?? 1) * 60,
          60,
        ),
    ) ?? null
  );
}

function findJobScheduleClash(booking: JobScheduleBooking, jobs: Job[], leads: LeadRecord[]) {
  if (!booking.scheduledDate || !booking.scheduledTime) return null;
  const jobClash =
    jobs.find(
      (job) =>
        job.id !== booking.jobId &&
        Boolean(job.manager) &&
        Boolean(job.scheduledTime) &&
        job.manager === booking.manager &&
        job.scheduledDate === booking.scheduledDate &&
        overlap(
          booking.scheduledTime,
          job.scheduledTime ?? "",
          (booking.scheduledDurationHours ?? 1) * 60,
          (job.scheduledDurationHours ?? 1) * 60,
        ),
    ) ?? null;
  if (jobClash) return jobClash;
  return findJobOverlappingLead(booking, leads);
}

function jobScheduleClashErrorPayload(booking: JobScheduleBooking, jobs: Job[], leads: LeadRecord[]) {
  const clash = findJobScheduleClash(booking, jobs, leads);
  if (!clash) return null;
  const clashIsLead = !("customer" in clash);
  return {
    conflict: true,
    conflictJobRef: clashIsLead ? undefined : clash.ref,
    conflictLeadRef: clashIsLead ? clash.ref : undefined,
    message: clashIsLead
      ? `${booking.manager} already has ${clash.ref} at ${clash.surveyTime || "time"} for ${clash.customerName}.`
      : `${booking.manager} already has ${clash.ref} at ${clash.scheduledTime || "time"} for ${clash.customer}.`,
  };
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showJobs) {
    return NextResponse.json([]);
  }

  return NextResponse.json(getJobs());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateJob) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await parseJsonRequestBody<unknown>(request);
  if (!data) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const payload = data as
    Omit<Job, "id" | "ref" | "health"> & {
      ref?: string;
      health?: Job["health"];
    };

  if (!payload?.customer || !payload?.description || !payload?.due) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  if (payload.manager && payload.scheduledDate && payload.scheduledTime) {
    const conflict = jobScheduleClashErrorPayload(
      {
        manager: payload.manager,
        scheduledDate: payload.scheduledDate,
        scheduledTime: payload.scheduledTime,
        scheduledDurationHours: payload.scheduledDurationHours,
      },
      getJobs(),
      getLeads(),
    );
    if (conflict) {
      return NextResponse.json(conflict, { status: 409 });
    }
  }

  const created = createJob(payload);
  return NextResponse.json(created, { status: 201 });
}

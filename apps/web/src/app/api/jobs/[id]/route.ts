import { NextRequest, NextResponse } from "next/server";

import {
  getJob,
  getJobs,
  removeJob,
  updateJob,
  type Job,
} from "@/lib/workflow-data";
import { getLeads, type LeadRecord } from "@/lib/lead-store";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import { appendAuditEvent } from "@/lib/people-data";

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
  jobId: string;
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json(job);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canEditJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await parseJsonRequestBody<Partial<Job>>(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const current = getJob(id);
  if (!current) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const nextManager = body.manager ?? current.manager;
  const nextDate = body.scheduledDate ?? current.scheduledDate;
  const nextTime = body.scheduledTime ?? current.scheduledTime;
  const nextDurationHours = body.scheduledDurationHours ?? current.scheduledDurationHours;
  if (nextManager && nextDate && nextTime) {
    const conflict = jobScheduleClashErrorPayload(
      {
        jobId: id,
        manager: nextManager,
        scheduledDate: nextDate,
        scheduledTime: nextTime,
        scheduledDurationHours: nextDurationHours,
      },
      getJobs(),
      getLeads(),
    );
    if (conflict) {
      return NextResponse.json(conflict, { status: 409 });
    }
  }

  const isBeingScheduled = Boolean(nextManager && nextDate && nextTime);
  const shouldEnterActiveWorkflow = isBeingScheduled && ["Pending", "Scheduled"].includes(current.status);
  const updated = updateJob(id, {
    ...body,
    status: body.status ?? (shouldEnterActiveWorkflow ? "In progress" : current.status),
    next: body.next ?? (shouldEnterActiveWorkflow ? "Complete scheduled work" : current.next),
  });
  if (!updated) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (
    updated.manager !== current.manager ||
    updated.scheduledDate !== current.scheduledDate ||
    updated.scheduledTime !== current.scheduledTime
  ) {
    appendAuditEvent({
      actor: "HubFlo user",
      action: "scheduled",
      recordType: "job",
      recordId: updated.id,
      summary: `${updated.ref} scheduled to ${updated.manager} on ${updated.scheduledDate} at ${updated.scheduledTime}.`,
      source: "job planner",
      importance: "high",
    });
  } else if (updated.status !== current.status) {
    appendAuditEvent({
      actor: "HubFlo user",
      action: "status changed",
      recordType: "job",
      recordId: updated.id,
      summary: `${updated.ref} changed from ${current.status} to ${updated.status}.`,
      source: "job workflow",
      importance: "normal",
    });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = getAccessProfileFromHeaders(_request.headers);
  if (!access.canDeleteJobs) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const removed = removeJob(id);
  if (!removed) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

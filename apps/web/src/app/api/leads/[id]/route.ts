import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { employeeHeaderName } from "@/lib/access";
import { getLead, getLeads, removeLead, type LeadPatchPayload, type LeadRecord, updateLead } from "@/lib/lead-store";
import { getJobs, type Job } from "@/lib/workflow-data";
import { parseJsonRequestBody } from "@/lib/http";

type LeadSurveyBooking = {
  leadId: string;
  surveyor: string;
  surveyDate: string;
  surveyTime: string;
};

const surveyDurationMinutes = 60;

function toMinutes(value: string) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function overlap(firstStart: string, secondStart: string, durationMinutes = surveyDurationMinutes) {
  const first = toMinutes(firstStart);
  const second = toMinutes(secondStart);
  return first < second + durationMinutes && first + durationMinutes > second;
}

function findLeadSurveyClash(booking: LeadSurveyBooking, leads: LeadRecord[]) {
  if (!booking.surveyDate || !booking.surveyTime) return null;
  return (
    leads.find(
      (lead) =>
        lead.id !== booking.leadId &&
        lead.status !== "Lost" &&
        lead.surveyor === booking.surveyor &&
        lead.surveyDate === booking.surveyDate &&
        overlap(booking.surveyTime, lead.surveyTime),
    ) ?? null
  );
}

function findLeadOverlappingJob(booking: LeadSurveyBooking, jobs: Job[]) {
  if (!booking.surveyDate || !booking.surveyTime) return null;
  return (
    jobs.find(
      (job) =>
        Boolean(job.manager) &&
        Boolean(job.scheduledDate) &&
        job.status !== "Lost" &&
        job.manager === booking.surveyor &&
        job.scheduledDate === booking.surveyDate &&
        Boolean(job.scheduledTime) &&
        overlap(booking.surveyTime, job.scheduledTime ?? ""),
    ) ?? null
  );
}

function leadSurveyClashErrorPayload(booking: LeadSurveyBooking, leads: LeadRecord[], jobs: Job[]) {
  const clash = findLeadSurveyClash(booking, leads);
  if (clash) {
    return {
      conflict: true,
      conflictLeadRef: clash.ref,
      message: `${booking.surveyor} already has ${clash.ref} at ${clash.surveyTime} for ${clash.customerName}.`,
    };
  }
  const jobClash = findLeadOverlappingJob(booking, jobs);
  if (!jobClash) return null;
  return {
    conflict: true,
    conflictJobRef: jobClash.ref,
    message: `${booking.surveyor} already has ${jobClash.ref} at ${jobClash.scheduledTime || "time"} for ${jobClash.customer}.`,
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const payload = await parseJsonRequestBody<Partial<LeadPatchPayload>>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const actor = request.headers.get(employeeHeaderName) || "HubFlo user";
  const leadId = params.id;
  const current = getLead(leadId);
  if (!current) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const nextStatus = payload.status ?? current.status;
  const nextSurveyor = payload.surveyor ?? current.surveyor;
  const nextDate = payload.surveyDate ?? current.surveyDate;
  const nextTime = payload.surveyTime ?? current.surveyTime;
  if (nextSurveyor && nextDate && nextTime && nextStatus !== "Lost") {
    const leads = getLeads().filter((lead) => lead.id !== leadId);
    const conflict = leadSurveyClashErrorPayload(
      {
        leadId,
        surveyor: nextSurveyor,
        surveyDate: nextDate,
        surveyTime: nextTime,
      },
      leads,
      getJobs(),
    );
    if (conflict) {
      return NextResponse.json(conflict, { status: 409 });
    }
  }

  const updated = updateLead(
    leadId,
    {
      status: payload.status,
      surveyor: payload.surveyor,
      surveyDate: payload.surveyDate,
      surveyTime: payload.surveyTime,
      siteId: payload.siteId,
      next: payload.next,
    },
    actor,
  );
  if (!updated) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = await context.params;
  const removed = removeLead(params.id);
  if (!removed) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

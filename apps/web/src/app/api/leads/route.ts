import { NextResponse } from "next/server";

import {
  type LeadDraftFromClient,
  type LeadRecord,
  createLead,
  getLeads,
  getClientSites,
  getClients,
} from "@/lib/lead-store";
import { getAccessProfileFromHeaders } from "@/lib/access";
import { getJobs, type Job } from "@/lib/workflow-data";
import { parseJsonRequestBody } from "@/lib/http";

type LeadSurveyBooking = {
  leadId?: string;
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

type LeadCreateResponse = {
  lead: LeadRecord;
  clients: ReturnType<typeof getClients>;
  clientSites: ReturnType<typeof getClientSites>;
};

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead) {
    return NextResponse.json([]);
  }
  const leads = getLeads();
  return NextResponse.json(leads);
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<LeadDraftFromClient>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload.customerName || !payload.address || !payload.description || !payload.source) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existingLeads = getLeads();
  if (payload.surveyor && payload.surveyDate && payload.surveyTime) {
    const conflict = leadSurveyClashErrorPayload(
      {
        leadId: undefined,
        surveyor: payload.surveyor,
        surveyDate: payload.surveyDate,
        surveyTime: payload.surveyTime,
      },
      existingLeads,
      getJobs(),
    );
    if (conflict) {
      return NextResponse.json(conflict, { status: 409 });
    }
  }

  const actor = payload.createdBy || "HubFlo user";
  const created = createLead(payload, actor);

  const response: LeadCreateResponse = {
    lead: created.lead,
    clients: getClients(),
    clientSites: getClientSites(),
  };

  return NextResponse.json(response, { status: 201 });
}

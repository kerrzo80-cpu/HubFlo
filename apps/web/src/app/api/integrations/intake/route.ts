import { NextResponse } from "next/server";

import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { parseJsonRequestBody } from "@/lib/http";
import { createLead, type LeadDraftFromClient } from "@/lib/lead-store";
import { appendAuditEvent, type AuditEventInput } from "@/lib/people-data";
import {
  createJob,
  createPurchaseRequest,
  createQuote,
  updateJob,
  type Job,
  type PurchaseRequest,
  type Quote,
} from "@/lib/workflow-data";

type IntegrationEventType =
  | "lead.create"
  | "quote.create"
  | "job.create"
  | "job.update"
  | "purchase_request.create"
  | "job_event.create"
  | "communication.create"
  | "audit.append";

type IntegrationEnvelope = {
  eventType: IntegrationEventType;
  source: string;
  externalId?: string;
  actor?: string;
  payload?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasIntegrationAccess(request: Request) {
  const expectedToken = process.env.HUBFLO_INTEGRATION_TOKEN;
  if (!expectedToken) return true;
  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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

function appendHubDetailArrayItem(key: "jobDeliveryEvents" | "communications", item: Record<string, unknown>) {
  const state = getHubDetailState();
  const currentItems = Array.isArray(state[key]) ? state[key] : [];
  const itemId = typeof item.id === "string" ? item.id : crypto.randomUUID();
  const existing = currentItems.find((current) => isObject(current) && current.id === itemId);
  if (existing) return existing;

  const created = { ...item, id: itemId, createdAt: item.createdAt ?? timestamp() };
  saveHubDetailState({
    ...state,
    [key]: [created, ...currentItems],
  });
  return created;
}

export async function POST(request: Request) {
  if (!hasIntegrationAccess(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const envelope = await parseJsonRequestBody<IntegrationEnvelope>(request);
  if (!envelope || !envelope.eventType || !envelope.source || !isObject(envelope.payload)) {
    return badRequest("Expected eventType, source and payload.");
  }

  const actor = envelope.actor || envelope.source;
  const externalId = envelope.externalId;

  switch (envelope.eventType) {
    case "lead.create": {
      const created = createLead(envelope.payload as LeadDraftFromClient, actor);
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: created }, { status: 201 });
    }

    case "quote.create": {
      const payload = envelope.payload as Partial<Quote>;
      if (!payload.customer || !payload.description) return badRequest("Quote payload requires customer and description.");
      const created = createQuote({
        ref: payload.ref ?? "",
        clientId: payload.clientId,
        siteId: payload.siteId,
        sourceLeadId: payload.sourceLeadId,
        sourceLeadRef: payload.sourceLeadRef,
        customer: payload.customer,
        description: payload.description,
        owner: payload.owner ?? actor,
        status: payload.status ?? "Draft",
        value: payload.value ?? 0,
        next: payload.next ?? "Review quote details.",
        due: payload.due ?? "TBC",
      });
      appendAuditEvent({
        actor,
        action: "created",
        recordType: "quote",
        recordId: created.id,
        summary: `${created.ref} created from ${envelope.source}${externalId ? ` (${externalId})` : ""}.`,
        source: "integration intake",
        importance: "normal",
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: created }, { status: 201 });
    }

    case "job.create": {
      const payload = envelope.payload as Partial<Job>;
      if (!payload.customer || !payload.description) return badRequest("Job payload requires customer and description.");
      const created = createJob({
        ref: payload.ref,
        clientId: payload.clientId,
        siteId: payload.siteId,
        sourceQuoteId: payload.sourceQuoteId,
        sourceQuoteRef: payload.sourceQuoteRef,
        customer: payload.customer,
        site: payload.site ?? "Site to be confirmed",
        description: payload.description,
        manager: payload.manager ?? actor,
        scheduledDate: payload.scheduledDate,
        scheduledTime: payload.scheduledTime,
        status: payload.status ?? "Pending",
        value: payload.value ?? 0,
        next: payload.next ?? "Review and schedule.",
        due: payload.due ?? "TBC",
      });
      appendAuditEvent({
        actor,
        action: "created",
        recordType: "job",
        recordId: created.id,
        summary: `${created.ref} created from ${envelope.source}${externalId ? ` (${externalId})` : ""}.`,
        source: "integration intake",
        importance: "normal",
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: created }, { status: 201 });
    }

    case "job.update": {
      const payload = envelope.payload as Partial<Job> & { id?: string };
      if (!payload.id) return badRequest("Job update payload requires id.");
      const { id, ...patch } = payload;
      const updated = updateJob(id, patch);
      if (!updated) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      appendAuditEvent({
        actor,
        action: "updated",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.ref} updated from ${envelope.source}${externalId ? ` (${externalId})` : ""}.`,
        source: "integration intake",
        importance: "normal",
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: updated });
    }

    case "purchase_request.create": {
      const payload = envelope.payload as Partial<PurchaseRequest>;
      if (!payload.jobId || !payload.jobRef || !payload.supplier || !payload.item) {
        return badRequest("Purchase request payload requires jobId, jobRef, supplier and item.");
      }
      const created = createPurchaseRequest({
        jobId: payload.jobId,
        jobRef: payload.jobRef,
        requestedBy: payload.requestedBy ?? actor,
        supplier: payload.supplier,
        item: payload.item,
        estimatedCost: payload.estimatedCost ?? 0,
        reason: payload.reason ?? `Requested from ${envelope.source}`,
        createdAt: payload.createdAt ?? timestamp(),
      });
      appendAuditEvent({
        actor,
        action: "created",
        recordType: "purchase_request",
        recordId: created.id,
        summary: `PO request created from ${envelope.source} for ${created.jobRef}.`,
        source: "integration intake",
        importance: "normal",
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: created }, { status: 201 });
    }

    case "job_event.create": {
      const event = appendHubDetailArrayItem("jobDeliveryEvents", {
        ...envelope.payload,
        id: externalId ?? (envelope.payload.id as string | undefined),
        source: envelope.source,
        actor: (envelope.payload.actor as string | undefined) ?? actor,
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: event }, { status: 201 });
    }

    case "communication.create": {
      const communication = appendHubDetailArrayItem("communications", {
        ...envelope.payload,
        id: externalId ?? (envelope.payload.id as string | undefined),
        messageId: externalId ?? envelope.payload.messageId,
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: communication }, { status: 201 });
    }

    case "audit.append": {
      const created = appendAuditEvent({
        ...(envelope.payload as AuditEventInput),
        actor: (envelope.payload.actor as string | undefined) ?? actor,
        source: "integration intake",
      });
      return NextResponse.json({ ok: true, eventType: envelope.eventType, result: created }, { status: 201 });
    }

    default:
      return badRequest("Unsupported eventType.");
  }
}

import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { appendAuditEvent, removeClientSiteRecord, updateClientSiteRecord, type ClientSite } from "@/lib/people-data";
import { getJobs, updateJob } from "@/lib/workflow-data";

function pickString(body: Record<string, unknown> | null, key: string) {
  const value = body?.[key];
  return typeof value === "string" ? value : undefined;
}

function hasKey(body: Record<string, unknown> | null, key: string) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 422 });

  const relatedJobIds = new Set(getJobs().filter((job) => job.siteId === id).map((job) => job.id));
  const patch: Partial<ClientSite> = {
    clientId: pickString(body, "clientId"),
    name: pickString(body, "name"),
    address: pickString(body, "address"),
    accessNotes: pickString(body, "accessNotes"),
    primaryContact: pickString(body, "primaryContact"),
    serviceLine: pickString(body, "serviceLine"),
    nextVisit: pickString(body, "nextVisit"),
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
  };
  const clearKeys: Array<keyof ClientSite> = [];

  if (hasKey(body, "vatTreatment")) {
    const raw = body.vatTreatment;
    if (raw === null || raw === "" || raw === "inherit") {
      clearKeys.push("vatTreatment", "vatRateOverride");
    } else if (typeof raw === "string") {
      patch.vatTreatment = raw as ClientSite["vatTreatment"];
      if (hasKey(body, "vatRateOverride") && typeof body.vatRateOverride === "string") {
        patch.vatRateOverride = body.vatRateOverride;
      }
    }
  } else if (hasKey(body, "vatRateOverride") && typeof body.vatRateOverride === "string") {
    patch.vatRateOverride = body.vatRateOverride;
  }

  // Tri-state CIS: boolean override; null / "inherit" clears to client default.
  if (hasKey(body, "cis")) {
    if (body.cis === null || body.cis === "" || body.cis === "inherit") {
      clearKeys.push("cis");
    } else if (typeof body.cis === "boolean") {
      patch.cis = body.cis;
    }
  }

  if (hasKey(body, "retentionPercent")) {
    if (body.retentionPercent === null || body.retentionPercent === "inherit") {
      clearKeys.push("retentionPercent");
    } else if (typeof body.retentionPercent === "string") {
      patch.retentionPercent = body.retentionPercent;
    }
  }

  if (hasKey(body, "retentionCapAmount")) {
    if (body.retentionCapAmount === null || body.retentionCapAmount === "inherit") {
      clearKeys.push("retentionCapAmount");
    } else if (typeof body.retentionCapAmount === "string") {
      patch.retentionCapAmount = body.retentionCapAmount;
    }
  }

  if (hasKey(body, "mainContractorDiscountPercent")) {
    if (body.mainContractorDiscountPercent === null || body.mainContractorDiscountPercent === "inherit") {
      clearKeys.push("mainContractorDiscountPercent");
    } else if (typeof body.mainContractorDiscountPercent === "string") {
      patch.mainContractorDiscountPercent = body.mainContractorDiscountPercent;
    }
  }

  const updated = updateClientSiteRecord(id, patch, { clearKeys });

  if (!updated) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const syncedJobs = Array.from(relatedJobIds)
    .map((jobId) => updateJob(jobId, { siteId: updated.id, site: updated.address }))
    .filter((job): job is NonNullable<typeof job> => Boolean(job));

  appendAuditEvent({
    actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "Blake user",
    action: updated.archived ? "archived" : "updated",
    recordType: "site",
    recordId: updated.id,
    summary: updated.archived
      ? `${updated.name} archived.`
      : body.archived === false
        ? `${updated.name} restored.`
        : `${updated.name} updated.`,
    source: "site directory",
    importance: "normal",
  });

  return NextResponse.json({ site: updated, jobs: syncedJobs });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const deleted = removeClientSiteRecord(id);
  if (!deleted) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  appendAuditEvent({
    actor: request.headers.get("x-hub-actor")?.trim() || "Blake user",
    action: "deleted",
    recordType: "site",
    recordId: id,
    summary: `Site ${id} deleted.`,
    source: "site directory",
    importance: "high",
  });

  return NextResponse.json({ ok: true });
}

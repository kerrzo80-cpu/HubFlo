import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { addClientSiteRecord, appendAuditEvent, getClientSites, type ClientSite } from "@/lib/people-data";
import { parseJsonRequestBody } from "@/lib/http";

type CreateSitePayload = {
  clientId?: string;
  name?: string;
  address?: string;
  primaryContact?: string;
  accessNotes?: string;
  serviceLine?: string;
  nextVisit?: string;
  vatTreatment?: ClientSite["vatTreatment"];
  vatRateOverride?: string;
  cis?: boolean;
  retentionPercent?: string;
  mainContractorDiscountPercent?: string;
  actor?: string;
};

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json([]);
  }

  return NextResponse.json(getClientSites());
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead && !access.canCreateQuote && !access.canCreateJob) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<CreateSitePayload>(request);
  if (!payload) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const clientId = payload.clientId?.trim();
  const address = payload.address?.trim();
  if (!clientId || !address) {
    return NextResponse.json({ error: "clientId and address are required." }, { status: 400 });
  }

  const existing = getClientSites().find(
    (site) => site.clientId === clientId && site.address.trim().toLowerCase() === address.toLowerCase(),
  );
  if (existing) {
    return NextResponse.json({ site: existing, clientSites: getClientSites() });
  }

  const site: ClientSite = addClientSiteRecord({
    id: `site-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    clientId,
    name: payload.name?.trim() || address.split(",")[0]?.trim() || "New site",
    address,
    primaryContact: payload.primaryContact?.trim() || "To confirm",
    accessNotes: payload.accessNotes?.trim() || "To confirm before first visit.",
    serviceLine: payload.serviceLine?.trim() || "General work",
    nextVisit: payload.nextVisit?.trim() || "To be scheduled",
    vatTreatment: payload.vatTreatment,
    vatRateOverride: payload.vatRateOverride?.trim() || "",
    cis: typeof payload.cis === "boolean" ? payload.cis : undefined,
    retentionPercent: payload.retentionPercent?.trim() || undefined,
    mainContractorDiscountPercent: payload.mainContractorDiscountPercent?.trim() || undefined,
  });

  const auditEvent = appendAuditEvent({
    actor: payload.actor?.trim() || "NeXa user",
    action: "created",
    recordType: "site",
    recordId: site.id,
    summary: `New site ${site.name} created.`,
    source: "site directory",
    importance: "normal",
  });

  return NextResponse.json({ site, clientSites: getClientSites(), auditEvents: [auditEvent] }, { status: 201 });
}

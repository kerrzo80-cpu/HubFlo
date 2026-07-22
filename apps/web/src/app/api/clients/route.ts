import { NextResponse } from "next/server";

import { getAccessProfileFromHeaders } from "@/lib/access";
import { parseJsonRequestBody } from "@/lib/http";
import {
  addClientRecord,
  addClientSiteRecord,
  appendAuditEvent,
  getClientSites,
  getClients,
  type ClientRecord,
  type ClientSite,
  type VatTreatment,
} from "@/lib/people-data";

type CreateClientPayload = {
  name?: string;
  primaryContact?: string;
  email?: string;
  phone?: string;
  address?: string;
  accountReference?: string;
  status?: ClientRecord["status"];
  commercialOwner?: string;
  notes?: string;
  siteName?: string;
  siteAddress?: string;
  accessNotes?: string;
  serviceLine?: string;
  nextVisit?: string;
  vatTreatment?: VatTreatment;
  vatRateOverride?: string;
  siteVatTreatment?: VatTreatment;
  siteVatRateOverride?: string;
  source?: string;
  actor?: string;
};

function makeClientReference(existingClients: ClientRecord[]) {
  const numbers = existingClients
    .map((client) => {
      const found = client.accountReference.match(/\d+/g)?.join("");
      return found ? Number(found) : 0;
    })
    .filter((value) => Number.isFinite(value));
  return `C-${Math.max(1000, ...numbers) + 1}`;
}

function makeSiteName(address: string) {
  return (address.split(",")[0]?.trim() || "New site").slice(0, 64);
}

function cleanVatTreatment(value?: string): VatTreatment | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "zero rated" || normalized === "zero" || normalized === "0%" || normalized === "0") return "Zero rated";
  if (normalized === "domestic reverse charge" || normalized === "reverse charge" || normalized === "drc") return "Domestic reverse charge";
  if (normalized === "custom") return "Custom";
  if (normalized === "standard 20%" || normalized === "standard" || normalized === "20%" || normalized === "20") return "Standard 20%";
  return undefined;
}

export async function GET(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.showCustomers) {
    return NextResponse.json([]);
  }

  const search = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const clients = getClients();

  if (!search) {
    return NextResponse.json(clients);
  }

  const filtered = clients.filter((client) =>
    [client.name, client.primaryContact, client.email, client.phone, client.billingAddress]
      .some((value) => value.toLowerCase().includes(search)),
  );

  return NextResponse.json(filtered);
}

export async function POST(request: Request) {
  const access = getAccessProfileFromHeaders(request.headers);
  if (!access.canCreateLead && !access.canCreateQuote && !access.canCreateJob) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = await parseJsonRequestBody<CreateClientPayload>(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = payload.name?.trim() ?? "";
  const address = payload.address?.trim() ?? "";
  const siteAddress = payload.siteAddress?.trim() || address;
  if (!name || !address) {
    return NextResponse.json({ error: "Customer name and site address are required" }, { status: 400 });
  }

  const existingClients = getClients();
  const existingByName = existingClients.find((client) => client.name.trim().toLowerCase() === name.toLowerCase());
  if (existingByName) {
    const existingSites = getClientSites();
    const existingSite = existingSites.find(
      (site) => site.clientId === existingByName.id && site.address.trim().toLowerCase() === siteAddress.toLowerCase(),
    );
    const site =
      existingSite ??
      addClientSiteRecord({
        id: `site-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        clientId: existingByName.id,
        name: payload.siteName?.trim() || makeSiteName(siteAddress),
        address: siteAddress,
        accessNotes: payload.accessNotes?.trim() || "To confirm before first visit.",
        primaryContact: payload.primaryContact?.trim() || name,
        serviceLine: payload.serviceLine?.trim() || payload.source?.trim() || "New work",
        nextVisit: payload.nextVisit?.trim() || "To be scheduled",
        vatTreatment: cleanVatTreatment(payload.siteVatTreatment ?? payload.vatTreatment),
        vatRateOverride: payload.siteVatRateOverride?.trim() || payload.vatRateOverride?.trim() || "",
      });

    return NextResponse.json(
      {
        client: existingByName,
        site,
        clients: getClients(),
        clientSites: getClientSites(),
      },
      { status: existingSite ? 200 : 201 },
    );
  }

  const token = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
  const client: ClientRecord = {
    id: `client-${token}`,
    name,
    accountReference: payload.accountReference?.trim() || makeClientReference(existingClients),
    status: payload.status && ["Active", "Prospect", "On hold"].includes(payload.status) ? payload.status : "Prospect",
    primaryContact: payload.primaryContact?.trim() || name,
    email: payload.email?.trim() || `${token}@example.com`,
    phone: payload.phone?.trim() || "Pending",
    billingAddress: address,
    commercialOwner: payload.commercialOwner?.trim() || "TBD",
    notes: payload.notes?.trim() || `Created from ${payload.source?.trim() || "HubFlo intake"}.`,
    vatTreatment: cleanVatTreatment(payload.vatTreatment),
    vatRateOverride: payload.vatRateOverride?.trim() || "",
  };

  const site: ClientSite = {
    id: `site-${token}`,
    clientId: client.id,
    name: payload.siteName?.trim() || makeSiteName(siteAddress),
    address: siteAddress,
    accessNotes: payload.accessNotes?.trim() || "To confirm before first visit.",
    primaryContact: payload.primaryContact?.trim() || name,
    serviceLine: payload.serviceLine?.trim() || payload.source?.trim() || "New work",
    nextVisit: payload.nextVisit?.trim() || "To be scheduled",
    vatTreatment: cleanVatTreatment(payload.siteVatTreatment ?? payload.vatTreatment),
    vatRateOverride: payload.siteVatRateOverride?.trim() || payload.vatRateOverride?.trim() || "",
  };

  addClientRecord(client);
  addClientSiteRecord(site);
  const clientAuditEvent = appendAuditEvent({
    actor: payload.actor?.trim() || "HubFlo user",
    action: "created",
    recordType: "client",
    recordId: client.id,
    summary: `New customer ${client.name} created from ${payload.source?.trim() || "HubFlo intake"}.`,
    source: "customer intake",
    importance: "normal",
  });
  const siteAuditEvent = appendAuditEvent({
    actor: payload.actor?.trim() || "HubFlo user",
    action: "created",
    recordType: "site",
    recordId: site.id,
    summary: `New site ${site.name} created for ${client.name}.`,
    source: "customer intake",
    importance: "normal",
  });

  return NextResponse.json(
    {
      client,
      site,
      clients: getClients(),
      clientSites: getClientSites(),
      auditEvents: [clientAuditEvent, siteAuditEvent],
    },
    { status: 201 },
  );
}

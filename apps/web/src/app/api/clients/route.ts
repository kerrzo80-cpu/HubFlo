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
} from "@/lib/people-data";

type CreateClientPayload = {
  name?: string;
  primaryContact?: string;
  email?: string;
  phone?: string;
  address?: string;
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
  if (!name || !address) {
    return NextResponse.json({ error: "Customer name and site address are required" }, { status: 400 });
  }

  const existingClients = getClients();
  const existingByName = existingClients.find((client) => client.name.trim().toLowerCase() === name.toLowerCase());
  if (existingByName) {
    const existingSites = getClientSites();
    const existingSite = existingSites.find(
      (site) => site.clientId === existingByName.id && site.address.trim().toLowerCase() === address.toLowerCase(),
    );
    const site =
      existingSite ??
      addClientSiteRecord({
        id: `site-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        clientId: existingByName.id,
        name: makeSiteName(address),
        address,
        accessNotes: "To confirm before first visit.",
        primaryContact: payload.primaryContact?.trim() || name,
        serviceLine: payload.source?.trim() || "New work",
        nextVisit: "To be scheduled",
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
    accountReference: makeClientReference(existingClients),
    status: "Prospect",
    primaryContact: payload.primaryContact?.trim() || name,
    email: payload.email?.trim() || `${token}@example.com`,
    phone: payload.phone?.trim() || "Pending",
    billingAddress: address,
    commercialOwner: "TBD",
    notes: `Created from ${payload.source?.trim() || "HubFlo intake"}.`,
  };

  const site: ClientSite = {
    id: `site-${token}`,
    clientId: client.id,
    name: makeSiteName(address),
    address,
    accessNotes: "To confirm before first visit.",
    primaryContact: payload.primaryContact?.trim() || name,
    serviceLine: payload.source?.trim() || "New work",
    nextVisit: "To be scheduled",
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

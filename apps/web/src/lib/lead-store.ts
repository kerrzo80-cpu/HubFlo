import {
  addClientRecord,
  addClientSiteRecord,
  appendAuditEvent,
  getClientSites as getPeopleClientSites,
  getClients as getPeopleClients,
  type ClientRecord,
  type ClientSite,
} from "@/lib/people-data";
import { loadServerStore, writeServerStore } from "@/lib/server-store";

export type LeadSource = "Phone call" | "Checkatrade" | "Email" | "Website" | "Referral";
export type LeadStatus = "New enquiry" | "Needs scheduling" | "Survey booked" | "Quoted" | "Lost";

export type LeadRecord = {
  id: string;
  ref: string;
  source: LeadSource;
  clientId?: string;
  siteId?: string;
  mainContact?: LeadContact;
  additionalContacts?: LeadContact[];
  addressParts?: LeadAddressParts;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  description: string;
  status: LeadStatus;
  surveyor: string;
  surveyDate: string;
  surveyTime: string;
  createdBy: string;
  next: string;
  createdAt: string;
};

export type LeadAddressParts = {
  line1: string;
  line2: string;
  town: string;
  county: string;
  postcode: string;
};

export type LeadContact = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  notes: string;
};

export type LeadStoreApiPayload = Omit<LeadRecord, "id" | "ref" | "createdAt" | "next"> & {
  id?: string;
  ref?: string;
  next?: string;
  createdAt?: string;
  createdClient?: boolean;
  createdSite?: boolean;
};

export type LeadDraftFromClient = Omit<LeadStoreApiPayload, "source"> & {
  source: LeadSource;
};

export type LeadCreationResult = {
  lead: LeadRecord;
  createdClient?: boolean;
  createdSite?: boolean;
};

export type LeadPatchPayload = Partial<
  Pick<LeadRecord, "status" | "surveyor" | "surveyDate" | "surveyTime" | "siteId" | "next">
>;

export const seedLeads: LeadRecord[] = [
  {
    id: "lead-1001",
    ref: "L-1001",
    source: "Phone call",
    clientId: "client-northfield",
    customerName: "Diane Paterson",
    phone: "07700 900221",
    email: "dianepaterson328@gmail.com",
    address: "136 King's Gate, Aberdeen, AB15 4EQ",
    description: "New shower cubicle and possible full bathroom refurbishment.",
    status: "Survey booked",
    surveyor: "Errol Watson",
    surveyDate: "2026-06-24",
    surveyTime: "10:30",
    createdBy: "Carol",
    next: "Survey booked and notification sent to Errol Watson.",
    createdAt: "23 Jun 2026 09:12",
  },
  {
    id: "lead-1002",
    ref: "L-1002",
    source: "Checkatrade",
    customerName: "Gordon Milne",
    phone: "07700 900447",
    email: "gordon.milne@example.com",
    address: "4 Stoneywood Road, Aberdeen, AB21 9JD",
    description: "Boiler replacement enquiry after repeated pressure loss.",
    status: "Needs scheduling",
    surveyor: "Chris Lawson",
    surveyDate: "",
    surveyTime: "",
    createdBy: "Carol",
    next: "Check diary and agree attendance slot.",
    createdAt: "23 Jun 2026 10:05",
  },
  {
    id: "lead-1003",
    ref: "L-1003",
    source: "Email",
    clientId: "client-aberdeen-care",
    siteId: "site-rubislaw",
    customerName: "Fiona MacLeod",
    phone: "07700 900582",
    email: "fiona.macleod@example.com",
    address: "21 Riverside Drive, Banchory, AB31 5XY",
    description: "General plumbing quote for kitchen alterations before joinery starts.",
    status: "Survey booked",
    surveyor: "Brian Kerr",
    surveyDate: "2026-06-24",
    surveyTime: "14:00",
    createdBy: "Carol",
    next: "Survey booked and notification sent to Brian Kerr.",
    createdAt: "23 Jun 2026 11:18",
  },
];

type LeadStoreState = {
  leads: LeadRecord[];
};

const defaultLeadStore: LeadStoreState = {
  leads: clone(seedLeads),
};

const leadStore = loadServerStore("lead-store", defaultLeadStore);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persistLeadStore() {
  writeServerStore("lead-store", leadStore);
}

function getStore(): LeadStoreState {
  return leadStore;
}

function normalizeClientIdentity(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, "");
}

function makeClientReference(existingClients: ClientRecord[]) {
  const numbers = existingClients
    .map((client) => {
      const found = client.accountReference.match(/\d+/g)?.join("");
      return found ? Number(found) : 0;
    })
    .filter((value) => Number.isFinite(value));
  const next = Math.max(1000, ...numbers) + 1;
  return `C-${next}`;
}

function determineNextLeadRef(leads: LeadRecord[]) {
  const refs = leads.map((lead) => Number(lead.ref.replace(/\D/g, ""))).filter(Number.isFinite);
  return `L-${Math.max(1000, ...refs) + 1}`;
}

function makeLeadSiteId() {
  return `site-${Date.now()}-${Math.round(Math.random() * 1000)}`;
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

function resolveLeadCustomer(draft: LeadDraftFromClient, clients: ClientRecord[]) {
  const draftName = normalizeClientIdentity(draft.customerName);
  const draftEmail = normalizeClientIdentity(draft.email);
  const draftPhone = normalizePhone(draft.phone);

  const emailMatch = clients.find((client) => draftEmail && normalizeClientIdentity(client.email) === draftEmail);
  if (emailMatch) return emailMatch;

  if (draftPhone) {
    const phoneMatch = clients.find((client) => normalizePhone(client.phone) === draftPhone);
    if (phoneMatch) return phoneMatch;
  }

  return clients.find((client) => {
    const normalizedName = normalizeClientIdentity(client.name);
    return normalizedName === draftName || normalizedName.includes(draftName) || draftName.includes(normalizedName);
  });
}

function buildClientFromLead(draft: LeadDraftFromClient, existingClients: ClientRecord[]) {
  const token = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
  const newClient: ClientRecord = {
    id: `client-${token}`,
    name: draft.customerName.trim() || "New customer",
    accountReference: makeClientReference(existingClients),
    status: "Prospect",
    primaryContact: draft.customerName.trim(),
    email: draft.email.trim() || `${token}@example.com`,
    phone: draft.phone.trim() || "Pending",
    billingAddress: draft.address || "Pending address",
    commercialOwner: "TBD",
    notes: "Created from lead intake.",
  };

  const newSite: ClientSite | undefined = draft.address
    ? {
        id: `site-${token}`,
        clientId: newClient.id,
        name: draft.address.split(",")[0]?.trim() || "New site",
        address: draft.address,
        accessNotes: "To confirm before first visit.",
        primaryContact: draft.customerName.trim(),
        serviceLine: "New work",
        nextVisit: "To be scheduled",
      }
    : undefined;

  return { newClient, newSite };
}

function resolveLeadSite(draft: LeadDraftFromClient, client?: ClientRecord, sites: ClientSite[] = []) {
  if (draft.siteId) {
    const explicitSite = sites.find(
      (site) => site.id === draft.siteId &&
        (!client || site.clientId === client.id),
    );
    if (explicitSite) return explicitSite;
  }
  if (!client) return undefined;
  return (
    sites.find(
      (site) => site.clientId === client.id && normalizeClientIdentity(site.address) === normalizeClientIdentity(draft.address),
    ) ??
    (draft.address
      ? {
          id: makeLeadSiteId(),
          clientId: client.id,
          name: draft.address.split(",")[0]?.trim() || "New site",
          address: draft.address,
          accessNotes: "To confirm before first visit.",
          primaryContact: draft.customerName.trim(),
          serviceLine: "New work",
          nextVisit: "To be scheduled",
        }
      : undefined)
  );
}

export function getClients() {
  return getPeopleClients();
}

export function getClientSites() {
  return getPeopleClientSites();
}

export function getLeads() {
  return clone(getStore().leads);
}

export function resetLeadStore() {
  const store = getStore();
  store.leads = [];
  persistLeadStore();
  return clone(store);
}

export function getLead(id: string) {
  return getStore().leads.find((lead) => lead.id === id) ?? null;
}

export function createLead(payload: LeadDraftFromClient, actor: string): LeadCreationResult {
  const store = getStore();
  const clients = getPeopleClients();
  const sites = getPeopleClientSites();
  const matchedClient =
    payload.clientId ? clients.find((client) => client.id === payload.clientId) : resolveLeadCustomer(payload, clients);

  const { newClient, newSite } = matchedClient
    ? { newClient: undefined, newSite: undefined }
    : buildClientFromLead(payload, clients);
  const selectedClient = matchedClient ?? newClient;
  const selectedSite = resolveLeadSite(payload, selectedClient, sites);

  let createdClient = false;
  let createdSite = false;

  if (newClient) {
    addClientRecord(newClient);
    createdClient = true;
    appendAuditEvent({
      actor,
      action: "created",
      recordType: "client",
      recordId: newClient.id,
      summary: `New customer ${newClient.name} created from lead intake.`,
      source: "lead intake",
      importance: "normal",
    });
  }

  const siteToPersist = selectedSite;
  if (siteToPersist && !sites.find((site) => site.id === siteToPersist.id)) {
    addClientSiteRecord(siteToPersist);
    createdSite = true;
    appendAuditEvent({
      actor,
      action: "created",
      recordType: "site",
      recordId: siteToPersist.id,
      summary: `New site ${siteToPersist.name} created from lead intake.`,
      source: "lead intake",
      importance: "normal",
    });
  }

  const createdLead: LeadRecord = {
    id: payload.id ?? `lead-${Date.now()}`,
    ref: payload.ref ?? determineNextLeadRef(store.leads),
    source: payload.source,
    clientId: selectedClient?.id,
    siteId: selectedSite?.id,
    mainContact: payload.mainContact,
    additionalContacts: payload.additionalContacts,
    addressParts: payload.addressParts,
    customerName: selectedClient?.name ?? payload.customerName,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    description: payload.description,
    status: payload.status ?? "Needs scheduling",
    surveyor: payload.surveyor,
    surveyDate: payload.surveyDate,
    surveyTime: payload.surveyTime,
    createdBy: payload.createdBy,
    next: payload.next ?? "Check diary and book survey appointment.",
    createdAt: payload.createdAt ?? timestamp(),
  };

  store.leads = [createdLead, ...store.leads];
  persistLeadStore();

  appendAuditEvent({
    actor,
    action: "created",
    recordType: "lead",
    recordId: createdLead.id,
    summary: `${createdLead.ref} created from ${createdLead.source} for ${createdLead.customerName}.`,
    source: "office intake",
    importance: "normal",
  });

  return {
    lead: clone(createdLead),
    createdClient,
    createdSite: createdSite || Boolean(newSite),
  };
}

export function updateLead(id: string, patch: LeadPatchPayload, actor = "HubFlo user") {
  const store = getStore();
  const index = store.leads.findIndex((lead) => lead.id === id);
  if (index < 0) return null;

  const current = store.leads[index];
  if (!current) return null;
  const next: LeadRecord = {
    ...current,
    ...patch,
    id: current.id,
    ref: current.ref,
    source: current.source,
    createdAt: current.createdAt,
  };
  store.leads[index] = clone(next);
  persistLeadStore();

  const statusChanged = patch.status && patch.status !== current.status;
  const bookingDone = patch.status === "Survey booked" && patch.surveyDate && patch.surveyTime;
  if (statusChanged || bookingDone) {
    appendAuditEvent({
      actor,
      action: bookingDone ? "booked" : "updated",
      recordType: "lead",
      recordId: next.id,
      summary:
        patch.status === "Quoted"
          ? `${next.ref} marked as quoted.`
          : bookingDone
            ? `${next.ref} survey booked with ${next.surveyor}.`
            : `${next.ref} updated.`,
      source: "lead intake",
      importance: patch.status === "Quoted" ? "normal" : "high",
    });
  }

  return clone(next);
}

export function removeLead(id: string): boolean {
  const store = getStore();
  const currentCount = store.leads.length;
  store.leads = store.leads.filter((lead) => lead.id !== id);
  if (store.leads.length < currentCount) {
    persistLeadStore();
    return true;
  }
  return false;
}

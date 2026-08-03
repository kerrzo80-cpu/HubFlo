import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { useDemoSeedData } from "@/lib/workspace-mode";
import {
  seedClientSites,
  seedClients,
  type AuditEvent,
  type AuditEventInput,
  type ClientRecord,
  type ClientSite,
  type ClientStatus,
  type VatTreatment,
} from "@/lib/people-seed-data";

export type { AuditEvent, AuditEventInput, ClientRecord, ClientSite, ClientStatus, VatTreatment };
export { seedClientSites, seedClients };

type PeopleStore = {
  clients: ClientRecord[];
  clientSites: ClientSite[];
  auditEvents: AuditEvent[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

const seedPeopleStore: PeopleStore = {
  clients: useDemoSeedData() ? clone(seedClients) : [],
  clientSites: useDemoSeedData() ? clone(seedClientSites) : [],
  auditEvents: [],
};

const peopleStore: PeopleStore = loadServerStore("people-store", seedPeopleStore);

function persistPeopleStore() {
  writeServerStore("people-store", peopleStore);
}

export function getClients() {
  return clone(peopleStore.clients);
}

export function getClientSites() {
  return clone(peopleStore.clientSites);
}

export function updateClientRecord(clientId: string, patch: Partial<ClientRecord>) {
  const existing = peopleStore.clients.find((client) => client.id === clientId);
  if (!existing) return null;
  Object.assign(existing, patch);
  persistPeopleStore();
  return clone(existing);
}

export function updateClientSiteRecord(siteId: string, patch: Partial<ClientSite>) {
  const existing = peopleStore.clientSites.find((site) => site.id === siteId);
  if (!existing) return null;
  Object.assign(existing, patch);
  persistPeopleStore();
  return clone(existing);
}

export function removeClientRecord(clientId: string) {
  const existingClient = peopleStore.clients.find((client) => client.id === clientId);
  if (!existingClient) return false;
  peopleStore.clients = peopleStore.clients.filter((client) => client.id !== clientId);
  peopleStore.clientSites = peopleStore.clientSites.filter((site) => site.clientId !== clientId);
  persistPeopleStore();
  return true;
}

export function removeClientSiteRecord(siteId: string) {
  const existingSite = peopleStore.clientSites.find((site) => site.id === siteId);
  if (!existingSite) return false;
  peopleStore.clientSites = peopleStore.clientSites.filter((site) => site.id !== siteId);
  persistPeopleStore();
  return true;
}

export function addClientRecord(client: ClientRecord) {
  if (!peopleStore.clients.find((existing) => existing.id === client.id)) {
    peopleStore.clients = [client, ...peopleStore.clients];
    persistPeopleStore();
  }
  return client;
}

export function addClientSiteRecord(site: ClientSite) {
  if (!peopleStore.clientSites.find((existing) => existing.id === site.id)) {
    peopleStore.clientSites = [site, ...peopleStore.clientSites];
    persistPeopleStore();
  }
  return site;
}

export function getAuditEvents(): AuditEvent[] {
  return clone(peopleStore.auditEvents);
}

export function appendAuditEvent(input: AuditEventInput): AuditEvent {
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    createdAt: input.createdAt ?? timestamp(),
    actor: input.actor,
    action: input.action,
    recordType: input.recordType,
    recordId: input.recordId,
    summary: input.summary,
    source: input.source,
    importance: input.importance,
  };

  peopleStore.auditEvents = [event, ...peopleStore.auditEvents];
  persistPeopleStore();
  return clone(event);
}

export function resetWorkflowAuditEvents(): AuditEvent[] {
  peopleStore.auditEvents = [];
  persistPeopleStore();
  return clone(peopleStore.auditEvents);
}

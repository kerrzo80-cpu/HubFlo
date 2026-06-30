import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  seedClientSites,
  seedClients,
  type AuditEvent,
  type AuditEventInput,
  type ClientRecord,
  type ClientSite,
  type ClientStatus,
} from "@/lib/people-seed-data";

export type { AuditEvent, AuditEventInput, ClientRecord, ClientSite, ClientStatus };
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
  clients: clone(seedClients),
  clientSites: clone(seedClientSites),
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

import { loadServerStore, readServerStoreSnapshot, writeServerStore } from "@/lib/server-store";
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
let peopleStoreHydrated = Array.isArray(peopleStore.clients) && peopleStore.clients.length > 0;

/** Lean audit log — never rewrite 1700+ clients just to append one timeline row (live passaround 502s). */
const AUDIT_EVENTS_STORE = "nexa-audit-events-v1";
const AUDIT_EVENTS_CAP = 2500;

function readAuditEventsSideStore(): AuditEvent[] {
  const snap = readServerStoreSnapshot(AUDIT_EVENTS_STORE) as { events?: unknown } | null;
  if (!snap || !Array.isArray(snap.events)) return [];
  return snap.events as AuditEvent[];
}

function persistAuditEventsOnly(events: AuditEvent[]) {
  const trimmed = events.slice(0, AUDIT_EVENTS_CAP);
  peopleStore.auditEvents = trimmed;
  try {
    writeServerStore(AUDIT_EVENTS_STORE, {
      events: trimmed,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // In-memory still holds the event for this process.
  }
}

function rehydratePeopleStoreFromDisk() {
  // List GETs must not deep-clone the whole people store from disk every request.
  if (peopleStoreHydrated) return;
  const persisted = readServerStoreSnapshot("people-store") as PeopleStore | null;
  if (!persisted || !Array.isArray(persisted.clients) || !Array.isArray(persisted.clientSites) || !Array.isArray(persisted.auditEvents)) {
    peopleStoreHydrated = true;
    return;
  }
  peopleStore.clients = persisted.clients;
  peopleStore.clientSites = persisted.clientSites;
  // Prefer lean audit side store when present; fall back to embedded people-store audits.
  const sideAudits = readAuditEventsSideStore();
  peopleStore.auditEvents = sideAudits.length ? sideAudits : persisted.auditEvents;
  peopleStoreHydrated = true;
}

function persistPeopleStore() {
  // Keep embedded audits empty/small in the fat people-store write — live audits live in AUDIT_EVENTS_STORE.
  const audits = Array.isArray(peopleStore.auditEvents) ? peopleStore.auditEvents.slice(0, AUDIT_EVENTS_CAP) : [];
  peopleStore.auditEvents = audits;
  writeServerStore("people-store", {
    clients: peopleStore.clients,
    clientSites: peopleStore.clientSites,
    // Do not keep duplicating the full audit log inside the clients blob.
    auditEvents: audits.slice(0, 50),
  });
  persistAuditEventsOnly(audits);
  peopleStoreHydrated = true;
}

export function getClients() {
  rehydratePeopleStoreFromDisk();
  return peopleStore.clients.map((client) => ({ ...client }));
}

export function getClientSites() {
  rehydratePeopleStoreFromDisk();
  return peopleStore.clientSites.map((site) => ({ ...site }));
}

function applyDefinedPatch<T extends object>(target: T, patch: Partial<T>) {
  for (const [key, value] of Object.entries(patch) as Array<[keyof T, T[keyof T] | undefined]>) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

export function updateClientRecord(clientId: string, patch: Partial<ClientRecord>) {
  rehydratePeopleStoreFromDisk();
  const existing = peopleStore.clients.find((client) => client.id === clientId);
  if (!existing) return null;
  applyDefinedPatch(existing, patch);
  persistPeopleStore();
  return clone(existing);
}

export function updateClientSiteRecord(
  siteId: string,
  patch: Partial<ClientSite>,
  options?: { clearKeys?: Array<keyof ClientSite> },
) {
  rehydratePeopleStoreFromDisk();
  const existing = peopleStore.clientSites.find((site) => site.id === siteId);
  if (!existing) return null;
  applyDefinedPatch(existing, patch);
  for (const key of options?.clearKeys ?? []) {
    delete existing[key];
  }
  persistPeopleStore();
  return clone(existing);
}

export function removeClientRecord(clientId: string) {
  rehydratePeopleStoreFromDisk();
  const existingClient = peopleStore.clients.find((client) => client.id === clientId);
  if (!existingClient) return false;
  peopleStore.clients = peopleStore.clients.filter((client) => client.id !== clientId);
  peopleStore.clientSites = peopleStore.clientSites.filter((site) => site.clientId !== clientId);
  persistPeopleStore();
  return true;
}

export function removeClientSiteRecord(siteId: string) {
  rehydratePeopleStoreFromDisk();
  const existingSite = peopleStore.clientSites.find((site) => site.id === siteId);
  if (!existingSite) return false;
  peopleStore.clientSites = peopleStore.clientSites.filter((site) => site.id !== siteId);
  persistPeopleStore();
  return true;
}

export function addClientRecord(client: ClientRecord) {
  rehydratePeopleStoreFromDisk();
  if (!peopleStore.clients.find((existing) => existing.id === client.id)) {
    peopleStore.clients = [client, ...peopleStore.clients];
    persistPeopleStore();
  }
  return client;
}

export function addClientSiteRecord(site: ClientSite) {
  rehydratePeopleStoreFromDisk();
  if (!peopleStore.clientSites.find((existing) => existing.id === site.id)) {
    peopleStore.clientSites = [site, ...peopleStore.clientSites];
    persistPeopleStore();
  }
  return site;
}

export function getAuditEvents(): AuditEvent[] {
  rehydratePeopleStoreFromDisk();
  const side = readAuditEventsSideStore();
  if (side.length) {
    peopleStore.auditEvents = side;
  }
  return peopleStore.auditEvents.map((event) => ({ ...event }));
}

export function appendAuditEvent(input: AuditEventInput): AuditEvent {
  rehydratePeopleStoreFromDisk();
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

  const next = [event, ...(Array.isArray(peopleStore.auditEvents) ? peopleStore.auditEvents : [])];
  // CRITICAL: do NOT call persistPeopleStore() here — that JSON.stringifies ~600KB+ of clients
  // on every Chris/Commercial/Carol tick and was HTML-502ing nexa-live under UI load.
  persistAuditEventsOnly(next);
  return { ...event };
}

export function resetWorkflowAuditEvents(): AuditEvent[] {
  rehydratePeopleStoreFromDisk();
  persistAuditEventsOnly([]);
  return [];
}

export type ClientStatus = "Active" | "Prospect" | "On hold";

export type ClientSite = {
  id: string;
  clientId: string;
  name: string;
  address: string;
  accessNotes: string;
  primaryContact: string;
  serviceLine: string;
  nextVisit: string;
};

export type ClientRecord = {
  id: string;
  name: string;
  accountReference: string;
  status: ClientStatus;
  primaryContact: string;
  email: string;
  phone: string;
  billingAddress: string;
  commercialOwner: string;
  notes: string;
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  recordType: string;
  recordId: string;
  summary: string;
  createdAt: string;
  source: string;
  importance: "normal" | "high";
};

export type AuditEventInput = Omit<AuditEvent, "id" | "createdAt"> & {
  createdAt?: string;
};

export const seedClients: ClientRecord[] = [
  {
    id: "client-northfield",
    name: "Northfield Properties",
    accountReference: "C-1042",
    status: "Active",
    primaryContact: "Donna Fraser",
    email: "donna@northfieldproperties.co.uk",
    phone: "+44 1224 555102",
    billingAddress: "12 Albyn Terrace, Aberdeen, AB10 1YP",
    commercialOwner: "Kerry Watson",
    notes: "Responsive landlord portfolio client with recurring boiler and maintenance work.",
  },
  {
    id: "client-morrison",
    name: "Morrison & Co.",
    accountReference: "C-1088",
    status: "Active",
    primaryContact: "Craig Morrison",
    email: "craig@morrisonco.com",
    phone: "+44 1224 665220",
    billingAddress: "42 Queen's Road, Aberdeen, AB15 4YE",
    commercialOwner: "Errol Watson",
    notes: "Commercial heating and office refurbishment customer with multi-site expansion plans.",
  },
  {
    id: "client-aberdeen-care",
    name: "Aberdeen Property Care",
    accountReference: "C-1095",
    status: "Prospect",
    primaryContact: "Leanne Bruce",
    email: "leanne@aberdeenpropertycare.co.uk",
    phone: "+44 1224 700880",
    billingAddress: "8 Rubislaw Den North, Aberdeen, AB15 4AL",
    commercialOwner: "Kerry Watson",
    notes: "Service-plan heavy prospect with annual compliance and reactive support demand.",
  },
];

export const seedClientSites: ClientSite[] = [
  {
    id: "site-hopetoun",
    clientId: "client-northfield",
    name: "Hopetoun Court",
    address: "10 Hopetoun Court, Aberdeen, AB10 6PL",
    accessNotes: "Caretaker holds keys between 08:00 and 16:00. Parking at rear lane.",
    primaryContact: "Donna Fraser",
    serviceLine: "Boiler service and reactive maintenance",
    nextVisit: "24 Jun 2026",
  },
  {
    id: "site-rubislaw",
    clientId: "client-aberdeen-care",
    name: "Rubislaw Park",
    address: "16 Rubislaw Park, Aberdeen, AB15 4DP",
    accessNotes: "Occupier must be called 30 mins before arrival.",
    primaryContact: "Leanne Bruce",
    serviceLine: "Heating fault investigation",
    nextVisit: "To be scheduled",
  },
  {
    id: "site-queens-road",
    clientId: "client-morrison",
    name: "Queen's Road Office",
    address: "42 Queen's Road, Aberdeen, AB15 4YE",
    accessNotes: "Reception signs engineers in. Loading bay open before 10:00.",
    primaryContact: "Craig Morrison",
    serviceLine: "Office heating upgrade",
    nextVisit: "23 Jun 2026",
  },
  {
    id: "site-westhill-yard",
    clientId: "client-northfield",
    name: "Westhill Yard Units",
    address: "Unit 4 Enterprise Drive, Westhill, AB32 6TQ",
    accessNotes: "Call site foreman for plant room access.",
    primaryContact: "Ross Macleod",
    serviceLine: "Annual gas and plant checks",
    nextVisit: "04 Jul 2026",
  },
];

export const seedAuditEvents: AuditEvent[] = [
  {
    id: "audit-001",
    actor: "Kerry Watson",
    action: "updated",
    recordType: "quote",
    recordId: "quote-2062",
    summary: "Quote Q-2062 moved from Sent to Accepted.",
    createdAt: "22 Jun 2026 09:14",
    source: "web",
    importance: "high",
  },
  {
    id: "audit-002",
    actor: "Scott Reid",
    action: "created",
    recordType: "purchase_request",
    recordId: "po-02",
    summary: "PO request created for J-1048 pump and control valve.",
    createdAt: "22 Jun 2026 13:20",
    source: "engineer app",
    importance: "normal",
  },
  {
    id: "audit-003",
    actor: "Errol Watson",
    action: "updated",
    recordType: "employee",
    recordId: "emp-errol",
    summary: "Employee rates and licences reviewed on employee card.",
    createdAt: "22 Jun 2026 14:06",
    source: "web",
    importance: "normal",
  },
];

const globalStore = globalThis as typeof globalThis & {
  __hubfloAuditEvents?: AuditEvent[];
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

function getAuditStore(): AuditEvent[] {
  if (!globalStore.__hubfloAuditEvents) {
    globalStore.__hubfloAuditEvents = clone(seedAuditEvents);
  }
  return globalStore.__hubfloAuditEvents;
}

export function getAuditEvents(): AuditEvent[] {
  return clone(getAuditStore());
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

  globalStore.__hubfloAuditEvents = [event, ...getAuditStore()];
  return clone(event);
}

"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType, type MouseEvent } from "react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  Gauge,
  HardHat,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  MapPin,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { checkInvoiceReadiness, type InvoiceReadinessInput } from "@hubflo/domain";
import { getOfficeAlerts, getOfficePoRequests } from "@/lib/engineer-data";
import type { Job, PurchaseRequest, PurchaseStatus, Quote, QuoteStatus } from "@/lib/workflow-data";
import {
  seedAuditEvents,
  seedClients,
  seedClientSites,
  type AuditEvent,
  type ClientRecord,
  type ClientSite,
} from "@/lib/people-seed-data";
import {
  employeeHeaderName,
  getAccessProfile,
  permissionHeaderName,
  roleChoices,
  roleHeaderName,
  type AccessOverride,
  type AccessProfile,
  type Employee as EmployeeCard,
  type EmployeeAvailability,
  type EmployeeDocument,
  type EmployeeEmergencyContact,
  type EmployeeLicense,
  type HubRole,
  type Weekday,
  weekDays,
} from "@/lib/access";

const invoiceReadiness = checkInvoiceReadiness({
  requiredTasks: { complete: 7, total: 8 },
  openBlockers: 1,
  unresolvedVariations: 1,
  completionNoteSubmitted: true,
  requiredPhotos: { complete: 4, total: 4 },
  requiredDocuments: { complete: 1, total: 1 },
  timesheetsSubmitted: true,
  materialCostsConfirmed: false,
  finalJobValueConfirmed: true,
} satisfies InvoiceReadinessInput);

type ModuleItem = {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  active?: boolean;
  subItems?: string[];
};

const STORAGE_KEYS = {
  clients: "hubflo:clients:v1",
  clientSites: "hubflo:client-sites:v1",
  jobs: "hubflo:jobs:v1",
  quotes: "hubflo:quotes:v1",
  leads: "hubflo:leads:v1",
  purchaseRequests: "hubflo:purchase-requests:v1",
  auditEvents: "hubflo:audit-events:v1",
  documentFolders: "hubflo:document-folders:v1",
  engineerFlow: "hubflo:engineer-flow:v1",
  flowCompletion: "hubflo:flow-completion:v1",
  quoteCostCentres: "hubflo:quote-cost-centres:v1",
  jobCostCentres: "hubflo:job-cost-centres:v1",
  jobReviews: "hubflo:job-reviews:v1",
  jobDeliveryEvents: "hubflo:job-delivery-events:v1",
  communications: "hubflo:communications:v1",
  invoices: "hubflo:invoices:v1",
  customCatalog: "hubflo:custom-catalog:v1",
} as const;

function safeLoadStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSaveStoredJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Optional persistence is best effort only.
  }
}

function normalizeClientIdentity(value: string) {
  return value.trim().toLowerCase();
}

type LeadCustomerMatch = {
  client: ClientRecord;
  matchScore: number;
  matchReason: string;
};

type CustomerLookupDraft = {
  clientId?: string;
  customerName: string;
  email?: string;
  phone?: string;
  address?: string;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, "");
}

function buildLeadCustomerMatches(draft: CustomerLookupDraft, clients: ClientRecord[], sites: ClientSite[]): LeadCustomerMatch[] {
  if (draft.clientId) return [];

  const draftName = normalizeClientIdentity(draft.customerName);
  const draftEmail = normalizeClientIdentity(draft.email ?? "");
  const draftPhone = normalizePhone(draft.phone ?? "");
  const draftAddress = normalizeClientIdentity(draft.address ?? "");

  if (![draftName, draftEmail, draftPhone, draftAddress].some((value) => value.length >= 2)) return [];

  const clientMatches = clients
    .map((client) => {
      let score = 0;
      const reasons: string[] = [];

      const clientName = normalizeClientIdentity(client.name);
      const clientEmail = normalizeClientIdentity(client.email);
      const clientPhone = normalizePhone(client.phone);
      const billingAddress = normalizeClientIdentity(client.billingAddress);

      if (draftEmail && clientEmail === draftEmail) {
        score += 100;
        reasons.push("email");
      }

      if (draftPhone && clientPhone && clientPhone === draftPhone) {
        score += 95;
        reasons.push("phone");
      }

      if (draftName) {
        if (clientName === draftName) {
          score += 90;
          reasons.push("exact name");
        } else if (clientName.includes(draftName) || draftName.includes(clientName)) {
          score += 55;
          reasons.push("partial name");
        }
      }

      if (draftAddress && billingAddress && billingAddress.includes(draftAddress)) {
        score += 25;
        reasons.push("billing address");
      }

      if (draftAddress) {
        const siteMatch = sites.find(
          (site) => site.clientId === client.id && normalizeClientIdentity(site.address).includes(draftAddress),
        );
        if (siteMatch) {
          score += 30;
          reasons.push(`site: ${siteMatch.name}`);
        }
      }

      if (score < 30) return null;

      return {
        client,
        matchScore: score,
        matchReason: reasons.join(", "),
      };
    })
    .filter((item): item is LeadCustomerMatch => item !== null)
    .sort((first, second) => second.matchScore - first.matchScore)
    .slice(0, 8);

  return clientMatches;
}

function makeClientReference(existingClients: ClientRecord[]) {
  const numbers = existingClients
    .map((client) => {
      const found = client.accountReference.match(/\d+/g)?.join("");
      return found ? Number(found) : 0;
    })
    .filter((number) => Number.isFinite(number));
  const next = Math.max(1000, ...numbers) + 1;
  return `C-${next}`;
}

function makeSiteName(address: string) {
  return (address.split(",")[0]?.trim() || "New site").slice(0, 64);
}

function resolveLeadCustomer(
  draft: LeadDraft,
  existingClients: ClientRecord[],
): ClientRecord | undefined {
  const draftName = normalizeClientIdentity(draft.customerName);
  const draftEmail = normalizeClientIdentity(draft.email);
  const draftPhone = normalizePhone(draft.phone);

  const emailMatch = existingClients.find((client) =>
    draftEmail && normalizeClientIdentity(client.email) === draftEmail,
  );
  if (emailMatch) return emailMatch;

  if (draftPhone) {
    const phoneMatch = existingClients.find((client) => normalizePhone(client.phone) === draftPhone);
    if (phoneMatch) return phoneMatch;
  }

  const nameMatch = existingClients.find(
    (client) => normalizeClientIdentity(client.name) === draftName || draftName.includes(normalizeClientIdentity(client.name)),
  );
  if (nameMatch) return nameMatch;

  return undefined;
}

function buildClientFromLead(draft: LeadDraft, clients: ClientRecord[]) {
  const address = draft.address.trim();
  const token = `${Date.now()}-${Math.round(Math.random() * 1000)}`;
  const newClient: ClientRecord = {
    id: `client-${token}`,
    name: draft.customerName.trim() || "New customer",
    accountReference: makeClientReference(clients),
    status: "Prospect",
    primaryContact: draft.customerName.trim(),
    email: draft.email.trim() || `${token}@example.com`,
    phone: draft.phone.trim() || "Pending",
    billingAddress: address || "Pending address",
    commercialOwner: "TBD",
    notes: "Created from lead intake.",
  };

  const newSite: ClientSite | undefined = address
        ? {
        id: `site-${token}`,
        clientId: newClient.id,
        name: makeSiteName(address),
        address,
        accessNotes: "To confirm before first visit.",
        primaryContact: draft.customerName.trim(),
        serviceLine: "New work",
        nextVisit: "To be scheduled",
      }
    : undefined;

  return { newClient, newSite };
}

function resolveLeadSiteFromDraft(
  draft: Pick<LeadDraft, "siteId" | "address" | "customerName">,
  client: ClientRecord | undefined,
  sites: ClientSite[],
) {
  if (draft.siteId) {
    const explicitSite = sites.find((site) =>
      site.id === draft.siteId && (!client || site.clientId === client.id),
    );
    if (explicitSite) return explicitSite;
  }

  if (!client) return undefined;

  return (
    sites.find((site) => site.clientId === client.id && normalizeClientIdentity(site.address) === normalizeClientIdentity(draft.address))
    ?? (draft.address
      ? {
          id: `site-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          clientId: client.id,
          name: makeSiteName(draft.address),
          address: draft.address,
          accessNotes: "To be confirmed before first visit.",
          primaryContact: draft.customerName,
          serviceLine: "New work",
          nextVisit: "To be scheduled",
        }
      : undefined)
  );
}

function leadMapEmbedUrl(address: string) {
  const query = encodeURIComponent(address.trim());
  return `https://www.google.com/maps?q=${query}&output=embed`;
}

function leadMapSearchUrl(address: string) {
  const query = encodeURIComponent(address.trim());
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

type HomeView =
  | "dashboard"
  | "leads"
  | "lead-record"
  | "schedule"
  | "settings"
  | "addons"
  | "employees"
  | "employee-card"
  | "clients"
  | "client-record"
  | "quote-record"
  | "invoices"
  | "invoice-record"
  | "job-record"
  | "quote-cost-centre-record"
  | "cost-centre-record";
type EmployeeTab = "details" | "licences" | "rates" | "emergency" | "availability" | "permissions";

type ClientTab = "overview" | "sites" | "history";
type LeadTab = "details" | "survey" | "documents" | "logs";
type JobDetailTab = "summary" | "cost-centres" | "engineer-flow" | "documents" | "variations" | "logs";
type QuoteDetailTab = "setup" | "cost-build" | "documents" | "preview" | "logs";
type InvoiceTab = "summary" | "lines" | "documents" | "logs";
type CostCentreTab = "summary" | "info" | "parts-labour" | "options" | "variations" | "schedule" | "assets";
type QuoteBuildTab = "summary" | "survey-tools" | "takeoff" | "catalogue" | "one-off" | "heat-loss" | "labour" | "supplier-request";
type InvoiceStatus = "Draft" | "Sent" | "Partially paid" | "Paid" | "Cancelled";
type WorkflowTrackerState = "done" | "current" | "waiting";

type WorkflowTrackerStage = {
  label: string;
  detail: string;
  state: WorkflowTrackerState;
};

const invoiceStatuses: InvoiceStatus[] = ["Draft", "Sent", "Partially paid", "Paid", "Cancelled"];

type PermissionRow = {
  key: keyof AccessProfile;
  label: string;
};

type QuoteDraft = {
  clientId: string;
  siteId: string;
  customer: string;
  phone: string;
  email: string;
  address: string;
  owner: string;
  description: string;
  status: QuoteStatus;
  value: string;
  next: string;
  due: string;
};

type JobDraft = {
  clientId: string;
  siteId: string;
  customer: string;
  phone: string;
  email: string;
  address: string;
  site: string;
  description: string;
  manager: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  value: string;
  next: string;
  due: string;
};

type OneOffMaterialDraft = {
  description: string;
  unitCost: string;
  markupPercent: string;
  unitSell: string;
  quantity: string;
};

type JobScheduleDraft = {
  manager: string;
  scheduledDate: string;
  scheduledTime: string;
};

type LeadSource = "Phone call" | "Checkatrade" | "Email" | "Website" | "Referral";
type LeadStatus = "New enquiry" | "Needs scheduling" | "Survey booked" | "Quoted" | "Lost";

type Lead = {
  id: string;
  ref: string;
  source: LeadSource;
  clientId?: string;
  siteId?: string;
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

type LeadCustomerMode = "existing" | "new";
type LeadDraft = Omit<Lead, "id" | "ref" | "createdAt" | "next"> & {
  customerMode: LeadCustomerMode;
};

type RecordDocumentScope = "lead" | "quote" | "job" | "invoice";
type InvoiceScopeType = "quote" | "job";

type InvoiceLine = {
  id: string;
  description: string;
  category: "Materials" | "Labour" | "Variations" | "Other";
  costToUs: number;
  chargeToClient: number;
  note?: string;
};

type Invoice = {
  id: string;
  ref: string;
  status: InvoiceStatus;
  sourceType: InvoiceScopeType;
  sourceId: string;
  sourceRef: string;
  sourceName: string;
  customer: string;
  issuedDate: string;
  dueDate: string;
  clientId?: string;
  siteId?: string;
  title: string;
  lines: InvoiceLine[];
  costTotal: number;
  chargeTotal: number;
  vatRate: number;
  notes: string;
  sentTo?: string;
  sentAt?: string;
  outlookMessageId?: string;
};

type InvoiceEmailDraft = {
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachPdf: boolean;
};

type JobReviewKey = "site" | "commercial" | "finance";
type JobReviewState = Record<JobReviewKey, boolean>;

const jobReviewChecks: Array<{ key: JobReviewKey; label: string; detail: string }> = [
  { key: "site", label: "Site completion", detail: "Engineer photos, notes, gas forms and customer sign-off checked." },
  { key: "commercial", label: "Commercial review", detail: "Timesheets, POs, variations and margin checked." },
  { key: "finance", label: "Finance approval", detail: "Invoice values, VAT and supporting documents checked." },
];

const emptyJobReviewState: JobReviewState = {
  site: false,
  commercial: false,
  finance: false,
};

function invoiceTotalFromLines(lines: InvoiceLine[]) {
  return lines.reduce(
    (acc, line) => {
      acc.cost += line.costToUs;
      acc.charge += line.chargeToClient;
      return acc;
    },
    { cost: 0, charge: 0 },
  );
}

function buildInvoiceRef(prefix: "invoice", existing: string[]) {
  const refNumbers = existing
    .map((value) => Number(value.replace(/\D/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  const next = Math.max(3000, ...refNumbers) + 1;
  if (prefix === "invoice") return `INV-${next}`;
  return `${next}`;
}

function makeInvoiceFromQuote(
  quote: Quote,
  client: ClientRecord | null,
  sourceCentres: QuoteCostCentre[],
  existingRef: Invoice[],
): Invoice {
  const createdOn = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const lines: InvoiceLine[] = sourceCentres.flatMap((centre) => {
    const totals = quoteCostCentreTotals(centre);
    const centreName = centre.name;
    return [
      {
        id: `inv-${centre.id}-materials`,
        description: `${centreName} materials`,
        category: "Materials" as const,
        costToUs: totals.materialCost,
        chargeToClient: totals.materialSell,
        note: centre.templateName ?? "Cost centre materials",
      },
      {
        id: `inv-${centre.id}-labour`,
        description: `${centreName} labour`,
        category: "Labour" as const,
        costToUs: totals.labourCost,
        chargeToClient: totals.labourSell,
        note: centre.templateName ?? "Cost centre labour",
      },
    ];
  }).filter((line) => line.costToUs > 0 || line.chargeToClient > 0);

  const aggregated = lines.reduce(
    (acc, line) => ({
      cost: acc.cost + line.costToUs,
      charge: acc.charge + line.chargeToClient,
    }),
    { cost: 0, charge: 0 },
  );

  return {
    id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    ref: buildInvoiceRef("invoice", existingRef.map((item) => item.ref)),
    status: "Draft",
    sourceType: "quote",
    sourceId: quote.id,
    sourceRef: quote.ref,
    sourceName: `Quote ${quote.ref}`,
    customer: quote.customer,
    issuedDate: createdOn,
    dueDate,
    clientId: client?.id,
    siteId: quote.siteId,
    title: `Invoice for ${quote.ref}`,
    lines,
    costTotal: aggregated.cost,
    chargeTotal: aggregated.charge,
    vatRate: 20,
    notes: `Created from ${quote.ref} cost centres.`,
  };
}

function buildInvoiceLineTotalsFromEstimate(centres: EstimateCostCentre[]) {
  const totals = centres
    .flatMap((centre) => {
      const centreTotals = estimateCostCentreTotals(centre);
      return [
        {
          id: `${centre.id}-materials`,
          description: `${centre.name} materials`,
          category: "Materials" as const,
          costToUs: centreTotals.materialCost,
          chargeToClient: centreTotals.materialSell,
          note: centre.templateName ?? "Cost centre",
        },
        {
          id: `${centre.id}-labour`,
          description: `${centre.name} labour`,
          category: "Labour" as const,
          costToUs: centreTotals.labourCost,
          chargeToClient: centreTotals.labourSell,
          note: centre.templateName ?? "Cost centre",
        },
      ];
    })
    .filter((line) => line.costToUs > 0 || line.chargeToClient > 0);

  return totals;
}

function makeInvoiceFromJobTotals(
  job: Job,
  client: ClientRecord | null,
  totalsBySource: { cost: number; charge: number; lineItems: InvoiceLine[] },
  existingRef: Invoice[],
  variations: JobVariation[],
): Invoice {
  const createdOn = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const billedVariations = variations.filter((variation) => isBillableVariationStatus(variation.status));
  const variationLineTotalCost = sumMoney(billedVariations, "costValue");
  const variationLineTotalSell = sumMoney(billedVariations, "sellValue");
  const variationLines: InvoiceLine[] = billedVariations.length
    ? [
        {
          id: `inv-${Date.now()}-variations`,
          description: `${job.ref} approved variations`,
          category: "Variations",
          costToUs: variationLineTotalCost,
          chargeToClient: variationLineTotalSell,
          note: `${billedVariations.length} approved variation line item(s) included.`,
        },
      ]
    : [];

  const lines = [...totalsBySource.lineItems, ...variationLines];
  const costTotal = totalsBySource.cost + variationLineTotalCost;
  const chargeTotal = totalsBySource.charge + variationLineTotalSell;

  return {
    id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    ref: buildInvoiceRef("invoice", existingRef.map((item) => item.ref)),
    status: "Draft",
    sourceType: "job",
    sourceId: job.id,
    sourceRef: job.ref,
    sourceName: `Job ${job.ref}`,
    customer: job.customer,
    issuedDate: createdOn,
    dueDate,
    clientId: client?.id,
    siteId: job.siteId,
    title: `Invoice for ${job.ref} · ${job.status}`,
    lines,
    costTotal,
    chargeTotal,
    vatRate: 20,
    notes: `${job.description} captured from cost centres for invoicing.`,
  };
}

function makeInvoiceEmailDraft(invoice: Invoice, client?: ClientRecord | null): InvoiceEmailDraft {
  const contactName = client?.primaryContact?.split(" ")[0] || "there";
  return {
    to: client?.email ?? "",
    cc: "",
    subject: `${invoice.ref} - ${invoice.title}`,
    body: `Hi ${contactName},\n\nPlease find attached invoice ${invoice.ref} for ${invoice.title}.\n\nTotal due including VAT: ${currency(invoice.chargeTotal * (1 + invoice.vatRate / 100))}.\n\nKind regards,\nVerrova`,
    attachPdf: true,
  };
}

type DocumentVisibility = "Private" | "Engineer" | "Client";

type DocumentFolderTemplate = {
  id: string;
  name: string;
  description: string;
  recordTypes: RecordDocumentScope[];
  defaultVisibility: DocumentVisibility;
};

type RecordDocumentFile = {
  folderId: string;
  name: string;
  type: string;
  visibility: DocumentVisibility;
  linkedTo: string;
};

type EngineerFlowEvidence = "Photo" | "Text" | "Number" | "Signature" | "Checkbox";

type EngineerFlowStep = {
  id: string;
  stage: "Existing Boiler" | "New Boiler" | "Commissioning" | "Handover";
  label: string;
  evidence: EngineerFlowEvidence;
  required: boolean;
};

type EngineerFlowTemplate = {
  id: string;
  name: string;
  appliesTo: string[];
  steps: EngineerFlowStep[];
};

type JobCostCentre = {
  key: string;
  label: string;
  budget: number;
  committed: number;
  actual: number;
  items: Array<{
    label: string;
    detail: string;
    value: number;
  }>;
};

type JobVariation = {
  id: string;
  reference: string;
  title: string;
  status: "Detected" | "Quote drafted" | "Sent for approval" | "Client approved" | "Proceed" | "Priced" | "Approved" | "Rejected";
  costValue: number;
  sellValue: number;
  description?: string;
  reason?: string;
  labourHours?: number;
  materialsUsed?: string;
  requiresClientApproval?: boolean;
  clientApprovalStatus?: "Not sent" | "Sent" | "Viewed" | "Approved" | "Declined";
  engineerName?: string;
  portalToken?: string;
  source: "seed" | "event";
};

type JobDeliveryKind = "whatsapp" | "attendance" | "timesheet" | "variation" | "po";

type JobDeliveryEvent = {
  id: string;
  jobId: string;
  jobRef: string;
  kind: JobDeliveryKind;
  actor: string;
  summary: string;
  createdAt: string;
  hours?: number;
  materials?: string;
  costValue?: number;
  sellValue?: number;
  reason?: string;
  requiresClientApproval?: boolean;
  clientApprovalStatus?: "Not sent" | "Sent" | "Viewed" | "Approved" | "Declined";
  status?: string;
  portalToken?: string;
  source: "Verrova" | "WhatsApp" | "Engineer app";
};

type JobDeliveryDraft = {
  whatsappNote: string;
  timesheetHours: string;
  timesheetNote: string;
  variationDescription: string;
  variationHours: string;
  variationMaterials: string;
  variationCost: string;
  variationSell: string;
  poSupplier: string;
  poItem: string;
  poEstimatedCost: string;
  poReason: string;
};

const blankJobDeliveryDraft: JobDeliveryDraft = {
  whatsappNote: "",
  timesheetHours: "",
  timesheetNote: "",
  variationDescription: "",
  variationHours: "",
  variationMaterials: "",
  variationCost: "",
  variationSell: "",
  poSupplier: "",
  poItem: "",
  poEstimatedCost: "",
  poReason: "",
};

type CatalogItem = {
  id: string;
  type: "Labour" | "Material" | "Plant" | "Subcontractor";
  name: string;
  unit: string;
  costRate: number;
  sellRate: number;
  category?: string;
};

type QuoteCostLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell: number;
  supplierRequired?: boolean;
};

type SupplierQuoteDraft = {
  supplier: string;
  contactEmail?: string;
  subject?: string;
  message?: string;
  fileName: string;
  markupPercent: number;
  lines: QuoteCostLine[];
  sentAt?: string;
};

type HeatLossRoom = {
  id: string;
  name: string;
  roomType: string;
  length: string | number;
  width: string | number;
  height: string | number;
  exteriorWalls: number;
  wallType: string;
  glazingType: string;
  windowArea: string | number;
  floorType: string;
  ceilingType: string;
  heatingSystemType: "Hydronic" | "Electric";
  meanWaterTemperature: string | number;
  preferredRange: string;
  selectedRadiatorId?: string;
  markupPercent: string | number;
};

type QuoteReviewQuestion = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  action: "cost-build" | "open-centre" | "none";
  centreId?: string;
};

type QuoteDocumentLayout = "quote" | "job-sheet" | "application-payment" | "invoice";

type QuoteEmailDraft = {
  to: string;
  cc: string;
  subject: string;
  body: string;
  layout: QuoteDocumentLayout;
  attachPdf: boolean;
};

type CommunicationRecordType = "lead" | "quote" | "job" | "invoice";
type CommunicationDirection = "outbound" | "inbound";

type CommunicationRecord = {
  id: string;
  recordType: CommunicationRecordType;
  recordId: string;
  relatedJobId?: string;
  direction: CommunicationDirection;
  channel: "Outlook" | "Client portal" | "WhatsApp";
  subject: string;
  body: string;
  from: string;
  to: string;
  cc?: string;
  createdAt: string;
  messageId?: string;
  status: "Sent" | "Received" | "Captured";
};

type CommunicationDraft = {
  from: string;
  subject: string;
  body: string;
};

const blankCommunicationDraft: CommunicationDraft = {
  from: "",
  subject: "",
  body: "",
};

type TakeoffBoqRow = {
  id: string;
  source: "Takeoff" | "BOQ";
  section: string;
  description: string;
  quantity: number;
  unit: string;
  supplierRequired: boolean;
  unitCost: number;
  markupPercent: number;
};

type TakeoffDocumentKind = "Drawings" | "Specification" | "Contractor BOQ";

type TakeoffSourceDocument = {
  id: string;
  kind: TakeoffDocumentKind;
  fileName: string;
  status: "Uploaded" | "Draft extracted" | "Needs review";
  confidence: "High" | "Medium" | "Low";
  extractedAt: string;
  questions: string[];
};

type SurveyAssetKind = "Room scan" | "Survey photo" | "Concept look";

type SurveyAsset = {
  id: string;
  kind: SurveyAssetKind;
  title: string;
  detail: string;
  status: "Draft" | "Review" | "Ready";
  clientVisible: boolean;
  createdAt: string;
};

type QuoteCostCentre = {
  id: string;
  name: string;
  templateName?: string;
  clientDescription?: string;
  engineerDescription?: string;
  lines: QuoteCostLine[];
  heatLossRooms?: HeatLossRoom[];
  takeoffRows?: TakeoffBoqRow[];
  takeoffDocuments?: TakeoffSourceDocument[];
  surveyAssets?: SurveyAsset[];
};

type EstimateMaterialLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

type EstimateLabourLine = {
  id: string;
  role: string;
  hours: number;
  costRate: number;
  markupPercent: number;
};

type EstimateCostCentre = {
  id: string;
  name: string;
  templateName?: string;
  clientDescription: string;
  engineerDescription: string;
  materials: EstimateMaterialLine[];
  labour: EstimateLabourLine[];
  surveyAssets?: SurveyAsset[];
};

type SurveyPackCentre = {
  id: string;
  name: string;
  surveyAssets?: SurveyAsset[];
};

type JobReadinessItem = {
  label: string;
  detail: string;
  complete: boolean;
  optional?: boolean;
};

type HubDetailStatePayload = {
  documentFolderTemplates?: DocumentFolderTemplate[];
  engineerFlowTemplate?: EngineerFlowTemplate;
  flowStepCompletion?: Record<string, boolean>;
  quoteCostCentres?: Record<string, QuoteCostCentre[]>;
  customQuoteCatalog?: CatalogItem[];
  jobCostCentres?: Record<string, EstimateCostCentre[]>;
  jobReviews?: Record<string, JobReviewState>;
  jobDeliveryEvents?: JobDeliveryEvent[];
  communications?: CommunicationRecord[];
  invoices?: Invoice[];
};

type EmployeeLicenseDraft = EmployeeLicense & { id: string };
type EmployeeDocumentDraft = EmployeeDocument & { id: string };
type EmployeeEmergencyContactDraft = EmployeeEmergencyContact & { id: string };

type EmployeeProfileDraft = {
  name: string;
  email: string;
  phone: string;
  address: string;
  startDate: string;
  roleLabel: string;
  hourlyRate: string;
  overtimeRate: string;
  niMultiplier: string;
  pensionPercent: string;
  dailyToolAllowance: string;
  employmentCostNote: string;
  licenses: EmployeeLicenseDraft[];
  documents: EmployeeDocumentDraft[];
  emergencyContacts: EmployeeEmergencyContactDraft[];
  availability: EmployeeAvailability;
  bankSortCode: string;
  bankAccountNumber: string;
};

const modules: ModuleItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Leads", icon: Mail },
  { label: "Quotes", icon: FileText },
  { label: "Jobs", icon: Wrench },
  { label: "Schedules", icon: CalendarDays },
  { label: "Invoices", icon: CircleDollarSign },
  { label: "Add-ons", icon: Sparkles },
  { label: "People", icon: Users, subItems: ["Employees", "Clients", "Suppliers"] },
  { label: "Setup", icon: Settings },
];

const sideNavigation = [
  { label: "Overview", icon: Gauge, active: true },
  { label: "My work", icon: ListChecks, badge: 6 },
  { label: "Operations", icon: HardHat },
  { label: "Communications", icon: Inbox, badge: 3 },
  { label: "Reports", icon: ClipboardCheck },
];

const permissionOptions: PermissionRow[] = [
  { key: "showCustomers", label: "Customer visibility" },
  { key: "showJobs", label: "Job visibility" },
  { key: "showQuotes", label: "Quote visibility" },
  { key: "showAssets", label: "Asset visibility" },
  { key: "showStock", label: "Stock visibility" },
  { key: "showFinance", label: "Finance visibility" },
  { key: "showSchedule", label: "Schedule visibility" },
  { key: "canCreateJob", label: "Create jobs" },
  { key: "canCreateQuote", label: "Create quotes" },
  { key: "canCreateLead", label: "Create leads" },
  { key: "canEditJobs", label: "Edit jobs" },
  { key: "canDeleteJobs", label: "Delete jobs" },
  { key: "canRequestPurchase", label: "Request POs" },
  { key: "canApprovePurchase", label: "Approve POs" },
  { key: "canCustomize", label: "Customise dashboard" },
  { key: "canEditInvoice", label: "Edit invoices" },
];

const employeeTabs: Array<{ key: EmployeeTab; label: string }> = [
  { key: "details", label: "Details" },
  { key: "licences", label: "Licences & files" },
  { key: "rates", label: "Rates" },
  { key: "emergency", label: "Emergency" },
  { key: "availability", label: "Availability" },
  { key: "permissions", label: "Access" },
];

const clientTabs: Array<{ key: ClientTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "sites", label: "Sites" },
  { key: "history", label: "History" },
];

const leadTabs: Array<{ key: LeadTab; label: string }> = [
  { key: "details", label: "Details" },
  { key: "survey", label: "Survey booking" },
  { key: "documents", label: "Documents" },
  { key: "logs", label: "Logs" },
];

const jobDetailTabs: Array<{ key: JobDetailTab; label: string }> = [
  { key: "summary", label: "Details" },
  { key: "cost-centres", label: "Cost Centre List" },
  { key: "engineer-flow", label: "Engineer Flow" },
  { key: "documents", label: "Documents" },
  { key: "logs", label: "Logs" },
];

const quoteDetailTabs: Array<{ key: QuoteDetailTab; label: string }> = [
  { key: "setup", label: "Details" },
  { key: "cost-build", label: "Cost Centre List" },
  { key: "documents", label: "Documents" },
  { key: "preview", label: "Send & Forms" },
  { key: "logs", label: "Logs" },
];

const invoiceTabs: Array<{ key: InvoiceTab; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "lines", label: "Lines" },
  { key: "documents", label: "Documents" },
  { key: "logs", label: "Logs" },
];

const documentLayouts: Array<{ key: QuoteDocumentLayout; label: string; detail: string }> = [
  { key: "quote", label: "Quote", detail: "Client-facing scope, cost centres and acceptance total." },
  { key: "job-sheet", label: "Job sheet", detail: "Engineer view with site, scope and operational notes." },
  { key: "application-payment", label: "Application for payment", detail: "Progress claim layout for staged commercial works." },
  { key: "invoice", label: "Invoice", detail: "Final billing layout using approved job or quote totals." },
];

const quoteCostCentreTabs: Array<{ key: CostCentreTab; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "info", label: "Info" },
  { key: "parts-labour", label: "Parts & Labour" },
  { key: "options", label: "Options" },
  { key: "schedule", label: "Schedule" },
  { key: "assets", label: "Customer Assets" },
];

const jobCostCentreTabs: Array<{ key: CostCentreTab; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "info", label: "Info" },
  { key: "parts-labour", label: "Parts & Labour" },
  { key: "variations", label: "Variations" },
  { key: "schedule", label: "Schedule" },
  { key: "assets", label: "Customer Assets" },
];

const quoteBuildTabs: Array<{ key: QuoteBuildTab; label: string }> = [
  { key: "summary", label: "Scope summary" },
  { key: "catalogue", label: "Catalogue" },
  { key: "one-off", label: "One-off items" },
  { key: "heat-loss", label: "Heat loss calculator" },
  { key: "labour", label: "Labour" },
  { key: "supplier-request", label: "Supplier request" },
];

const costCentreTemplates = [
  "Bathroom refurbishment",
  "Boiler servicing",
  "Boiler replacement",
  "General plumbing",
  "Heating remedials",
  "Reactive maintenance",
];

const defaultDocumentFolderTemplates: DocumentFolderTemplate[] = [
  {
    id: "drawings",
    name: "Drawings",
    description: "Plans, marked-up drawings and takeoff files.",
    recordTypes: ["lead", "quote", "job", "invoice"],
    defaultVisibility: "Engineer",
  },
  {
    id: "bill-of-quantities",
    name: "Bill of Quantities",
    description: "Imported BOQ, takeoff exports and reviewed quantity schedules.",
    recordTypes: ["quote", "job", "invoice"],
    defaultVisibility: "Private",
  },
  {
    id: "supplier-quotes",
    name: "Supplier Quotes",
    description: "Supplier PDFs and material pricing used to build quote costs.",
    recordTypes: ["quote", "job", "invoice"],
    defaultVisibility: "Private",
  },
  {
    id: "survey-photos",
    name: "Survey Photos",
    description: "Photos captured during lead/quote survey visits.",
    recordTypes: ["lead", "quote", "job", "invoice"],
    defaultVisibility: "Engineer",
  },
  {
    id: "mid-work-photos",
    name: "Mid Work Photos",
    description: "In-progress evidence and hidden works records.",
    recordTypes: ["job"],
    defaultVisibility: "Engineer",
  },
  {
    id: "completion-photos",
    name: "Completion Photos",
    description: "Final photos required before completion or invoicing.",
    recordTypes: ["job"],
    defaultVisibility: "Client",
  },
  {
    id: "forms-certificates",
    name: "Forms & Certificates",
    description: "Gas forms, commissioning sheets, completion forms and certificates.",
    recordTypes: ["job", "invoice"],
    defaultVisibility: "Engineer",
  },
  {
    id: "private-office",
    name: "Private Office",
    description: "Margin notes, internal tenders and office-only documents.",
    recordTypes: ["lead", "quote", "job", "invoice"],
    defaultVisibility: "Private",
  },
  {
    id: "engineer-pack",
    name: "Engineer Pack",
    description: "Approved documents that engineers can access from the app.",
    recordTypes: ["job", "invoice"],
    defaultVisibility: "Engineer",
  },
];

const defaultBoilerFlowTemplate: EngineerFlowTemplate = {
  id: "boiler-replacement-flow",
  name: "Boiler replacement stop/go flow",
  appliesTo: ["Boiler replacement", "Boiler servicing"],
  steps: [
    { id: "existing-photo", stage: "Existing Boiler", label: "Upload photos of existing boiler", evidence: "Photo", required: true },
    { id: "existing-make-model", stage: "Existing Boiler", label: "Enter existing boiler make/model", evidence: "Text", required: true },
    { id: "existing-serial", stage: "Existing Boiler", label: "Record existing boiler serial number if visible", evidence: "Text", required: true },
    { id: "existing-location", stage: "Existing Boiler", label: "Confirm existing boiler location", evidence: "Text", required: true },
    { id: "existing-flue", stage: "Existing Boiler", label: "Confirm existing flue type/location", evidence: "Text", required: true },
    { id: "new-photo", stage: "New Boiler", label: "Upload photos of installed boiler", evidence: "Photo", required: true },
    { id: "new-make-model", stage: "New Boiler", label: "Enter new boiler make/model", evidence: "Text", required: true },
    { id: "new-serial", stage: "New Boiler", label: "Enter new boiler serial number", evidence: "Text", required: true },
    { id: "new-location", stage: "New Boiler", label: "Confirm new boiler location", evidence: "Text", required: true },
    { id: "commissioning", stage: "Commissioning", label: "Complete commissioning readings", evidence: "Number", required: true },
    { id: "benchmark", stage: "Commissioning", label: "Complete benchmark/compliance checklist", evidence: "Checkbox", required: true },
    { id: "customer-handover", stage: "Handover", label: "Customer handover and sign-off", evidence: "Signature", required: true },
  ],
};

const blankEmployeeAvailability = weekDays.reduce((acc, day) => {
  acc[day] = { active: false, from: "09:00", to: "17:00" };
  return acc;
}, {} as EmployeeAvailability);

const seedEmployees: EmployeeCard[] = [
  {
    id: "emp-errol",
    name: "Errol Watson",
    role: "Manager",
    permissions: {},
    profile: {
      email: "errol@errolwatsongroup.com",
      phone: "+44 7481 123456",
      address: "27 Westhill Road, Aberdeen, AB15 6RH",
      startDate: "2019-03-11",
      payroll: {
        hourlyRate: 0,
        overtimeRate: 0,
        niMultiplier: 0.124,
        pensionPercent: 3,
        dailyToolAllowance: 0,
      },
      roleLabel: "Operations Lead",
      licenses: [
        {
          id: "lic-001",
          type: "Car licence",
          reference: "CAR-88123",
          expiresOn: "2027-01-12",
          status: "Current",
          attachmentFileName: "Errol-Driving-Licence.pdf",
          attachmentUploadedAt: "2025-04-12",
        },
      ],
      documents: [
        {
          id: "doc-001",
          label: "Employment contract",
          fileName: "Errol-Employment-Contract.pdf",
          uploadedAt: "2025-04-12",
        },
      ],
      emergencyContacts: [
        {
          id: "contact-001",
          name: "Alex Watson",
          relationship: "Spouse",
          phone: "+44 7422 009900",
        },
      ],
      bankDetails: {
        sortCode: "40-20-10",
        accountNumber: "00123456",
      },
      availability: {
        ...blankEmployeeAvailability,
        Mon: { active: true, from: "07:30", to: "16:30" },
        Tue: { active: true, from: "07:30", to: "16:30" },
        Wed: { active: true, from: "07:30", to: "16:30" },
        Thu: { active: true, from: "07:30", to: "16:30" },
        Fri: { active: true, from: "07:30", to: "16:30" },
      },
      employmentCostNote: "Manager overhead included in allocation.",
    },
  },
  {
    id: "emp-kerry",
    name: "Kerry Watson",
    role: "Finance",
    permissions: {},
    profile: {
      email: "kerry@errolwatsongroup.com",
      phone: "+44 7481 223344",
      address: "2 Albyn Place, Aberdeen, AB10 1AH",
      startDate: "2020-01-06",
      payroll: {
        hourlyRate: 0,
        overtimeRate: 0,
        niMultiplier: 0.124,
        pensionPercent: 3,
        dailyToolAllowance: 0,
      },
      roleLabel: "Finance Controller",
      licenses: [],
      documents: [
        {
          id: "doc-002",
          label: "Employment contract",
          fileName: "Kerry-Employment-Contract.pdf",
          uploadedAt: "2025-07-01",
        },
      ],
      emergencyContacts: [
        {
          id: "contact-002",
          name: "Sam Watson",
          relationship: "Sibling",
          phone: "+44 7500 445566",
        },
      ],
      bankDetails: {
        sortCode: "40-20-10",
        accountNumber: "11223344",
      },
      availability: {
        ...blankEmployeeAvailability,
        Mon: { active: true, from: "08:30", to: "17:30" },
        Tue: { active: true, from: "08:30", to: "17:30" },
        Wed: { active: true, from: "08:30", to: "17:30" },
        Thu: { active: true, from: "08:30", to: "17:30" },
        Fri: { active: true, from: "08:30", to: "16:30" },
      },
      employmentCostNote: "Fixed salary role with central cost allocation.",
    },
  },
  {
    id: "emp-scott",
    name: "Scott Reid",
    role: "Engineer",
    permissions: {
      showQuotes: false,
      showFinance: false,
      showAssets: false,
      showStock: false,
    },
    profile: {
      email: "scott@errolwatsongroup.com",
      phone: "+44 7700 445544",
      address: "Aberdeen City, Aberdeen, AB11 5RR",
      startDate: "2022-08-18",
      payroll: {
        hourlyRate: 31.5,
        overtimeRate: 45,
        niMultiplier: 0.124,
        pensionPercent: 3,
        dailyToolAllowance: 18,
      },
      roleLabel: "Senior Field Engineer",
      licenses: [
        {
          id: "lic-003",
          type: "Gas Safe",
          reference: "GS-5534-22",
          expiresOn: "2026-11-03",
          status: "Current",
          attachmentFileName: "Scott-Gas-Safe.pdf",
          attachmentUploadedAt: "2024-08-12",
        },
        {
          id: "lic-004",
          type: "IPAF",
          reference: "IPAF-7721",
          expiresOn: "2027-06-01",
          status: "Current",
          attachmentFileName: "Scott-IPAF.pdf",
          attachmentUploadedAt: "2024-08-12",
        },
      ],
      documents: [
        {
          id: "doc-003",
          label: "Employment contract",
          fileName: "Scott-Contract.pdf",
          uploadedAt: "2023-01-15",
        },
        {
          id: "doc-004",
          label: "Driving licence",
          fileName: "Scott-Driving-Licence.pdf",
          uploadedAt: "2024-08-12",
        },
      ],
      emergencyContacts: [
        {
          id: "contact-003",
          name: "Leigh Reid",
          relationship: "Partner",
          phone: "+44 7700 778899",
        },
      ],
      bankDetails: {
        sortCode: "11-22-33",
        accountNumber: "77665544",
      },
      availability: {
        ...blankEmployeeAvailability,
        Mon: { active: true, from: "06:30", to: "15:30" },
        Tue: { active: true, from: "06:30", to: "15:30" },
        Wed: { active: true, from: "06:30", to: "15:30" },
        Thu: { active: true, from: "06:30", to: "15:30" },
        Fri: { active: true, from: "06:30", to: "14:30" },
      },
      employmentCostNote: "Site allowance applies for remote jobs.",
    },
  },
  {
    id: "emp-jamie",
    name: "Jamie Fox",
    role: "Office",
    permissions: {
      showFinance: false,
    },
    profile: {
      email: "jamie@errolwatsongroup.com",
      phone: "+44 7900 665544",
      address: "Broughty Ferry, Dundee, DD5 1AA",
      startDate: "2021-04-01",
      payroll: {
        hourlyRate: 28,
        overtimeRate: 40,
        niMultiplier: 0.124,
        pensionPercent: 3,
        dailyToolAllowance: 12,
      },
      roleLabel: "Office Coordinator",
      licenses: [],
      documents: [
        {
          id: "doc-005",
          label: "Employment contract",
          fileName: "Jamie-Contract.pdf",
          uploadedAt: "2024-03-02",
        },
      ],
      emergencyContacts: [
        {
          id: "contact-004",
          name: "Morgan Fox",
          relationship: "Sibling",
          phone: "07800 112233",
        },
      ],
      bankDetails: {
        sortCode: "20-11-22",
        accountNumber: "88990011",
      },
      availability: {
        ...blankEmployeeAvailability,
        Mon: { active: true, from: "08:00", to: "17:00" },
        Tue: { active: true, from: "08:00", to: "17:00" },
        Wed: { active: true, from: "08:00", to: "17:00" },
        Thu: { active: true, from: "08:00", to: "17:00" },
        Fri: { active: true, from: "08:00", to: "14:00" },
      },
      employmentCostNote: "Works across office support and ops admin.",
    },
  },
];

const seedJobs: Job[] = [
  {
    id: "job-1048",
    ref: "J-1048",
    customer: "Northfield Properties",
    site: "10 Hopetoun Court, Aberdeen",
    description: "Boiler service and remedial works",
    manager: "Errol Watson",
    status: "Waiting on parts",
    health: "red",
    value: 2840,
    next: "Order pump valves",
    due: "Today",
  },
  {
    id: "job-1052",
    ref: "J-1052",
    customer: "Morrison & Co.",
    site: "42 Queen's Road, Aberdeen",
    description: "Office heating upgrade",
    manager: "Kerry Watson",
    status: "In progress",
    health: "green",
    value: 18900,
    next: "Engineer visit",
    due: "Tomorrow",
  },
  {
    id: "job-1056",
    ref: "J-1056",
    customer: "A. Davidson",
    site: "7 Cairn View, Westhill",
    description: "Bathroom installation",
    manager: "Errol Watson",
    status: "Approval required",
    health: "amber",
    value: 9450,
    next: "Review variation V-003",
    due: "Today",
  },
  {
    id: "job-1041",
    ref: "J-1041",
    customer: "Granite Developments",
    site: "Plot 18, Kings Park",
    description: "First and second fix plumbing",
    manager: "Kerry Watson",
    status: "Ready to invoice",
    health: "green",
    value: 24760,
    next: "Raise final invoice",
    due: "Today",
  },
  {
    id: "job-1039",
    ref: "J-1039",
    customer: "Aberdeen Property Care",
    site: "16 Rubislaw Park",
    description: "Heating fault investigation",
    manager: "Errol Watson",
    status: "Scheduled",
    health: "blue",
    value: 1260,
    next: "Attend site",
    due: "24 Jun",
  },
];

const seedQuotes: Quote[] = [
  {
    id: "quote-2061",
    ref: "Q-2061",
    customer: "Northfield Properties",
    description: "Boiler replacement package",
    owner: "Errol Watson",
    status: "Sent",
    value: 4200,
    next: "Await customer signature",
    due: "Today",
  },
  {
    id: "quote-2062",
    ref: "Q-2062",
    customer: "Morrison & Co.",
    description: "Office heating balancing",
    owner: "Kerry Watson",
    status: "Accepted",
    value: 9300,
    next: "Create job and schedule",
    due: "Today",
  },
  {
    id: "quote-2063",
    ref: "Q-2063",
    customer: "Aberdeen Property Care",
    description: "Annual service plan extension",
    owner: "Errol Watson",
    status: "Declined",
    value: 1800,
    next: "Awaiting re-quote request",
    due: "Tomorrow",
  },
];

const seedLeads: Lead[] = [
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
    surveyor: "Chris Watson",
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

const seedPurchaseRequests: PurchaseRequest[] = [
  {
    id: "po-01",
    jobId: "job-1056",
    jobRef: "J-1056",
    requestedBy: "Engineer Jamie",
    supplier: "Aldrite Plumbing Ltd",
    item: "Pipes and fittings for bathroom line work",
    estimatedCost: 780,
    reason: "Need additional fittings for non-standard route",
    status: "Approved",
    poNumber: "PO-1003",
    createdAt: "Today",
  },
  {
    id: "po-02",
    jobId: "job-1048",
    jobRef: "J-1048",
    requestedBy: "Engineer Scott",
    supplier: "Valve Source",
    item: "Pump and control valve",
    estimatedCost: 420,
    reason: "Pump failed, no stock equivalent available",
    status: "Requested",
    poNumber: "",
    createdAt: "13:20",
  },
];

const jobStatuses = [
  "Enquiry",
  "Quoted",
  "Accepted",
  "Pending",
  "Scheduled",
  "In progress",
  "Waiting on parts",
  "Waiting on customer",
  "Approval required",
  "Completed",
  "Ready to invoice",
  "Invoiced",
  "Closed",
];

const quoteStatuses: QuoteStatus[] = [
  "Draft",
  "Sent",
  "Accepted",
  "Declined",
  "Converted",
  "Lost",
];

const leadSources: LeadSource[] = ["Phone call", "Checkatrade", "Email", "Website", "Referral"];
const leadStatuses: LeadStatus[] = ["New enquiry", "Needs scheduling", "Survey booked", "Quoted", "Lost"];
const surveyorOptions = ["Brian Kerr", "Chris Watson", "Errol Watson", "Kerry Watson"];
const surveyDurationMinutes = 60;
const surveyorAvailability: Record<string, EmployeeAvailability> = {
  "Brian Kerr": {
    Mon: { active: true, from: "08:00", to: "17:00" },
    Tue: { active: true, from: "08:00", to: "17:00" },
    Wed: { active: true, from: "08:00", to: "17:00" },
    Thu: { active: true, from: "08:00", to: "17:00" },
    Fri: { active: true, from: "08:00", to: "15:00" },
    Sat: { active: false, from: "00:00", to: "00:00" },
    Sun: { active: false, from: "00:00", to: "00:00" },
  },
  "Kerry Watson": {
    Mon: { active: true, from: "08:00", to: "17:00" },
    Tue: { active: true, from: "08:00", to: "17:00" },
    Wed: { active: true, from: "08:00", to: "17:00" },
    Thu: { active: true, from: "08:00", to: "17:00" },
    Fri: { active: true, from: "08:00", to: "15:00" },
    Sat: { active: false, from: "00:00", to: "00:00" },
    Sun: { active: false, from: "00:00", to: "00:00" },
  },
  "Chris Watson": {
    Mon: { active: true, from: "09:00", to: "17:00" },
    Tue: { active: true, from: "09:00", to: "17:00" },
    Wed: { active: true, from: "09:00", to: "17:00" },
    Thu: { active: true, from: "09:00", to: "17:00" },
    Fri: { active: true, from: "09:00", to: "14:00" },
    Sat: { active: false, from: "00:00", to: "00:00" },
    Sun: { active: false, from: "00:00", to: "00:00" },
  },
  "Errol Watson": {
    Mon: { active: true, from: "08:30", to: "16:30" },
    Tue: { active: true, from: "08:30", to: "16:30" },
    Wed: { active: true, from: "08:30", to: "16:30" },
    Thu: { active: true, from: "08:30", to: "16:30" },
    Fri: { active: true, from: "08:30", to: "13:00" },
    Sat: { active: false, from: "00:00", to: "00:00" },
    Sun: { active: false, from: "00:00", to: "00:00" },
  },
};

const schedulerDays = [
  { date: "2026-06-23", label: "Tue 23 Jun" },
  { date: "2026-06-24", label: "Wed 24 Jun" },
  { date: "2026-06-25", label: "Thu 25 Jun" },
  { date: "2026-06-26", label: "Fri 26 Jun" },
];

const postcodeDirectory = [
  {
    postcode: "AB10 1AA",
    addresses: [
      "1 Test Street, Aberdeen, AB10 1AA",
      "3 Test Street, Aberdeen, AB10 1AA",
      "5 Test Street, Aberdeen, AB10 1AA",
    ],
  },
  {
    postcode: "AB15 4EQ",
    addresses: [
      "136 King's Gate, Aberdeen, AB15 4EQ",
      "138 King's Gate, Aberdeen, AB15 4EQ",
      "142 King's Gate, Aberdeen, AB15 4EQ",
    ],
  },
  {
    postcode: "AB15 4YE",
    addresses: [
      "42 Queen's Road, Aberdeen, AB15 4YE",
      "44 Queen's Road, Aberdeen, AB15 4YE",
      "46 Queen's Road, Aberdeen, AB15 4YE",
    ],
  },
  {
    postcode: "AB21 9JD",
    addresses: [
      "4 Stoneywood Road, Aberdeen, AB21 9JD",
      "6 Stoneywood Road, Aberdeen, AB21 9JD",
      "8 Stoneywood Road, Aberdeen, AB21 9JD",
    ],
  },
];

const today = [
  { time: "08:00", title: "Boiler installation", detail: "J-1052 · Scott and Jamie", tone: "blue" },
  { time: "10:30", title: "Landlord safety check", detail: "J-1058 · Mark", tone: "green" },
  { time: "13:00", title: "Site survey", detail: "Q-2061 · Errol", tone: "amber" },
  { time: "15:30", title: "Boiler service", detail: "J-1060 · Scott", tone: "blue" },
];

const quoteCatalogFolders = [
  "Boiler parts",
  "Bathroom items",
  "Pipework and fittings",
  "Consumables",
  "Plant and access",
  "Subcontractors",
  "General materials",
];

function inferCatalogFolder(item: Pick<CatalogItem, "name" | "type" | "category">) {
  if (item.category) return item.category;
  const name = item.name.toLowerCase();
  if (item.type === "Plant") return "Plant and access";
  if (item.type === "Subcontractor") return "Subcontractors";
  if (name.includes("boiler")) return "Boiler parts";
  if (name.includes("bath") || name.includes("shower") || name.includes("toilet") || name.includes("basin")) return "Bathroom items";
  if (name.includes("pipe") || name.includes("fitting") || name.includes("valve")) return "Pipework and fittings";
  if (name.includes("consumable") || name.includes("skip") || name.includes("sundr")) return "Consumables";
  return "General materials";
}

const quoteCatalog: CatalogItem[] = [
  { id: "labour-engineer", type: "Labour", name: "Engineer labour", unit: "hour", costRate: 34, sellRate: 58, category: "Labour" },
  { id: "labour-apprentice", type: "Labour", name: "Apprentice labour", unit: "hour", costRate: 18, sellRate: 34, category: "Labour" },
  { id: "labour-manager", type: "Labour", name: "Manager review", unit: "hour", costRate: 42, sellRate: 74, category: "Labour" },
  { id: "material-boiler-kit", type: "Material", name: "Boiler install kit", unit: "each", costRate: 1180, sellRate: 1560, category: "Boiler parts" },
  { id: "material-pipe-fittings", type: "Material", name: "Pipe and fittings pack", unit: "pack", costRate: 220, sellRate: 340, category: "Pipework and fittings" },
  { id: "material-consumables", type: "Material", name: "Consumables allowance", unit: "allowance", costRate: 95, sellRate: 145, category: "Consumables" },
  { id: "plant-access", type: "Plant", name: "Access equipment", unit: "day", costRate: 86, sellRate: 125, category: "Plant and access" },
  { id: "subcontract-testing", type: "Subcontractor", name: "Commissioning support", unit: "visit", costRate: 320, sellRate: 455, category: "Subcontractors" },
];

const heatLossRoomTypes = [
  { id: "Bathroom", targetTemp: 22, airChanges: 0.5 },
  { id: "Bedroom", targetTemp: 21, airChanges: 0.5 },
  { id: "Bedroom/En Suite", targetTemp: 21, airChanges: 0.5 },
  { id: "Dining Room", targetTemp: 21, airChanges: 0.5 },
  { id: "Hall", targetTemp: 21, airChanges: 0.5 },
  { id: "Kitchen", targetTemp: 21, airChanges: 0.5 },
  { id: "Kitchen/Diner", targetTemp: 21, airChanges: 0.5 },
  { id: "Landing", targetTemp: 21, airChanges: 0.5 },
  { id: "Living Room", targetTemp: 21, airChanges: 0.5 },
  { id: "Study", targetTemp: 21, airChanges: 0.5 },
  { id: "Utility Room", targetTemp: 21, airChanges: 0.5 },
  { id: "WC", targetTemp: 21, airChanges: 0.5 },
];

const heatLossWallTypes = [
  { id: "220mm solid brick plastered", uValue: 2.1 },
  { id: "105mm solid brick plastered", uValue: 3 },
  { id: "Brick cavity wall", uValue: 1.47 },
  { id: "Insulated brick cavity wall", uValue: 0.5 },
  { id: "Timber frame wall", uValue: 0.29 },
];

const heatLossGlazingTypes = [
  { id: "Wood/PVCu Single Glazed", uValue: 5 },
  { id: "Wood/PVCu Double Glazed", uValue: 2.9 },
  { id: "Low E Double Glazed", uValue: 1.7 },
  { id: "Metal Frame Single Glazed", uValue: 5.8 },
  { id: "No External Windows Or Doors", uValue: 0 },
];

const heatLossFloorTypes = [
  { id: "Heated room", uValue: 1.36, adjacentTemp: 21 },
  { id: "Timber floor over ventilated air gap", uValue: 0.82, adjacentTemp: -3 },
  { id: "Uninsulated solid floor on earth", uValue: 0.82, adjacentTemp: -3 },
  { id: "Solid concrete floor", uValue: 1.6, adjacentTemp: -3 },
];

const heatLossCeilingTypes = [
  { id: "Heated room", uValue: 1.62, adjacentTemp: 21 },
  { id: "Insulated roof space", uValue: 0.71, adjacentTemp: -3 },
  { id: "Uninsulated roof space", uValue: 2.3, adjacentTemp: -3 },
  { id: "Insulated flat roof", uValue: 0.7, adjacentTemp: -3 },
  { id: "Uninsulated flat roof", uValue: 2.19, adjacentTemp: -3 },
];

const radiatorCatalogue = [
  { id: "stelrad-compact-k1-600-800", supplierSku: "CC-K1-600-800", range: "Classic Compact", model: "K1 600 x 800", orientation: "Horizontal", outputWatts: 740, costRate: 92 },
  { id: "stelrad-compact-pplus-600-1000", supplierSku: "CC-PPLUS-600-1000", range: "Classic Compact", model: "P+ 600 x 1000", orientation: "Horizontal", outputWatts: 1180, costRate: 136 },
  { id: "stelrad-compact-k2-600-1000", supplierSku: "CC-K2-600-1000", range: "Classic Compact", model: "K2 600 x 1000", orientation: "Horizontal", outputWatts: 1680, costRate: 184 },
  { id: "stelrad-compact-k2-600-1200", supplierSku: "CC-K2-600-1200", range: "Classic Compact", model: "K2 600 x 1200", orientation: "Horizontal", outputWatts: 2010, costRate: 214 },
  { id: "stelrad-compact-k3-600-1200", supplierSku: "CC-K3-600-1200", range: "Classic Compact", model: "K3 600 x 1200", orientation: "Horizontal", outputWatts: 2720, costRate: 295 },
  { id: "stelrad-softline-k2-600-1000", supplierSku: "SL-K2-600-1000", range: "Softline Compact", model: "K2 600 x 1000", orientation: "Horizontal", outputWatts: 1625, costRate: 196 },
  { id: "stelrad-softline-k2-600-1400", supplierSku: "SL-K2-600-1400", range: "Softline Compact", model: "K2 600 x 1400", orientation: "Horizontal", outputWatts: 2275, costRate: 258 },
  { id: "stelrad-vertical-k2-1800-500", supplierSku: "V-K2-1800-500", range: "Vertical", model: "K2 1800 x 500", orientation: "Vertical", outputWatts: 1745, costRate: 312 },
  { id: "stelrad-vertical-k2-1800-600", supplierSku: "V-K2-1800-600", range: "Vertical", model: "K2 1800 x 600", orientation: "Vertical", outputWatts: 2095, costRate: 365 },
];

type RadiatorCatalogueItem = (typeof radiatorCatalogue)[number];

const radiatorRanges = ["Any range", ...Array.from(new Set(radiatorCatalogue.map((radiator) => radiator.range)))];

const defaultQuoteCostCentres: Record<string, QuoteCostCentre[]> = {
  "quote-2061": [
    {
      id: "quote-2061-strip-out",
      name: "Strip out works",
      templateName: "Bathroom refurbishment",
      clientDescription: "Strip out redundant fixtures and prepare the room for new installation.",
      engineerDescription: "Protect finishes, isolate services, strip existing items and leave the room clean for first fix.",
      lines: [
        {
          id: "quote-2061-strip-out-1",
          catalogItemId: "material-consumables",
          description: "Skip and disposal allowance",
          quantity: 1,
          unitCost: 95,
          unitSell: 145,
        },
        {
          id: "quote-2061-strip-out-2",
          catalogItemId: "labour-engineer",
          description: "Plumbing labour",
          quantity: 12,
          unitCost: 34,
          unitSell: 58,
        },
      ],
    },
    {
      id: "quote-2061-first-fix",
      name: "Plumber 1st fix works",
      templateName: "Bathroom refurbishment",
      clientDescription: "Install first fix plumbing routes ready for final connection.",
      engineerDescription: "Run pipework, cap and test routes, then photograph concealed work.",
      lines: [
        {
          id: "quote-2061-first-fix-1",
          catalogItemId: "material-pipe-fittings",
          description: "Pipework and fittings",
          quantity: 3,
          unitCost: 220,
          unitSell: 340,
        },
        {
          id: "quote-2061-first-fix-2",
          catalogItemId: "labour-engineer",
          description: "Plumber labour",
          quantity: 18,
          unitCost: 34,
          unitSell: 58,
        },
      ],
    },
  ],
  "quote-2062": [
    {
      id: "quote-2062-survey",
      name: "Survey and balancing works",
      templateName: "Heating remedials",
      clientDescription: "Survey heating performance and balance existing system.",
      engineerDescription: "Check system temperatures, balance radiators and record findings.",
      lines: [
        {
          id: "quote-2062-survey-1",
          catalogItemId: "labour-engineer",
          description: "Heating balance engineer labour",
          quantity: 42,
          unitCost: 34,
          unitSell: 58,
        },
        {
          id: "quote-2062-survey-2",
          catalogItemId: "labour-manager",
          description: "Survey and handover review",
          quantity: 5,
          unitCost: 42,
          unitSell: 74,
        },
      ],
    },
    {
      id: "quote-2062-remedials",
      name: "Heating remedial materials",
      templateName: "Heating remedials",
      clientDescription: "Supply materials required for heating remedial works.",
      engineerDescription: "Confirm parts before collection and log any missing items before attending.",
      lines: [
        {
          id: "quote-2062-remedials-1",
          catalogItemId: "material-pipe-fittings",
          description: "Pipe and fittings pack",
          quantity: 4,
          unitCost: 220,
          unitSell: 340,
        },
        {
          id: "quote-2062-remedials-2",
          catalogItemId: "material-consumables",
          description: "Consumables allowance",
          quantity: 2,
          unitCost: 95,
          unitSell: 145,
        },
      ],
    },
  ],
};

function makeDefaultEstimateCostCentres(job: Job): EstimateCostCentre[] {
  const base = Math.max(job.value, 1000);
  return [
    {
      id: `${job.id}-strip-out`,
      name: "Strip out works",
      templateName: "Bathroom refurbishment",
      clientDescription: "Strip out redundant fixtures and make the work area ready for follow-on trades.",
      engineerDescription: "Isolate services, protect finishes, remove redundant items, cap pipework safely and leave area clear.",
      materials: [
        {
          id: `${job.id}-strip-out-skip`,
          catalogItemId: "material-consumables",
          description: "Skip and disposal allowance",
          quantity: 1,
          unitCost: Math.round(base * 0.025),
          markupPercent: 25,
        },
        {
          id: `${job.id}-strip-out-cap`,
          catalogItemId: "material-pipe-fittings",
          description: "Materials for capping off pipework",
          quantity: 1,
          unitCost: Math.round(base * 0.018),
          markupPercent: 30,
        },
      ],
      labour: [
        {
          id: `${job.id}-strip-out-plumber`,
          role: "Plumber labour",
          hours: 12,
          costRate: 40,
          markupPercent: 30,
        },
      ],
    },
    {
      id: `${job.id}-joinery`,
      name: "Joinery work",
      templateName: "Bathroom refurbishment",
      clientDescription: "Joinery attendance to open, prepare and reinstate work areas as required.",
      engineerDescription: "Coordinate with joiner before first fix. Confirm openings and access before plumbing works start.",
      materials: [
        {
          id: `${job.id}-joinery-materials`,
          catalogItemId: "material-consumables",
          description: "Joinery sundries allowance",
          quantity: 1,
          unitCost: Math.round(base * 0.02),
          markupPercent: 25,
        },
      ],
      labour: [
        {
          id: `${job.id}-joinery-labour`,
          role: "Joiner labour",
          hours: 8,
          costRate: 38,
          markupPercent: 30,
        },
      ],
    },
    {
      id: `${job.id}-first-fix`,
      name: "1st fix works",
      templateName: "General plumbing",
      clientDescription: "Install first fix plumbing routes and prepare services for final connection.",
      engineerDescription: "Install pipework routes, pressure test, photograph concealed work and update job notes.",
      materials: [
        {
          id: `${job.id}-first-fix-pipe`,
          catalogItemId: "material-pipe-fittings",
          description: "Pipework and fittings",
          quantity: 3,
          unitCost: 220,
          markupPercent: 30,
        },
      ],
      labour: [
        {
          id: `${job.id}-first-fix-plumber`,
          role: "Plumber labour",
          hours: 24,
          costRate: 40,
          markupPercent: 30,
        },
      ],
    },
    {
      id: `${job.id}-second-fix`,
      name: "2nd fix works",
      templateName: "General plumbing",
      clientDescription: "Complete second fix installation, commissioning and handover.",
      engineerDescription: "Fit final items, test operation, clean down, capture completion photos and customer sign-off.",
      materials: [
        {
          id: `${job.id}-second-fix-consumables`,
          catalogItemId: "material-consumables",
          description: "Second fix consumables",
          quantity: 2,
          unitCost: 95,
          markupPercent: 30,
        },
      ],
      labour: [
        {
          id: `${job.id}-second-fix-plumber`,
          role: "Plumber labour",
          hours: 18,
          costRate: 40,
          markupPercent: 30,
        },
      ],
    },
  ];
}

function estimateCostCentresFromQuote(job: Job, quoteCentres: QuoteCostCentre[]): EstimateCostCentre[] {
  if (!quoteCentres.length) return makeDefaultEstimateCostCentres(job);

  return quoteCentres.map((centre, centreIndex) => {
    const totals = quoteCostCentreTotals(centre);
    const materials = totals.materialLines.map((line, lineIndex): EstimateMaterialLine => ({
      id: `${job.id}-${centre.id}-material-${lineIndex}`,
      catalogItemId: line.catalogItemId,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      markupPercent: quoteLineMarkupPercent(line),
    }));
    const labour = totals.labourLines.map((line, lineIndex): EstimateLabourLine => ({
      id: `${job.id}-${centre.id}-labour-${lineIndex}`,
      role: line.description,
      hours: line.quantity,
      costRate: line.unitCost,
      markupPercent: quoteLineMarkupPercent(line),
    }));

    return {
      id: `${job.id}-from-${centre.id}-${centreIndex}`,
      name: centre.name,
      templateName: centre.templateName,
      clientDescription: centre.clientDescription ?? "",
      engineerDescription: centre.engineerDescription ?? "",
      materials,
      labour,
      surveyAssets: centre.surveyAssets?.map((asset) => ({ ...asset })) ?? [],
    };
  });
}

const blankQuote: QuoteDraft = {
  clientId: "",
  siteId: "",
  customer: "",
  phone: "",
  email: "",
  address: "",
  owner: "Errol Watson",
  description: "",
  status: "Draft",
  value: "",
  next: "",
  due: "Today",
};

const blankJob: JobDraft = {
  clientId: "",
  siteId: "",
  customer: "",
  phone: "",
  email: "",
  address: "",
  site: "",
  description: "",
  manager: "Errol Watson",
  scheduledDate: "",
  scheduledTime: "",
  status: "Enquiry",
  value: "",
  next: "",
  due: "Today",
};

const blankOneOffMaterialDraft: OneOffMaterialDraft = {
  description: "",
  unitCost: "",
  markupPercent: "30",
  unitSell: "",
  quantity: "1",
};

const blankLead: LeadDraft = {
  customerMode: "new",
  clientId: undefined,
  siteId: undefined,
  source: "Phone call",
  customerName: "",
  phone: "",
  email: "",
  address: "",
  description: "",
  status: "Needs scheduling",
  surveyor: surveyorOptions[0] ?? "Errol Watson",
  surveyDate: "",
  surveyTime: "",
  createdBy: "Carol",
};

const blankPurchaseRequest = {
  supplier: "",
  item: "",
  estimatedCost: "",
  reason: "",
};

const blankEmployeeProfileTemplate: EmployeeProfileDraft = {
  name: "",
  email: "",
  phone: "",
  address: "",
  startDate: "",
  roleLabel: "",
  hourlyRate: "",
  overtimeRate: "",
  niMultiplier: "",
  pensionPercent: "",
  dailyToolAllowance: "",
  employmentCostNote: "",
  licenses: [],
  documents: [],
  emergencyContacts: [],
  availability: { ...blankEmployeeAvailability },
  bankSortCode: "",
  bankAccountNumber: "",
};

function createBlankEmployeeProfileDraft(): EmployeeProfileDraft {
  return {
    ...blankEmployeeProfileTemplate,
    licenses: [],
    documents: [],
    emergencyContacts: [],
    availability: { ...blankEmployeeAvailability },
  };
}

function makeEmployeeProfileDraft(employee?: EmployeeCard | null): EmployeeProfileDraft {
  const profile = employee?.profile;
  return {
    name: employee?.name ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
    startDate: profile?.startDate ?? "",
    roleLabel: profile?.roleLabel ?? "",
    hourlyRate: profile?.payroll?.hourlyRate?.toString() ?? "",
    overtimeRate: profile?.payroll?.overtimeRate?.toString() ?? "",
    niMultiplier: profile?.payroll?.niMultiplier?.toString() ?? "",
    pensionPercent: profile?.payroll?.pensionPercent?.toString() ?? "",
    dailyToolAllowance: profile?.payroll?.dailyToolAllowance?.toString() ?? "",
    employmentCostNote: profile?.employmentCostNote ?? "",
    licenses: profile?.licenses?.map((item) => ({ ...item })) ?? [],
    documents: profile?.documents?.map((item) => ({ ...item })) ?? [],
    emergencyContacts: profile?.emergencyContacts?.map((item) => ({ ...item })) ?? [],
    availability: {
      ...blankEmployeeAvailability,
      ...(profile?.availability ?? {}),
    },
    bankSortCode: profile?.bankDetails?.sortCode ?? "",
    bankAccountNumber: profile?.bankDetails?.accountNumber ?? "",
  };
}

function currency(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatusDot({ tone }: { tone: string }) {
  return <span className={`status-dot ${tone}`} aria-hidden="true" />;
}

function buildJobCostCentres(job: Job): JobCostCentre[] {
  const labourBudget = Math.round(job.value * 0.34);
  const materialsBudget = Math.round(job.value * 0.28);
  const subcontractorBudget = Math.round(job.value * 0.08);
  const plantBudget = Math.round(job.value * 0.05);
  const overheadBudget = Math.round(job.value * 0.07);

  return [
    {
      key: "labour",
      label: "Labour",
      budget: labourBudget,
      committed: Math.round(labourBudget * 0.72),
      actual: Math.round(labourBudget * 0.41),
      items: [
        { label: "Engineer hours", detail: "48 hrs @ blended field rate", value: Math.round(labourBudget * 0.58) },
        { label: "Manager review", detail: "6 hrs commercial and site control", value: Math.round(labourBudget * 0.16) },
        { label: "Apprentice support", detail: "20 hrs allocated support", value: Math.round(labourBudget * 0.26) },
      ],
    },
    {
      key: "materials",
      label: "Materials",
      budget: materialsBudget,
      committed: Math.round(materialsBudget * 0.63),
      actual: Math.round(materialsBudget * 0.36),
      items: [
        { label: "Primary materials", detail: "Quoted install and service materials", value: Math.round(materialsBudget * 0.62) },
        { label: "Consumables", detail: "Fittings, sealants and small parts", value: Math.round(materialsBudget * 0.18) },
        { label: "Delivery and carriage", detail: "Supplier carriage and collection time", value: Math.round(materialsBudget * 0.2) },
      ],
    },
    {
      key: "subcontractors",
      label: "Subcontractors",
      budget: subcontractorBudget,
      committed: Math.round(subcontractorBudget * 0.5),
      actual: Math.round(subcontractorBudget * 0.2),
      items: [
        { label: "Specialist trade", detail: "Allowance for specialist support", value: Math.round(subcontractorBudget * 0.7) },
        { label: "Testing support", detail: "Commissioning and sign-off allowance", value: Math.round(subcontractorBudget * 0.3) },
      ],
    },
    {
      key: "plant",
      label: "Plant and access",
      budget: plantBudget,
      committed: Math.round(plantBudget * 0.46),
      actual: Math.round(plantBudget * 0.18),
      items: [
        { label: "Access equipment", detail: "Steps, tower or hire allowance", value: Math.round(plantBudget * 0.55) },
        { label: "Tools and calibration", detail: "Allocated tool and meter cost", value: Math.round(plantBudget * 0.45) },
      ],
    },
    {
      key: "overhead",
      label: "Overhead",
      budget: overheadBudget,
      committed: Math.round(overheadBudget * 0.68),
      actual: Math.round(overheadBudget * 0.42),
      items: [
        { label: "Office allocation", detail: "Admin, finance and coordination", value: Math.round(overheadBudget * 0.64) },
        { label: "Vehicle allocation", detail: "Mileage and operating allowance", value: Math.round(overheadBudget * 0.36) },
      ],
    },
  ];
}

function buildJobVariations(job: Job): JobVariation[] {
  if (job.status === "Approval required") {
    return [
      {
        id: `${job.id}-variation-001`,
        reference: "V-003",
        title: "Additional pipework route",
        status: "Sent for approval",
        costValue: 1240,
        sellValue: 1860,
        description: "Engineer found the existing pipe route could not be reused. Extra route required before works proceed.",
        reason: "Hidden issue found",
        labourHours: 6,
        materialsUsed: "Copper pipe, fittings, clips, consumables and access protection.",
        requiresClientApproval: true,
        clientApprovalStatus: "Sent",
        engineerName: "Scott Reid",
        source: "seed",
      },
    ];
  }

  if (job.sourceQuoteId) {
    return [
      {
        id: `${job.id}-variation-allowance`,
        reference: "V-001",
        title: "Client-requested scope allowance",
        status: "Quote drafted",
        costValue: Math.round(job.value * 0.04),
        sellValue: Math.round(job.value * 0.06),
        description: "Engineer captured additional works requested on site. Office needs to price and issue for approval before proceeding.",
        reason: "Client request",
        labourHours: 4,
        materialsUsed: "Materials to be confirmed from engineer note/photos.",
        requiresClientApproval: true,
        clientApprovalStatus: "Not sent",
        engineerName: "Scott Reid",
        source: "seed",
      },
    ];
  }

  return [];
}

const variationBillableStatuses = new Set(["Client approved", "Approved", "Proceed"]);

function isBillableVariationStatus(status: JobVariation["status"]) {
  return variationBillableStatuses.has(status);
}

function mapVariationStatusFromEvent(event: Pick<JobDeliveryEvent, "status" | "requiresClientApproval">): JobVariation["status"] {
  if (event.status === "Client approved") return "Client approved";
  if (event.status === "Approved" || event.status === "Rejected") return event.status;
  if (event.status === "Sent for approval") return "Sent for approval";
  if (event.status === "Quote drafted" || event.status === "Priced") return event.status as JobVariation["status"];

  if (event.status === "Office review") {
    return event.requiresClientApproval === false ? "Priced" : "Detected";
  }

  return "Detected";
}

function mapVariationClientStatusFromEvent(
  event: Pick<JobDeliveryEvent, "status" | "clientApprovalStatus" | "requiresClientApproval">,
): JobVariation["clientApprovalStatus"] | undefined {
  if (!event.requiresClientApproval) return undefined;

  if (event.clientApprovalStatus) {
    return event.clientApprovalStatus;
  }

  if (event.status === "Sent for approval") return "Sent";
  if (event.status === "Client approved" || event.status === "Approved") return "Approved";
  if (event.status === "Rejected") return "Declined";
  return "Not sent";
}

function variationApprovalText(event: Pick<JobDeliveryEvent, "kind" | "status" | "requiresClientApproval" | "clientApprovalStatus">) {
  if (event.kind !== "variation" || !event.requiresClientApproval) return "";
  const status = event.clientApprovalStatus ?? "Not sent";
  return `Client approval: ${status}`;
}

type VariationPortalSyncRecord = {
  variationEventId: string;
  token: string;
  status: "Pending" | "Viewed" | "Approved" | "Declined";
};

function mapVariationEventStatusFromPortalStatus(status: VariationPortalSyncRecord["status"]) {
  if (status === "Approved") return "Client approved";
  if (status === "Declined") return "Rejected";
  return "Sent for approval";
}

function mapVariationClientStatusFromPortalStatus(status: VariationPortalSyncRecord["status"]) {
  if (status === "Approved") return "Approved";
  if (status === "Declined") return "Declined";
  if (status === "Viewed") return "Viewed";
  return "Sent";
}

function buildEventVariationFromDeliveryEvent(event: JobDeliveryEvent, index: number): JobVariation {
  return {
    id: event.id,
    reference: `V-${String(index + 1).padStart(3, "0")}`,
    title: event.summary || "Variation raised",
    status: mapVariationStatusFromEvent(event),
    costValue: event.costValue ?? 0,
    sellValue: event.sellValue ?? 0,
    description: event.summary || "No variation summary captured.",
    reason: event.reason || "Engineer raised",
  labourHours: event.hours,
  materialsUsed: event.materials,
  requiresClientApproval: event.requiresClientApproval ?? true,
  clientApprovalStatus: mapVariationClientStatusFromEvent(event),
  engineerName: event.actor,
  portalToken: event.portalToken,
  source: "event",
  };
}

function sumMoney(items: Array<{ budget?: number; costValue?: number; sellValue?: number }>, key: "budget" | "costValue" | "sellValue") {
  return items.reduce((total, item) => total + (item[key] ?? 0), 0);
}

function quoteLineCost(line: QuoteCostLine) {
  return line.quantity * line.unitCost;
}

function quoteLineSell(line: QuoteCostLine) {
  return line.quantity * line.unitSell;
}

function quoteLineMarkupPercent(line: QuoteCostLine) {
  return line.unitCost > 0 ? Math.round(((line.unitSell - line.unitCost) / line.unitCost) * 10000) / 100 : 0;
}

function quoteLineCatalogType(line: QuoteCostLine) {
  return quoteCatalog.find((item) => item.id === line.catalogItemId)?.type ?? "Material";
}

function quoteCostCentreTotals(centre: QuoteCostCentre) {
  const materialLines = centre.lines.filter((line) => quoteLineCatalogType(line) !== "Labour");
  const labourLines = centre.lines.filter((line) => quoteLineCatalogType(line) === "Labour");
  const materialCost = materialLines.reduce((total, line) => total + quoteLineCost(line), 0);
  const materialSell = materialLines.reduce((total, line) => total + quoteLineSell(line), 0);
  const labourCost = labourLines.reduce((total, line) => total + quoteLineCost(line), 0);
  const labourSell = labourLines.reduce((total, line) => total + quoteLineSell(line), 0);
  const totalCost = materialCost + labourCost;
  const totalSell = materialSell + labourSell;
  const profit = totalSell - totalCost;

  return {
    materialLines,
    labourLines,
    materialCost,
    materialSell,
    labourCost,
    labourSell,
    totalCost,
    totalSell,
    profit,
    margin: totalSell > 0 ? Math.round((profit / totalSell) * 100) : 0,
  };
}

function surveyPackSummary(centres: SurveyPackCentre[]) {
  const assets = centres.flatMap((centre) =>
    (centre.surveyAssets ?? []).map((asset) => ({
      ...asset,
      centreId: centre.id,
      centreName: centre.name,
    })),
  );
  const clientVisible = assets.filter((asset) => asset.clientVisible);

  return {
    assets,
    clientVisible,
    scans: assets.filter((asset) => asset.kind === "Room scan"),
    photos: assets.filter((asset) => asset.kind === "Survey photo"),
    concepts: assets.filter((asset) => asset.kind === "Concept look"),
  };
}

function quoteSurveyPackSummary(centres: QuoteCostCentre[]) {
  return surveyPackSummary(centres);
}

function buildQuoteReviewQuestions(
  quote: Quote,
  centres: QuoteCostCentre[],
  totals: { cost: number; sell: number; profit: number; margin: number; lineCount: number },
): QuoteReviewQuestion[] {
  const questions: QuoteReviewQuestion[] = [];
  const allLines = centres.flatMap((centre) => centre.lines);
  const hasSupplierImport = allLines.some((line) => line.catalogItemId === "supplier-quote-material");
  const hasOneOffMaterial = allLines.some((line) => line.catalogItemId === "one-off-material");
  const hasAllowance = allLines.some((line) => /skip|waste|disposal|consumable|delivery|parking/i.test(line.description));
  const surveyPack = quoteSurveyPackSummary(centres);

  if (totals.lineCount === 0) {
    questions.push({
      id: `${quote.id}-empty-costs`,
      severity: "high",
      title: "There are no cost lines in this quote yet.",
      detail: "Should this quote have labour, materials, plant, subcontractors or a supplier quote imported before it is sent?",
      action: "cost-build",
    });
  }

  if (totals.sell > 0 && totals.margin < 30) {
    questions.push({
      id: `${quote.id}-low-margin`,
      severity: "high",
      title: `Margin is ${totals.margin}%.`,
      detail: "Is that intentional, or should materials/labour markup, contingency or discount be reviewed before issuing?",
      action: "cost-build",
    });
  }

  centres.forEach((centre) => {
    const centreTotals = quoteCostCentreTotals(centre);
    if (centreTotals.materialLines.length === 0) {
      questions.push({
        id: `${centre.id}-no-materials`,
        severity: "medium",
        title: `${centre.name} has no material lines.`,
        detail: "Are all parts covered by a supplier quote, catalogue item, stock item or one-off material?",
        action: "open-centre",
        centreId: centre.id,
      });
    }

    if (centreTotals.labourLines.length === 0) {
      questions.push({
        id: `${centre.id}-no-labour`,
        severity: "medium",
        title: `${centre.name} has no labour allowed.`,
        detail: "Should engineer hours, project management time, commissioning or handover be included?",
        action: "open-centre",
        centreId: centre.id,
      });
    }

    if (!centre.clientDescription?.trim()) {
      questions.push({
        id: `${centre.id}-no-client-description`,
        severity: "low",
        title: `${centre.name} has no client-facing description.`,
        detail: "The quote can price correctly but still be unclear to the customer. Add a scope description if this will be sent out.",
        action: "open-centre",
        centreId: centre.id,
      });
    }
  });

  if (centres.some((centre) => centre.templateName === "Bathroom refurbishment") && !hasAllowance) {
    questions.push({
      id: `${quote.id}-allowances`,
      severity: "medium",
      title: "No waste, disposal, delivery or consumables allowance spotted.",
      detail: "For refurb or strip-out work, should skip, waste, parking, delivery or sundries be added?",
      action: "cost-build",
    });
  }

  if (!hasSupplierImport && !hasOneOffMaterial && totals.lineCount > 0) {
    questions.push({
      id: `${quote.id}-supplier-check`,
      severity: "low",
      title: "No supplier PDF or one-off material lines have been added.",
      detail: "If supplier quotes are expected, import them or add missing items manually so the quote is not only using generic catalogue rates.",
      action: "cost-build",
    });
  }

  if (surveyPack.assets.length > 0 && surveyPack.clientVisible.length === 0) {
    questions.push({
      id: `${quote.id}-survey-visibility`,
      severity: "low",
      title: "Survey records exist but none are marked client-visible.",
      detail: "If photos, room scans or concept looks should support the quote, mark the right records client-visible before sending.",
      action: "cost-build",
    });
  }

  return questions.slice(0, 6);
}

function makeQuoteCostCentre(quoteId: string, index: number, name?: string, templateName = "General plumbing"): QuoteCostCentre {
  return {
    id: `${quoteId}-centre-${Date.now()}-${index}`,
    name: name?.trim() || `Cost centre ${index + 1}`,
    templateName,
    clientDescription: "",
    engineerDescription: "",
    lines: [],
  };
}

function inferQuoteTemplateFromLead(lead: Lead) {
  const description = `${lead.customerName} ${lead.description}`.toLowerCase();
  if (description.includes("boiler") || description.includes("heating")) return "Boiler replacement";
  if (description.includes("service")) return "Boiler servicing";
  if (description.includes("bathroom") || description.includes("refurb")) return "Bathroom refurbishment";
  if (description.includes("joinery")) return "Bathroom refurbishment";
  if (description.includes("reactive") || description.includes("emergency")) return "Reactive maintenance";
  return "General plumbing";
}

function makeInitialQuoteCostCentresFromLead(quoteId: string, lead: Lead): QuoteCostCentre[] {
  const templateName = inferQuoteTemplateFromLead(lead);
  const fallbackLabour: CatalogItem = {
    id: "labour-engineer",
    type: "Labour",
    name: "Engineer labour",
    unit: "hour",
    costRate: 34,
    sellRate: 58,
  };
  const fallbackMaterial: CatalogItem = {
    id: "material-pipe-fittings",
    type: "Material",
    name: "Pipe and fittings pack",
    unit: "pack",
    costRate: 220,
    sellRate: 340,
  };
  const templateMatch = "labour-engineer";
  const materialMatch =
    templateName === "Boiler replacement" ? "material-boiler-kit" : "material-pipe-fittings";

  const labourItem = quoteCatalog.find((item) => item.id === templateMatch) ?? fallbackLabour;
  const materialItem = quoteCatalog.find((item) => item.id === materialMatch) ?? fallbackMaterial;
  const centreName = templateName === "Boiler replacement" ? "Boiler replacement works" : `${lead.description || "General"} scope`;
  const centre = makeQuoteCostCentre(quoteId, 0, centreName, templateName);

  return [
    {
      ...centre,
      lines: [
        {
          id: `line-${Date.now()}-${Math.round(Math.random() * 1000)}-labour`,
          catalogItemId: labourItem.id,
          description: `${templateName} labour`,
          quantity: 0,
          unitCost: labourItem?.costRate ?? 0,
          unitSell: labourItem?.sellRate ?? 0,
        },
        {
          id: `line-${Date.now()}-${Math.round(Math.random() * 1000)}-material`,
          catalogItemId: materialItem.id,
          description: `${templateName} materials`,
          quantity: 0,
          unitCost: materialItem?.costRate ?? 0,
          unitSell: materialItem?.sellRate ?? 0,
        },
      ],
    },
  ];
}

function makeQuoteCostLine(item: CatalogItem): QuoteCostLine {
  return {
    id: `line-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    catalogItemId: item.id,
    description: item.name,
    quantity: 1,
    unitCost: item.costRate,
    unitSell: item.sellRate,
  };
}

function makeTakeoffQuoteLine(row: TakeoffBoqRow): QuoteCostLine {
  return {
    id: `takeoff-line-${row.id}`,
    catalogItemId: "takeoff-boq",
    description: `${row.section} - ${row.description}`,
    quantity: row.quantity,
    unitCost: row.supplierRequired ? 0 : row.unitCost,
    unitSell: row.supplierRequired ? 0 : lineSellFromMarkup(row.unitCost, row.markupPercent),
  };
}

function makeSampleTakeoffRows(centre: QuoteCostCentre): TakeoffBoqRow[] {
  const stamp = Date.now();
  const baseSection = centre.name || "Imported scope";

  return [
    {
      id: `takeoff-${stamp}-1`,
      source: "Takeoff",
      section: baseSection,
      description: "Pipework and fittings allowance from drawing takeoff",
      quantity: 1,
      unit: "item",
      supplierRequired: true,
      unitCost: 0,
      markupPercent: 30,
    },
    {
      id: `takeoff-${stamp}-2`,
      source: "BOQ",
      section: baseSection,
      description: "Access, protection and consumables",
      quantity: 1,
      unit: "item",
      supplierRequired: false,
      unitCost: 85,
      markupPercent: 30,
    },
    {
      id: `takeoff-${stamp}-3`,
      source: "Takeoff",
      section: baseSection,
      description: "Valves and final connection materials",
      quantity: 1,
      unit: "item",
      supplierRequired: true,
      unitCost: 0,
      markupPercent: 30,
    },
  ];
}

function makeTakeoffDocument(kind: TakeoffDocumentKind, fileName: string): TakeoffSourceDocument {
  const questionMap: Record<TakeoffDocumentKind, string[]> = {
    Drawings: [
      "Confirm drawing scale and revision before final quantities.",
      "Pipe routes may need engineer review where walls/floors are not visible.",
    ],
    Specification: [
      "Confirm any named manufacturer requirements before supplier request.",
      "Check whether client specification includes excluded builder's works.",
    ],
    "Contractor BOQ": [
      "Check contractor BOQ quantities against the latest drawing revision.",
      "Confirm if provisional sums should be priced or excluded.",
    ],
  };

  return {
    id: `takeoff-doc-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    kind,
    fileName,
    status: "Draft extracted",
    confidence: kind === "Contractor BOQ" ? "High" : "Medium",
    extractedAt: new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
    questions: questionMap[kind],
  };
}

function makeTakeoffRowsFromDocument(centre: QuoteCostCentre, document: TakeoffSourceDocument): TakeoffBoqRow[] {
  const stamp = Date.now();
  const baseSection = centre.name || "Imported scope";

  if (document.kind === "Contractor BOQ") {
    return [
      {
        id: `boq-${stamp}-1`,
        source: "BOQ",
        section: baseSection,
        description: "Contractor BOQ plumbing materials allowance",
        quantity: 1,
        unit: "item",
        supplierRequired: true,
        unitCost: 0,
        markupPercent: 30,
      },
      {
        id: `boq-${stamp}-2`,
        source: "BOQ",
        section: baseSection,
        description: "Contractor BOQ sundries and consumables",
        quantity: 1,
        unit: "item",
        supplierRequired: false,
        unitCost: 120,
        markupPercent: 30,
      },
    ];
  }

  if (document.kind === "Specification") {
    return [
      {
        id: `spec-${stamp}-1`,
        source: "Takeoff",
        section: baseSection,
        description: "Specified valves, controls and accessories",
        quantity: 1,
        unit: "item",
        supplierRequired: true,
        unitCost: 0,
        markupPercent: 30,
      },
    ];
  }

  return [
    {
      id: `drawing-${stamp}-1`,
      source: "Takeoff",
      section: baseSection,
      description: "Pipe runs measured from uploaded drawings",
      quantity: 18,
      unit: "m",
      supplierRequired: true,
      unitCost: 0,
      markupPercent: 30,
    },
    {
      id: `drawing-${stamp}-2`,
      source: "Takeoff",
      section: baseSection,
      description: "Fittings allowance inferred from drawing routes",
      quantity: 1,
      unit: "allowance",
      supplierRequired: true,
      unitCost: 0,
      markupPercent: 30,
    },
  ];
}

type TakeoffParseOutcome = {
  rows: TakeoffBoqRow[];
  status: "parsed" | "fallback";
  notes: string[];
};

function csvRowsFromText(value: string): string[][] {
  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const nextChar = value[index + 1];
    if (char === '"') {
      if (quoted && nextChar === '"') {
        currentField += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }

    if (!quoted && (char === "," || char === ";" || char === "\t")) {
      currentRow.push(currentField.trim());
      currentField = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentField.trim());
      if (currentRow.some((item) => item.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentField = "";
      currentRow = [];
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField.trim());
  if (currentRow.some((item) => item.trim().length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function parseNumberish(value: string) {
  if (!value) return undefined;
  const cleaned = value.replace(/,/g, ".").replace(/[£$]/g, "").replace(/[^0-9.\-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function detectColumn(headers: string[], candidates: string[][]) {
  const normalised = headers.map(normaliseHeader);
  for (let index = 0; index < candidates.length; index += 1) {
    const group = candidates[index];
    if (!group) continue;
    const found = normalised.findIndex((header) => group.some((candidate) => header.includes(candidate)));
    if (found >= 0) return found;
  }
  return -1;
}

function parseSupplierNeed(value: string | undefined, unitCost = 0) {
  if (unitCost > 0) return false;
  const lowered = normaliseHeader(value ?? "");
  if (!lowered) return true;
  if (["supplier", "quote", "ordered", "buy", "stock", "external", "need quote", "po", "purchase", "outsource"].some((flag) => lowered.includes(flag))) {
    return true;
  }
  if (["included", "internal", "yes", "0", "no purchase", "to stock"].some((flag) => lowered.includes(flag))) {
    return false;
  }
  return true;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(reader.error);
    };
    reader.readAsText(file);
  });
}

async function parseTakeoffRowsFromUpload(
  centre: QuoteCostCentre,
  document: TakeoffSourceDocument,
  file: File,
): Promise<TakeoffParseOutcome> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const fileKind = document.kind;
  const baseSection = centre.name || "Imported scope";
  const rowSource: TakeoffBoqRow["source"] = fileKind === "Contractor BOQ" ? "BOQ" : "Takeoff";

  if (!extension || !["csv", "txt", "tsv"].includes(extension)) {
    return {
      rows: makeTakeoffRowsFromDocument(centre, document),
      status: "fallback",
      notes: [
        `Automatic parsing is currently available for CSV/TXT BOQ exports. ${fileKind} upload kept as draft placeholders for manual review.`,
      ],
    };
  }

  const content = await readFileAsText(file);
  const rows = csvRowsFromText(content);
  if (!rows.length) {
    return {
      rows: makeTakeoffRowsFromDocument(centre, document),
      status: "fallback",
      notes: ["Uploaded file was empty; please convert to CSV from the BOQ source and re-upload."],
    };
  }

  const header = rows[0] ?? [];
  if (!header.length || rows.length < 2) {
    return {
      rows: [],
      status: "fallback",
      notes: ["Could not detect column headers in the BOQ upload."],
    };
  }

  const descriptionIndex = detectColumn(header, [
    ["description", "item description", "item", "name", "material", "description line"],
    ["details", "particulars", "what"],
  ]);
  const qtyIndex = detectColumn(header, [["quantity", "qty", "qtys", "amount"], ["no", "number"]]);
  const unitIndex = detectColumn(header, [["unit", "uom", "measure"]]);
  const sectionIndex = detectColumn(header, [["section", "area", "room", "trade", "location"], ["group"]]);
  const costIndex = detectColumn(header, [["unit cost", "unitprice", "rate", "cost", "unit price", "price"], ["sell", "charge"]]);
  const supplierIndex = detectColumn(header, [["supplier required", "provisional", "source", "procure"], ["purchase", "supply", "sourced"]]);
  const markupIndex = detectColumn(header, [["markup", "margin", "markup%"]]);

  if (descriptionIndex < 0 || qtyIndex < 0) {
    return {
      rows: [],
      status: "fallback",
      notes: [
        "Could not find Description and Quantity columns in this BOQ format. Please keep headings like Description and Quantity, or add rows manually.",
      ],
    };
  }

  const parsedRows = rows.slice(1).flatMap((row, index) => {
    const description = row[descriptionIndex]?.trim();
    if (!description) return [];
    const quantity = parseNumberish(row[qtyIndex] ?? "") ?? 1;
    const section = row[sectionIndex]?.trim() || baseSection;
    const unit = row[unitIndex]?.trim() || "item";
    const unitCost = parseNumberish(row[costIndex] ?? "") ?? 0;
    const markupPercent = parseNumberish(row[markupIndex] ?? "") ?? 30;
    const supplierRequired = parseSupplierNeed(row[supplierIndex], unitCost);

    const id = `upload-${Date.now()}-${index}-${Math.round(Math.random() * 1000)}`;
    return [
      {
        id,
        source: rowSource,
        section,
        description,
        quantity: Math.max(0, quantity),
        unit,
        supplierRequired,
        unitCost,
        markupPercent,
      },
    ];
  });

  if (!parsedRows.length) {
    return {
      rows: [],
      status: "fallback",
      notes: ["The BOQ file uploaded did not contain usable rows. Use sample import while you review and add rows."],
    };
  }

  const total = parsedRows.reduce((sum, row) => sum + row.quantity, 0);
  const notes = [
    `${parsedRows.length} rows imported from ${fileKind} file with total quantity ${total.toFixed(2)}.`,
    extension === "csv" ? "Tip: save BOM/BOQ from spreadsheets as CSV for best import results." : "Text import used with tab/semicolon delimiters.",
  ];

  return { rows: parsedRows, status: "parsed", notes };
}

function makeOneOffQuoteMaterialLine(draft: OneOffMaterialDraft = blankOneOffMaterialDraft): QuoteCostLine {
  const unitCost = Number(draft.unitCost) || 0;
  const markupPercent = Number(draft.markupPercent) || 0;
  const unitSell = Number(draft.unitSell) || (unitCost > 0 ? lineSellFromMarkup(unitCost, markupPercent) : 0);

  return {
    id: `one-off-material-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    catalogItemId: "one-off-material",
    description: draft.description.trim() || "One-off material",
    quantity: Number(draft.quantity) || 1,
    unitCost,
    unitSell,
    supplierRequired: true,
  };
}

function makeSupplierQuoteLines(fileName: string, centre: QuoteCostCentre, markupPercent: number): QuoteCostLine[] {
  const quoteName = fileName.replace(/\.pdf$/i, "").trim() || "Supplier quote";
  const seed = centre.templateName === "Bathroom refurbishment"
    ? [
        { description: "Pipework fittings and isolation valves", quantity: 1, unitCost: 184 },
        { description: "Waste fittings and traps", quantity: 1, unitCost: 96 },
        { description: "Consumables and fixings pack", quantity: 1, unitCost: 72 },
      ]
    : [
        { description: "Materials pack", quantity: 1, unitCost: 220 },
        { description: "Fittings and consumables", quantity: 1, unitCost: 118 },
        { description: "Delivery and handling", quantity: 1, unitCost: 35 },
      ];

  return seed.map((line, index) => ({
    id: `supplier-line-${Date.now()}-${index}`,
    catalogItemId: "supplier-quote-material",
    description: `${quoteName} - ${line.description}`,
    quantity: line.quantity,
    unitCost: line.unitCost,
    unitSell: lineSellFromMarkup(line.unitCost, markupPercent),
  }));
}

type SupplierQuoteParseOutcome = {
  lines: QuoteCostLine[];
  status: "parsed" | "fallback";
  notes: string[];
};

async function parseSupplierQuoteRowsFromUpload(
  file: File,
  centre: QuoteCostCentre,
  markupPercent: number,
): Promise<SupplierQuoteParseOutcome> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "txt", "tsv"].includes(extension)) {
    return {
      lines: makeSupplierQuoteLines(file.name, centre, markupPercent),
      status: "fallback",
      notes: ["Supplier quote uploads are parsed automatically from CSV/TXT only right now."],
    };
  }

  const content = await readFileAsText(file);
  const rows = csvRowsFromText(content);
  if (rows.length < 2) {
    return {
      lines: [],
      status: "fallback",
      notes: ["Supplier quote file had no data rows."],
    };
  }

  const header = rows[0] ?? [];
  const descriptionIndex = detectColumn(header, [
    ["description", "item description", "item", "name", "material", "description line"],
    ["details", "particulars", "what"],
  ]);
  const qtyIndex = detectColumn(header, [["quantity", "qty", "amount"], ["no"]]);
  const costIndex = detectColumn(header, [["unit cost", "unitprice", "rate", "cost", "unit price", "price"]]);
  const unitIndex = detectColumn(header, [["unit", "uom", "measure"]]);

  if (descriptionIndex < 0 || (qtyIndex < 0 && costIndex < 0)) {
    return {
      lines: [],
      status: "fallback",
      notes: ["Could not detect description and pricing columns in this supplier quote upload."],
    };
  }

  const parsed = rows.slice(1).flatMap((row, index) => {
    const description = row[descriptionIndex]?.trim();
    if (!description) return [];
    const quantity = parseNumberish(row[qtyIndex] ?? "") ?? 1;
    const unitCost = parseNumberish(row[costIndex] ?? "") ?? 0;
    const unit = row[unitIndex]?.trim() || "item";
    const id = `supplier-quote-${Date.now()}-${index}-${Math.round(Math.random() * 1000)}`;
    return [
      {
        id,
        catalogItemId: "supplier-quote-material",
        description: `${file.name.replace(/\.csv|\.txt|\.tsv/i, "")} - ${description} (${unit})`,
        quantity: Math.max(0, quantity),
        unitCost: Math.max(0, unitCost),
        unitSell: lineSellFromMarkup(Math.max(0, unitCost), markupPercent),
      },
    ];
  });

  if (!parsed.length) {
    return {
      lines: [],
      status: "fallback",
      notes: ["No usable rows were parsed from this supplier quote file."],
    };
  }

  return {
    lines: parsed,
    status: "parsed",
    notes: [`${parsed.length} supplier lines parsed from ${file.name}.`],
  };
}

function makeHeatLossRoom(index: number): HeatLossRoom {
  return {
    id: `heat-room-${Date.now()}-${index}`,
    name: `Room ${index + 1}`,
    roomType: "Living Room",
    length: "4",
    width: "3.5",
    height: "2.4",
    exteriorWalls: 2,
    wallType: "Brick cavity wall",
    glazingType: "Wood/PVCu Double Glazed",
    windowArea: "2.2",
    floorType: "Heated room",
    ceilingType: "Insulated roof space",
    heatingSystemType: "Hydronic",
    meanWaterTemperature: "70",
    preferredRange: "Any range",
    markupPercent: "30",
  };
}

function selectedOption<T extends { id: string }>(items: T[], id: string, fallbackIndex = 0) {
  return items.find((item) => item.id === id) ?? items[fallbackIndex];
}

function numberFromInput(value: string | number | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isDecimalDraft(value: string) {
  return /^(\d+)?([.,]\d*)?$/.test(value);
}

function exteriorWallAreaForRoom(room: HeatLossRoom) {
  const length = numberFromInput(room.length);
  const width = numberFromInput(room.width);
  const height = numberFromInput(room.height);
  const longSide = Math.max(length, width);
  const shortSide = Math.min(length, width);
  const exteriorLength =
    room.exteriorWalls <= 0
      ? 0
      : room.exteriorWalls === 1
      ? longSide
      : room.exteriorWalls === 2
        ? longSide + shortSide
        : room.exteriorWalls === 3
          ? longSide + shortSide * 2
          : (length + width) * 2;

  return Math.max(0, exteriorLength * height);
}

function calculateHeatLossRoom(room: HeatLossRoom) {
  const heatingSystemType = room.heatingSystemType ?? "Hydronic";
  const roomType = selectedOption(heatLossRoomTypes, room.roomType);
  const wallType = selectedOption(heatLossWallTypes, room.wallType);
  const glazingType = selectedOption(heatLossGlazingTypes, room.glazingType);
  const floorType = selectedOption(heatLossFloorTypes, room.floorType);
  const ceilingType = selectedOption(heatLossCeilingTypes, room.ceilingType);
  const length = numberFromInput(room.length);
  const width = numberFromInput(room.width);
  const height = numberFromInput(room.height);
  const windowArea = room.glazingType === "No External Windows Or Doors" ? 0 : numberFromInput(room.windowArea);
  const floorArea = Math.max(0, length * width);
  const volume = floorArea * Math.max(0, height);
  const targetTemp = roomType?.targetTemp ?? 21;
  const externalDelta = targetTemp - -3;
  const exteriorWallArea = exteriorWallAreaForRoom(room);
  const glazingArea = Math.min(Math.max(0, windowArea), exteriorWallArea);
  const opaqueWallArea = Math.max(0, exteriorWallArea - glazingArea);
  const wallLoss = opaqueWallArea * (wallType?.uValue ?? 1.47) * externalDelta;
  const glazingLoss = glazingArea * (glazingType?.uValue ?? 2.9) * externalDelta;
  const floorLoss = floorArea * (floorType?.uValue ?? 1.36) * Math.max(0, targetTemp - (floorType?.adjacentTemp ?? -3));
  const ceilingLoss = floorArea * (ceilingType?.uValue ?? 0.71) * Math.max(0, targetTemp - (ceilingType?.adjacentTemp ?? -3));
  const ventilationLoss = 0;
  const baseWatts = (wallLoss + glazingLoss + floorLoss + ceilingLoss) * 0.935;
  const watts = Math.round(baseWatts);
  const meanWaterTemperature = numberFromInput(room.meanWaterTemperature, 70);
  const deltaT = heatingSystemType === "Hydronic" ? Math.max(1, meanWaterTemperature - targetTemp) : 50;
  const correctionFactor = heatingSystemType === "Hydronic" ? Math.max(0.25, Math.pow(deltaT / 50, 1.3)) : 1;
  const radiatorOutputAtDeltaT50 = Math.round(watts / correctionFactor);

  return {
    watts,
    btu: Math.round(baseWatts * 3.412),
    radiatorOutputAtDeltaT50,
    radiatorBtuAtDeltaT50: Math.round((watts / correctionFactor) * 3.412),
    deltaT,
    wallLoss,
    glazingLoss,
    floorLoss,
    ceilingLoss,
    ventilationLoss,
    targetTemp,
    volume,
  };
}

function recommendedRadiatorOptionsForRoom(room: HeatLossRoom, limit = 6): RadiatorCatalogueItem[] {
  const heatLoss = calculateHeatLossRoom(room);
  const preferred = room.preferredRange === "Any range"
    ? radiatorCatalogue
    : radiatorCatalogue.filter((radiator) => radiator.range === room.preferredRange);
  const candidates = preferred.length ? preferred : radiatorCatalogue;

  const suitable = [...candidates]
    .filter((radiator) => radiator.outputWatts >= heatLoss.radiatorOutputAtDeltaT50)
    .sort((first, second) => first.outputWatts - second.outputWatts);

  return (suitable.length ? suitable : [...candidates].sort((first, second) => second.outputWatts - first.outputWatts)).slice(0, limit);
}

function recommendRadiatorForRoom(room: HeatLossRoom) {
  const options = recommendedRadiatorOptionsForRoom(room);
  const selected = room.selectedRadiatorId
    ? radiatorCatalogue.find((radiator) => radiator.id === room.selectedRadiatorId)
    : null;

  return selected ?? options[0] ?? null;
}

function heatLossRadiatorLine(room: HeatLossRoom, index: number): QuoteCostLine | null {
  const radiator = recommendRadiatorForRoom(room);
  if (!radiator) return null;
  const heatLoss = calculateHeatLossRoom(room);

  return {
    id: `radiator-line-${room.id}-${index}`,
    catalogItemId: "radiator-stelrad",
    description: `${room.name} - ${radiator.range} ${radiator.model} (${heatLoss.watts}W / ${heatLoss.btu} BTU heat loss, ${heatLoss.radiatorOutputAtDeltaT50}W radiator output required)`,
    quantity: 1,
    unitCost: 0,
    unitSell: 0,
  };
}

function lineSellFromMarkup(cost: number, markupPercent: number) {
  return cost * (1 + markupPercent / 100);
}

function weekdayFromDate(date: string): Weekday {
  const day = new Date(`${date}T00:00:00`).getDay();
  return weekDays[(day + 6) % 7] ?? "Mon";
}

function availabilityForDate(surveyor: string, date: string) {
  if (!date) return { active: false, from: "00:00", to: "00:00" };
  const day = weekdayFromDate(date);
  return surveyorAvailability[surveyor]?.[day] ?? { active: false, from: "00:00", to: "00:00" };
}

function availabilityLabel(surveyor: string, date: string) {
  if (!date) return "Pick a date";
  const availability = availabilityForDate(surveyor, date);
  return availability.active ? `${availability.from}-${availability.to}` : "Unavailable";
}

function timeToMinutes(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function timeRangesOverlap(firstStart: string, secondStart: string, durationMinutes = surveyDurationMinutes) {
  const first = timeToMinutes(firstStart);
  const second = timeToMinutes(secondStart);
  return first < second + durationMinutes && first + durationMinutes > second;
}

function makeQuoteEmailDraft(quote: Quote, client?: ClientRecord | null): QuoteEmailDraft {
  const contactName = client?.primaryContact?.split(" ")[0] || "there";

  return {
    to: client?.email ?? "",
    cc: "",
    subject: `${quote.ref} - ${quote.description}`,
    body: `Hi ${contactName},\n\nPlease find attached our quote for ${quote.description}.\n\nYou can review and accept it online here:\n${quotePortalLink(quote)}\n\nKind regards,\nVerrova`,
    layout: "quote",
    attachPdf: true,
  };
}

function quotePortalLink(quote: Quote) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";
  return quote.portalUrl ?? `${baseUrl}/client/quotes/${quote.portalToken ?? quote.ref.toLowerCase()}`;
}

function variationPortalBaseUrl() {
  return typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";
}

function variationPortalLink(token: string | undefined | null) {
  if (!token) return "";
  return `${variationPortalBaseUrl()}/client/variations/${token}`;
}

function formatVariationPortalCopyNotice(response: { portalToken?: string | null }) {
  const link = variationPortalLink(response.portalToken);
  return link ? `Variation link copied: ${link}` : "No variation link available.";
}

function makeQuotePortalToken(quote: Quote) {
  return `${quote.ref.toLowerCase()}-${quote.id.slice(0, 8)}`;
}

function workflowTimestamp() {
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

function estimateMaterialCost(line: EstimateMaterialLine) {
  return line.quantity * line.unitCost;
}

function estimateMaterialSell(line: EstimateMaterialLine) {
  return line.quantity * lineSellFromMarkup(line.unitCost, line.markupPercent);
}

function estimateLabourCost(line: EstimateLabourLine) {
  return line.hours * line.costRate;
}

function estimateLabourSell(line: EstimateLabourLine) {
  return line.hours * lineSellFromMarkup(line.costRate, line.markupPercent);
}

function estimateCostCentreTotals(centre: EstimateCostCentre) {
  const materialCost = centre.materials.reduce((total, line) => total + estimateMaterialCost(line), 0);
  const materialSell = centre.materials.reduce((total, line) => total + estimateMaterialSell(line), 0);
  const labourCost = centre.labour.reduce((total, line) => total + estimateLabourCost(line), 0);
  const labourSell = centre.labour.reduce((total, line) => total + estimateLabourSell(line), 0);
  const totalCost = materialCost + labourCost;
  const totalSell = materialSell + labourSell;
  const profit = totalSell - totalCost;

  return {
    materialCost,
    materialSell,
    labourCost,
    labourSell,
    totalCost,
    totalSell,
    profit,
    margin: totalSell > 0 ? Math.round((profit / totalSell) * 100) : 0,
  };
}

function makeEstimateCostCentre(jobId: string, index: number, name?: string, templateName = "General plumbing"): EstimateCostCentre {
  return {
    id: `${jobId}-centre-${Date.now()}-${index}`,
    name: name?.trim() || `Cost centre ${index + 1}`,
    templateName,
    clientDescription: "",
    engineerDescription: "",
    materials: [],
    labour: [],
  };
}

function makeEstimateMaterialLine(item: CatalogItem): EstimateMaterialLine {
  return {
    id: `material-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    catalogItemId: item.id,
    description: item.name,
    quantity: 1,
    unitCost: item.costRate,
    markupPercent: 30,
  };
}

function makeEstimateLabourLine(role = "Plumber labour"): EstimateLabourLine {
  return {
    id: `labour-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    role,
    hours: 1,
    costRate: 40,
    markupPercent: 30,
  };
}

export default function Dashboard() {
  const [employees, setEmployees] = useState<EmployeeCard[]>(seedEmployees);
  const [clients, setClients] = useState<ClientRecord[]>(seedClients);
  const [clientSites, setClientSites] = useState<ClientSite[]>(seedClientSites);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(seedAuditEvents);
  const [activeEmployeeId, setActiveEmployeeId] = useState(seedEmployees[0]?.id ?? "");
  const [activeClientId, setActiveClientId] = useState(seedClients[0]?.id ?? "");
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeePermissionDraft, setEmployeePermissionDraft] = useState<AccessOverride>({});
  const [employeeRoleDraft, setEmployeeRoleDraft] = useState<HubRole>("Manager");
  const [employeeProfileDraft, setEmployeeProfileDraft] = useState<EmployeeProfileDraft>(
    createBlankEmployeeProfileDraft(),
  );
  const [jobs, setJobs] = useState<Job[]>(seedJobs);
  const [quotes, setQuotes] = useState<Quote[]>(seedQuotes);
  const [leads, setLeads] = useState<Lead[]>(seedLeads);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>(seedPurchaseRequests);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState("All quotes");
  const [leadStatusFilter, setLeadStatusFilter] = useState("All leads");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("All invoices");
  const [scheduleDate, setScheduleDate] = useState("2026-06-24");
  const [documentFolderTemplates, setDocumentFolderTemplates] = useState<DocumentFolderTemplate[]>(defaultDocumentFolderTemplates);
  const [engineerFlowTemplate, setEngineerFlowTemplate] = useState<EngineerFlowTemplate>(defaultBoilerFlowTemplate);
  const [flowStepCompletion, setFlowStepCompletion] = useState<Record<string, boolean>>({});
  const [newDocumentFolderName, setNewDocumentFolderName] = useState("");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [showCreateQuote, setShowCreateQuote] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [newLead, setNewLead] = useState<LeadDraft>(blankLead);
  const [leadPostcodeSearch, setLeadPostcodeSearch] = useState("");
  const [newQuote, setNewQuote] = useState<QuoteDraft>(blankQuote);
  const [newJob, setNewJob] = useState<JobDraft>(blankJob);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purchaseDraft, setPurchaseDraft] = useState(blankPurchaseRequest);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [sectionNotice, setSectionNotice] = useState<string | null>(null);
  const [createMenuPosition, setCreateMenuPosition] = useState({ left: 0, top: 0 });
  const [openModuleMenu, setOpenModuleMenu] = useState<string | null>(null);
  const [homeView, setHomeView] = useState<HomeView>("dashboard");
  const [activeEmployeeTab, setActiveEmployeeTab] = useState<EmployeeTab>("details");
  const [activeClientTab, setActiveClientTab] = useState<ClientTab>("overview");
  const [activeLeadTab, setActiveLeadTab] = useState<LeadTab>("details");
  const [activeJobTab, setActiveJobTab] = useState<JobDetailTab>("summary");
  const [activeQuoteTab, setActiveQuoteTab] = useState<QuoteDetailTab>("setup");
  const [activeCostCentreTab, setActiveCostCentreTab] = useState<CostCentreTab>("summary");
  const [activeQuoteBuildTab, setActiveQuoteBuildTab] = useState<QuoteBuildTab>("summary");
  const [activeCatalogueFolder, setActiveCatalogueFolder] = useState(quoteCatalogFolders[0] ?? "General materials");
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [catalogueFolderModalCentreId, setCatalogueFolderModalCentreId] = useState<string | null>(null);
  const [catalogueFolderDrafts, setCatalogueFolderDrafts] = useState<Record<string, string>>({});
  const [oneOffMaterialCentreId, setOneOffMaterialCentreId] = useState<string | null>(null);
  const [oneOffMaterialDraft, setOneOffMaterialDraft] = useState<OneOffMaterialDraft>(blankOneOffMaterialDraft);
  const [activeInvoiceTab, setActiveInvoiceTab] = useState<InvoiceTab>("summary");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedQuoteCostCentreId, setSelectedQuoteCostCentreId] = useState<string | null>(null);
  const [selectedCostCentreId, setSelectedCostCentreId] = useState<string | null>(null);
  const [quoteCostCentreNameDraft, setQuoteCostCentreNameDraft] = useState("");
  const [quoteCostCentreTemplateDraft, setQuoteCostCentreTemplateDraft] = useState(costCentreTemplates[0] ?? "General plumbing");
  const [jobCostCentreNameDraft, setJobCostCentreNameDraft] = useState("");
  const [jobCostCentreTemplateDraft, setJobCostCentreTemplateDraft] = useState(costCentreTemplates[0] ?? "General plumbing");
  const [costCentreActionMenu, setCostCentreActionMenu] = useState<{ scope: "quote" | "job"; id: string } | null>(null);
  const [renamingCostCentre, setRenamingCostCentre] = useState<{ scope: "quote" | "job"; id: string } | null>(null);
  const [renameCostCentreDraft, setRenameCostCentreDraft] = useState("");
  const [quoteCostCentres, setQuoteCostCentres] = useState<Record<string, QuoteCostCentre[]>>(defaultQuoteCostCentres);
  const [customQuoteCatalog, setCustomQuoteCatalog] = useState<CatalogItem[]>([]);
  const [supplierQuoteDrafts, setSupplierQuoteDrafts] = useState<Record<string, SupplierQuoteDraft>>({});
  const [selectedQuoteMaterialLineIds, setSelectedQuoteMaterialLineIds] = useState<Record<string, string[]>>({});
  const [checkedQuoteReviewQuestions, setCheckedQuoteReviewQuestions] = useState<Record<string, boolean>>({});
  const [quoteEmailDrafts, setQuoteEmailDrafts] = useState<Record<string, QuoteEmailDraft>>({});
  const [invoiceEmailDrafts, setInvoiceEmailDrafts] = useState<Record<string, InvoiceEmailDraft>>({});
  const [jobEstimateCostCentres, setJobEstimateCostCentres] = useState<Record<string, EstimateCostCentre[]>>({});
  const [jobScheduleDrafts, setJobScheduleDrafts] = useState<Record<string, JobScheduleDraft>>({});
  const [jobReviewApprovals, setJobReviewApprovals] = useState<Record<string, JobReviewState>>({});
  const [jobDeliveryEvents, setJobDeliveryEvents] = useState<JobDeliveryEvent[]>([]);
  const [jobDeliveryDrafts, setJobDeliveryDrafts] = useState<Record<string, JobDeliveryDraft>>({});
  const [communicationRecords, setCommunicationRecords] = useState<CommunicationRecord[]>([]);
  const [communicationDrafts, setCommunicationDrafts] = useState<Record<string, CommunicationDraft>>({});
  const [hasHydratedLocalData, setHasHydratedLocalData] = useState(false);
  const [hasLoadedHubDetailState, setHasLoadedHubDetailState] = useState(false);
  const [handledInitialRoute, setHandledInitialRoute] = useState(false);
  const noticeClearTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeEmployee = useMemo(
    () => employees.find((employee) => employee.id === activeEmployeeId) ?? employees[0],
    [employees, activeEmployeeId],
  );

  const activeEditingEmployee = useMemo(
    () => (editingEmployeeId ? employees.find((employee) => employee.id === editingEmployeeId) ?? null : null),
    [editingEmployeeId, employees],
  );

  const activeClient = useMemo(
    () => clients.find((client) => client.id === activeClientId) ?? clients[0] ?? null,
    [activeClientId, clients],
  );

  const activeClientSites = useMemo(
    () => clientSites.filter((site) => site.clientId === activeClientId),
    [activeClientId, clientSites],
  );

  const availableQuoteCatalog = useMemo(
    () => [...quoteCatalog, ...customQuoteCatalog],
    [customQuoteCatalog],
  );

  const selectedLead = useMemo(
    () => (selectedLeadId ? leads.find((lead) => lead.id === selectedLeadId) ?? null : null),
    [leads, selectedLeadId],
  );

  const selectedLeadAudit = useMemo(
    () => (selectedLead ? auditEvents.filter((event) => event.recordId === selectedLead.id) : []),
    [auditEvents, selectedLead],
  );

  const activeClientAudit = useMemo(
    () => {
      const activeSiteIds = new Set(activeClientSites.map((site) => site.id));
      return auditEvents.filter((event) => {
        if (event.recordId === activeClientId || activeSiteIds.has(event.recordId)) return true;
        return (
          quotes.some(
            (quote) =>
              quote.id === event.recordId &&
              (quote.clientId === activeClientId || (quote.siteId ? activeSiteIds.has(quote.siteId) : false)),
          ) ||
          jobs.some(
            (job) =>
              job.id === event.recordId &&
              (job.clientId === activeClientId || (job.siteId ? activeSiteIds.has(job.siteId) : false)),
          )
        );
      });
    },
    [activeClientId, activeClientSites, auditEvents, jobs, quotes],
  );

  const access = useMemo(
    () => getAccessProfile(activeEmployee?.role ?? "Manager", activeEmployee?.permissions ?? {}),
    [activeEmployee],
  );

  const requestHeaders = useMemo<HeadersInit>(
    () => ({
      [roleHeaderName]: activeEmployee?.role ?? "Manager",
      [employeeHeaderName]: activeEmployee?.id ?? "",
      [permissionHeaderName]: JSON.stringify(activeEmployee?.permissions ?? {}),
    }),
    [activeEmployee],
  );

  const employeeAccessForEditor = useMemo(
    () => getAccessProfile(employeeRoleDraft, employeePermissionDraft),
    [employeePermissionDraft, employeeRoleDraft],
  );

  const quoteClientSites = useMemo(
    () => clientSites.filter((site) => site.clientId === newQuote.clientId),
    [clientSites, newQuote.clientId],
  );

  const jobClientSites = useMemo(
    () => clientSites.filter((site) => site.clientId === newJob.clientId),
    [clientSites, newJob.clientId],
  );

  const quoteCustomerMatches = useMemo(
    () =>
      buildLeadCustomerMatches(
        {
          clientId: newQuote.clientId,
          customerName: newQuote.customer,
          email: newQuote.email,
          phone: newQuote.phone,
          address: newQuote.address,
        },
        clients,
        clientSites,
      ),
    [clientSites, clients, newQuote.address, newQuote.clientId, newQuote.customer, newQuote.email, newQuote.phone],
  );

  const jobCustomerMatches = useMemo(
    () =>
      buildLeadCustomerMatches(
        {
          clientId: newJob.clientId,
          customerName: newJob.customer,
          email: newJob.email,
          phone: newJob.phone,
          address: newJob.address,
        },
        clients,
        clientSites,
      ),
    [clientSites, clients, newJob.address, newJob.clientId, newJob.customer, newJob.email, newJob.phone],
  );

  const selectedQuote = useMemo(
    () => (selectedQuoteId ? quotes.find((quote) => quote.id === selectedQuoteId) ?? null : null),
    [quotes, selectedQuoteId],
  );

  const selectedQuoteAudit = useMemo(
    () => (selectedQuote ? auditEvents.filter((event) => event.recordId === selectedQuote.id) : []),
    [auditEvents, selectedQuote],
  );

  const selectedJob = useMemo(
    () => (selectedJobId ? jobs.find((job) => job.id === selectedJobId) ?? null : null),
    [jobs, selectedJobId],
  );

  const selectedInvoice = useMemo(
    () => (selectedInvoiceId ? invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null : null),
    [invoices, selectedInvoiceId],
  );

  const selectedQuoteJob = useMemo(
    () => getQuoteJob(selectedQuote),
    [jobs, selectedQuote],
  );

  const selectedJobSourceQuote = useMemo(
    () =>
      selectedJob?.sourceQuoteId
        ? quotes.find((quote) => quote.id === selectedJob.sourceQuoteId) ?? null
        : null,
    [quotes, selectedJob],
  );

  const selectedQuoteClient = useMemo(
    () =>
      selectedQuote?.clientId
        ? clients.find((client) => client.id === selectedQuote.clientId) ?? null
        : null,
    [clients, selectedQuote],
  );

  const selectedQuoteSite = useMemo(
    () =>
      selectedQuote?.siteId
        ? clientSites.find((site) => site.id === selectedQuote.siteId) ?? null
        : null,
    [clientSites, selectedQuote],
  );

  const selectedQuoteEmailDraft = useMemo(
    () =>
      selectedQuote
        ? quoteEmailDrafts[selectedQuote.id] ?? makeQuoteEmailDraft(selectedQuote, selectedQuoteClient)
        : null,
    [quoteEmailDrafts, selectedQuote, selectedQuoteClient],
  );

  const selectedJobClient = useMemo(
    () =>
      selectedJob?.clientId
        ? clients.find((client) => client.id === selectedJob.clientId) ?? null
        : null,
    [clients, selectedJob],
  );

  const selectedJobSite = useMemo(
    () =>
      selectedJob?.siteId
        ? clientSites.find((site) => site.id === selectedJob.siteId) ?? null
        : null,
    [clientSites, selectedJob],
  );

  const selectedJobScheduleDraft = useMemo(
    () =>
      selectedJob
        ? jobScheduleDrafts[selectedJob.id] ?? {
            manager: selectedJob.manager,
            scheduledDate: selectedJob.scheduledDate ?? "",
            scheduledTime: selectedJob.scheduledTime ?? "",
          }
        : null,
    [jobScheduleDrafts, selectedJob],
  );

  const selectedJobReviewState = useMemo(
    () => (selectedJob ? jobReviewApprovals[selectedJob.id] ?? emptyJobReviewState : emptyJobReviewState),
    [jobReviewApprovals, selectedJob],
  );

  const selectedJobReviewComplete = useMemo(
    () => jobReviewChecks.every((check) => selectedJobReviewState[check.key]),
    [selectedJobReviewState],
  );

  const selectedJobDeliveryEvents = useMemo(
    () => (selectedJob ? jobDeliveryEvents.filter((event) => event.jobId === selectedJob.id) : []),
    [jobDeliveryEvents, selectedJob],
  );

  const selectedJobAttendanceEvents = useMemo(
    () => selectedJobDeliveryEvents.filter((event) => event.kind === "attendance"),
    [selectedJobDeliveryEvents],
  );

  const selectedJobAttendanceStatus = useMemo(() => {
    if (!selectedJob?.scheduledDate || !selectedJob.scheduledTime) return "Not scheduled";
    if (selectedJobAttendanceEvents.some((event) => event.status === "Arrived")) return "Arrived on site";
    if (selectedJobAttendanceEvents.some((event) => event.status === "Confirmed")) return "Engineer confirmed";
    if (selectedJobAttendanceEvents.some((event) => event.status === "Requested")) return "Awaiting confirmation";
    return "Not requested";
  }, [selectedJob, selectedJobAttendanceEvents]);

  const selectedJobDeliveryDraft = useMemo(
    () => (selectedJob ? jobDeliveryDrafts[selectedJob.id] ?? blankJobDeliveryDraft : blankJobDeliveryDraft),
    [jobDeliveryDrafts, selectedJob],
  );

  const selectedJobTimesheetHours = useMemo(
    () => selectedJobDeliveryEvents.reduce((total, event) => total + (event.kind === "timesheet" ? event.hours ?? 0 : 0), 0),
    [selectedJobDeliveryEvents],
  );

  const selectedJobPurchaseRequests = useMemo(
    () => (selectedJob ? purchaseRequests.filter((request) => request.jobId === selectedJob.id) : []),
    [purchaseRequests, selectedJob],
  );

  const selectedJobAudit = useMemo(
    () => (selectedJob ? auditEvents.filter((event) => event.recordId === selectedJob.id) : []),
    [auditEvents, selectedJob],
  );

  const selectedQuoteCommunications = useMemo(
    () => (selectedQuote ? communicationRecords.filter((record) => record.recordType === "quote" && record.recordId === selectedQuote.id) : []),
    [communicationRecords, selectedQuote],
  );

  const selectedInvoiceCommunications = useMemo(
    () => (selectedInvoice ? communicationRecords.filter((record) => record.recordType === "invoice" && record.recordId === selectedInvoice.id) : []),
    [communicationRecords, selectedInvoice],
  );

  const selectedQuoteCommunicationDraft = useMemo(
    () => (selectedQuote ? communicationDrafts[`quote:${selectedQuote.id}`] ?? blankCommunicationDraft : blankCommunicationDraft),
    [communicationDrafts, selectedQuote],
  );

  const selectedJobCommunicationDraft = useMemo(
    () => (selectedJob ? communicationDrafts[`job:${selectedJob.id}`] ?? blankCommunicationDraft : blankCommunicationDraft),
    [communicationDrafts, selectedJob],
  );

  const selectedInvoiceCommunicationDraft = useMemo(
    () => (selectedInvoice ? communicationDrafts[`invoice:${selectedInvoice.id}`] ?? blankCommunicationDraft : blankCommunicationDraft),
    [communicationDrafts, selectedInvoice],
  );

  const selectedDrawerAudit = useMemo(() => {
    const ids = new Set<string>();
    if (selectedQuote) ids.add(selectedQuote.id);
    if (selectedQuote?.convertedJobId) ids.add(selectedQuote.convertedJobId);
    if (selectedJob) ids.add(selectedJob.id);
    if (selectedJob?.sourceQuoteId) ids.add(selectedJob.sourceQuoteId);
    return auditEvents.filter((event) => ids.has(event.recordId)).slice(0, 5);
  }, [auditEvents, selectedJob, selectedQuote]);

  const selectedQuoteCostCentres = useMemo(
    () => (selectedQuote ? quoteCostCentres[selectedQuote.id] ?? [] : []),
    [quoteCostCentres, selectedQuote],
  );

  const selectedQuoteCostCentre = useMemo(
    () =>
      selectedQuoteCostCentreId
        ? selectedQuoteCostCentres.find((centre) => centre.id === selectedQuoteCostCentreId) ?? null
        : null,
    [selectedQuoteCostCentreId, selectedQuoteCostCentres],
  );

  const selectedQuoteTotals = useMemo(() => {
    const lines = selectedQuoteCostCentres.flatMap((centre) => centre.lines);
    const cost = lines.reduce((total, line) => total + quoteLineCost(line), 0);
    const sell = lines.reduce((total, line) => total + quoteLineSell(line), 0);
    const profit = sell - cost;

    return {
      cost,
      sell,
      profit,
      margin: sell > 0 ? Math.round((profit / sell) * 100) : 0,
      lineCount: lines.length,
    };
  }, [selectedQuoteCostCentres]);

  const selectedQuoteReviewQuestions = useMemo(
    () =>
      selectedQuote
        ? buildQuoteReviewQuestions(selectedQuote, selectedQuoteCostCentres, selectedQuoteTotals)
        : [],
    [selectedQuote, selectedQuoteCostCentres, selectedQuoteTotals],
  );

  const selectedJobEstimateCostCentres = useMemo(
    () =>
      selectedJob
        ? jobEstimateCostCentres[selectedJob.id] ?? makeDefaultEstimateCostCentres(selectedJob)
        : [],
    [jobEstimateCostCentres, selectedJob],
  );

  const selectedJobSurveyPack = useMemo(
    () => surveyPackSummary(selectedJobEstimateCostCentres),
    [selectedJobEstimateCostCentres],
  );

  const selectedCostCentre = useMemo(
    () =>
      selectedCostCentreId
        ? selectedJobEstimateCostCentres.find((centre) => centre.id === selectedCostCentreId) ?? null
        : null,
    [selectedCostCentreId, selectedJobEstimateCostCentres],
  );

  const selectedJobVariations = useMemo(
    () => (selectedJob ? buildVariationsForJob(selectedJob) : []),
    [jobDeliveryEvents, selectedJob],
  );

  const selectedJobBillableVariations = useMemo(
    () => selectedJobVariations.filter((variation) => isBillableVariationStatus(variation.status)),
    [selectedJobVariations],
  );

  const selectedInvoiceSourceQuote = useMemo(
    () =>
      selectedInvoice?.sourceType === "quote"
        ? quotes.find((quote) => quote.id === selectedInvoice.sourceId) ?? null
        : null,
    [quotes, selectedInvoice],
  );

  const selectedInvoiceSourceJob = useMemo(
    () =>
      selectedInvoice?.sourceType === "job"
        ? jobs.find((job) => job.id === selectedInvoice.sourceId) ?? null
        : null,
    [jobs, selectedInvoice],
  );

  const selectedInvoiceClient = useMemo(
    () => (selectedInvoice?.clientId ? clients.find((client) => client.id === selectedInvoice.clientId) ?? null : null),
    [clients, selectedInvoice],
  );

  const selectedInvoiceEmailDraft = useMemo(
    () =>
      selectedInvoice
        ? invoiceEmailDrafts[selectedInvoice.id] ?? makeInvoiceEmailDraft(selectedInvoice, selectedInvoiceClient)
        : null,
    [invoiceEmailDrafts, selectedInvoice, selectedInvoiceClient],
  );

  const selectedInvoiceSite = useMemo(
    () => (selectedInvoice?.siteId ? clientSites.find((site) => site.id === selectedInvoice.siteId) ?? null : null),
    [clientSites, selectedInvoice],
  );

  const selectedInvoiceAudit = useMemo(
    () => (selectedInvoice ? auditEvents.filter((event) => event.recordId === selectedInvoice.id) : []),
    [auditEvents, selectedInvoice],
  );

  const selectedInvoiceFinancials = useMemo(() => {
    if (!selectedInvoice) {
      return {
        vatAmount: 0,
        grandTotal: 0,
        margin: 0,
        profit: 0,
      };
    }

    const vatRate = selectedInvoice.vatRate / 100;
    const vatAmount = selectedInvoice.chargeTotal * vatRate;
    const grandTotal = selectedInvoice.chargeTotal + vatAmount;
    const profit = selectedInvoice.chargeTotal - selectedInvoice.costTotal;
    const margin = selectedInvoice.chargeTotal > 0 ? Math.round((profit / selectedInvoice.chargeTotal) * 100) : 0;

    return {
      vatAmount,
      grandTotal,
      margin,
      profit,
    };
  }, [selectedInvoice]);

  const invoiceSourceMap = useMemo(() => {
    const byQuote = new Map<string, Invoice>();
    const byJob = new Map<string, Invoice>();

    for (const invoice of invoices) {
      if (invoice.sourceType === "quote") byQuote.set(invoice.sourceId, invoice);
      if (invoice.sourceType === "job") byJob.set(invoice.sourceId, invoice);
    }

    return { byQuote, byJob };
  }, [invoices]);

  const selectedInvoiceCategoryTotals = useMemo(() => {
    if (!selectedInvoice) {
      return {
        materialsCost: 0,
        materialsCharge: 0,
        labourCost: 0,
        labourCharge: 0,
        variationsCost: 0,
        variationsCharge: 0,
        otherCost: 0,
        otherCharge: 0,
      };
    }

    return selectedInvoice.lines.reduce(
      (acc, line) => {
        if (line.category === "Materials") {
          acc.materialsCost += line.costToUs;
          acc.materialsCharge += line.chargeToClient;
          return acc;
        }
        if (line.category === "Labour") {
          acc.labourCost += line.costToUs;
          acc.labourCharge += line.chargeToClient;
          return acc;
        }
        if (line.category === "Variations") {
          acc.variationsCost += line.costToUs;
          acc.variationsCharge += line.chargeToClient;
          return acc;
        }
        acc.otherCost += line.costToUs;
        acc.otherCharge += line.chargeToClient;
        return acc;
      },
      {
        materialsCost: 0,
        materialsCharge: 0,
        labourCost: 0,
        labourCharge: 0,
        variationsCost: 0,
        variationsCharge: 0,
        otherCost: 0,
        otherCharge: 0,
      },
    );
  }, [selectedInvoice]);

  const selectedInvoiceReadiness = useMemo(() => {
    if (!selectedInvoice) {
      return {
        items: [] as JobReadinessItem[],
        completeCount: 0,
        requiredCount: 0,
      };
    }

    const sourceApproved = selectedInvoiceSourceJob
      ? ["Ready to invoice", "Invoiced", "Closed"].includes(selectedInvoiceSourceJob.status)
      : selectedInvoiceSourceQuote
        ? selectedInvoiceSourceQuote.status === "Accepted"
        : true;
    const hasRecipient = Boolean(selectedInvoiceEmailDraft?.to.trim().includes("@"));
    const lineChargeTotal = selectedInvoice.lines.reduce((sum, line) => sum + line.chargeToClient, 0);
    const items: JobReadinessItem[] = [
      {
        label: "Source approved",
        detail: selectedInvoiceSourceJob
          ? `${selectedInvoiceSourceJob.ref} is ${selectedInvoiceSourceJob.status}`
          : selectedInvoiceSourceQuote
            ? `${selectedInvoiceSourceQuote.ref} is ${selectedInvoiceSourceQuote.status}`
            : "Manual invoice with no linked source.",
        complete: sourceApproved,
      },
      {
        label: "Invoice lines",
        detail: `${selectedInvoice.lines.length} lines · ${currency(lineChargeTotal)} charge before VAT`,
        complete: selectedInvoice.lines.length > 0 && lineChargeTotal > 0,
      },
      {
        label: "Recipient",
        detail: selectedInvoiceEmailDraft?.to.trim() || "Add the customer email before sending.",
        complete: hasRecipient,
      },
      {
        label: "PDF attachment",
        detail: selectedInvoiceEmailDraft?.attachPdf ? "Generated invoice PDF will be attached." : "PDF attachment is switched off.",
        complete: Boolean(selectedInvoiceEmailDraft?.attachPdf),
      },
      {
        label: "Job closure",
        detail: selectedInvoiceSourceJob
          ? `Sending will move ${selectedInvoiceSourceJob.ref} to Invoiced.`
          : "No job status will be changed.",
        complete: Boolean(selectedInvoiceSourceJob),
        optional: !selectedInvoiceSourceJob,
      },
    ];
    const requiredItems = items.filter((item) => !item.optional);

    return {
      items,
      completeCount: requiredItems.filter((item) => item.complete).length,
      requiredCount: requiredItems.length,
    };
  }, [
    selectedInvoice,
    selectedInvoiceEmailDraft,
    selectedInvoiceSourceJob,
    selectedInvoiceSourceQuote,
  ]);

  const selectedInvoiceFromQuote = useMemo(
    () => (selectedQuote ? invoiceSourceMap.byQuote.get(selectedQuote.id) ?? null : null),
    [invoiceSourceMap.byQuote, selectedQuote],
  );

  const selectedInvoiceFromJob = useMemo(
    () => (selectedJob ? invoiceSourceMap.byJob.get(selectedJob.id) ?? null : null),
    [invoiceSourceMap.byJob, selectedJob],
  );

  const selectedJobCommunications = useMemo(() => {
    if (!selectedJob) return [];
    const relatedIds = new Set<string>([selectedJob.id]);
    if (selectedJob.sourceQuoteId) relatedIds.add(selectedJob.sourceQuoteId);
    if (selectedInvoiceFromJob) relatedIds.add(selectedInvoiceFromJob.id);
    return communicationRecords.filter((record) => relatedIds.has(record.recordId) || record.relatedJobId === selectedJob.id);
  }, [communicationRecords, selectedInvoiceFromJob, selectedJob]);

  const selectedJobCostSummary = useMemo(() => {
    if (!selectedJob) {
      return {
        chargeValue: 0,
        baseCost: 0,
        variationCost: 0,
        variationSell: 0,
        totalCost: 0,
        totalCharge: 0,
        projectedProfit: 0,
        projectedMargin: 0,
      };
    }

    const baseCost = selectedJobEstimateCostCentres.reduce(
      (total, centre) => total + estimateCostCentreTotals(centre).totalCost,
      0,
    );
    const baseSell = selectedJobEstimateCostCentres.reduce(
      (total, centre) => total + estimateCostCentreTotals(centre).totalSell,
      0,
    );
    const variationCost = sumMoney(selectedJobBillableVariations, "costValue");
    const variationSell = sumMoney(selectedJobBillableVariations, "sellValue");
    const totalCost = baseCost + variationCost;
    const totalCharge = (baseSell > 0 ? baseSell : selectedJob.value) + variationSell;
    const projectedProfit = totalCharge - totalCost;

    return {
      chargeValue: selectedJob.value,
      baseCost,
      variationCost,
      variationSell,
      totalCost,
      totalCharge,
      projectedProfit,
      projectedMargin: totalCharge > 0 ? Math.round((projectedProfit / totalCharge) * 100) : 0,
    };
  }, [selectedJob, selectedJobEstimateCostCentres, selectedJobBillableVariations]);

  const selectedJobReadiness = useMemo(() => {
    if (!selectedJob) {
      return {
        items: [] as JobReadinessItem[],
        completeCount: 0,
        requiredCount: 0,
      };
    }

    const lineCount = selectedJobEstimateCostCentres.reduce(
      (total, centre) => total + centre.materials.length + centre.labour.length,
      0,
    );
    const briefedCentres = selectedJobEstimateCostCentres.filter(
      (centre) => centre.engineerDescription.trim().length > 0,
    ).length;
    const openPurchaseRequests = selectedJobPurchaseRequests.filter(
      (request) => !["Approved", "Issued"].includes(request.status),
    ).length;
    const communicationEvents = selectedJobDeliveryEvents.filter(
      (event) => event.kind === "whatsapp" || event.kind === "attendance",
    ).length;

    const items: JobReadinessItem[] = [
      {
        label: "Schedule booked",
        detail:
          selectedJob.scheduledDate && selectedJob.scheduledTime
            ? `${selectedJob.manager} · ${selectedJob.scheduledDate} at ${selectedJob.scheduledTime}`
            : "Choose engineer, date and time before starting.",
        complete: Boolean(selectedJob.scheduledDate && selectedJob.scheduledTime),
      },
      {
        label: "Cost centres priced",
        detail: `${selectedJobEstimateCostCentres.length} cost centres · ${lineCount} material/labour lines`,
        complete: selectedJobEstimateCostCentres.length > 0 && lineCount > 0,
      },
      {
        label: "Engineer instructions",
        detail: `${briefedCentres}/${selectedJobEstimateCostCentres.length} cost centres have engineer notes`,
        complete:
          selectedJobEstimateCostCentres.length > 0 &&
          briefedCentres === selectedJobEstimateCostCentres.length,
      },
      {
        label: "Survey pack",
        detail:
          selectedJobSurveyPack.assets.length > 0
            ? `${selectedJobSurveyPack.assets.length} scans, photos or concept records handed over`
            : "No quote survey records have been handed into this job.",
        complete: selectedJobSurveyPack.assets.length > 0,
      },
      {
        label: "PO / supplier readiness",
        detail:
          selectedJobPurchaseRequests.length > 0
            ? `${selectedJobPurchaseRequests.length} requests · ${openPurchaseRequests} still waiting`
            : "No purchase requests raised yet.",
        complete: openPurchaseRequests === 0,
        optional: selectedJobPurchaseRequests.length === 0,
      },
      {
        label: "Communication doorway",
        detail:
          communicationEvents > 0
            ? `${communicationEvents} confirmations or site messages captured`
            : "Request confirmation or capture the first site update.",
        complete: communicationEvents > 0,
      },
    ];
    const requiredItems = items.filter((item) => !item.optional);

    return {
      items,
      completeCount: requiredItems.filter((item) => item.complete).length,
      requiredCount: requiredItems.length,
    };
  }, [
    selectedJob,
    selectedJobDeliveryEvents,
    selectedJobEstimateCostCentres,
    selectedJobPurchaseRequests,
    selectedJobSurveyPack,
  ]);

  useEffect(() => {
    if (!editingEmployeeId || !activeEditingEmployee) return;
    setEmployeeRoleDraft(activeEditingEmployee.role);
    setEmployeePermissionDraft({ ...(activeEditingEmployee.permissions ?? {}) });
    setEmployeeProfileDraft(makeEmployeeProfileDraft(activeEditingEmployee));
  }, [editingEmployeeId, activeEditingEmployee]);

  useEffect(() => {
    const storedClients = safeLoadStoredJson(STORAGE_KEYS.clients, seedClients);

    setClients(storedClients);
    setClientSites(safeLoadStoredJson(STORAGE_KEYS.clientSites, seedClientSites));
    setAuditEvents(safeLoadStoredJson(STORAGE_KEYS.auditEvents, seedAuditEvents));
    setActiveClientId(storedClients[0]?.id ?? seedClients[0]?.id ?? "");
    setJobs(safeLoadStoredJson(STORAGE_KEYS.jobs, seedJobs));
    setQuotes(safeLoadStoredJson(STORAGE_KEYS.quotes, seedQuotes));
    setLeads(safeLoadStoredJson(STORAGE_KEYS.leads, seedLeads));
    setPurchaseRequests(safeLoadStoredJson(STORAGE_KEYS.purchaseRequests, seedPurchaseRequests));
    setInvoices(safeLoadStoredJson(STORAGE_KEYS.invoices, []));
    setDocumentFolderTemplates(safeLoadStoredJson(STORAGE_KEYS.documentFolders, defaultDocumentFolderTemplates));
    setEngineerFlowTemplate(safeLoadStoredJson(STORAGE_KEYS.engineerFlow, defaultBoilerFlowTemplate));
    setFlowStepCompletion(safeLoadStoredJson(STORAGE_KEYS.flowCompletion, {}));
    setQuoteCostCentres(safeLoadStoredJson(STORAGE_KEYS.quoteCostCentres, defaultQuoteCostCentres));
    setCustomQuoteCatalog(safeLoadStoredJson(STORAGE_KEYS.customCatalog, []));
    setJobEstimateCostCentres(safeLoadStoredJson(STORAGE_KEYS.jobCostCentres, {}));
    setJobReviewApprovals(safeLoadStoredJson(STORAGE_KEYS.jobReviews, {}));
    setJobDeliveryEvents(safeLoadStoredJson(STORAGE_KEYS.jobDeliveryEvents, []));
    setCommunicationRecords(safeLoadStoredJson(STORAGE_KEYS.communications, []));
    setHasHydratedLocalData(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedLocalData) return;

    let stopped = false;

    const loadLiveData = async () => {
      let hasOfflineFallback = false;
      try {
        const [clientsResponse, leadsResponse, jobsResponse, quotesResponse, purchaseResponse, auditResponse, hubStateResponse] = await Promise.all([
          fetch("/api/clients", { headers: requestHeaders }),
          fetch("/api/leads", { headers: requestHeaders }),
          fetch("/api/jobs", { headers: requestHeaders }),
          fetch("/api/quotes", { headers: requestHeaders }),
          fetch("/api/purchase-requests", { headers: requestHeaders }),
          fetch("/api/audit", { headers: requestHeaders }),
          fetch("/api/hub-state", { headers: requestHeaders }),
        ]);

        if (stopped) return;

        if (clientsResponse.ok) {
          setClients((await clientsResponse.json()) as ClientRecord[]);
        } else {
          hasOfflineFallback = true;
        }

        if (leadsResponse.ok) {
          setLeads((await leadsResponse.json()) as Lead[]);
        } else {
          hasOfflineFallback = true;
        }

        if (jobsResponse.ok) {
          setJobs((await jobsResponse.json()) as Job[]);
        } else {
          hasOfflineFallback = true;
        }

        if (quotesResponse.ok) {
          setQuotes((await quotesResponse.json()) as Quote[]);
        } else {
          hasOfflineFallback = true;
        }

        if (purchaseResponse.ok) {
          setPurchaseRequests((await purchaseResponse.json()) as PurchaseRequest[]);
        } else {
          hasOfflineFallback = true;
        }

        if (auditResponse.ok) {
          setAuditEvents((await auditResponse.json()) as AuditEvent[]);
        } else {
          hasOfflineFallback = true;
        }

        if (hubStateResponse.ok) {
          const hubState = (await hubStateResponse.json()) as HubDetailStatePayload;
          if (hubState.documentFolderTemplates) setDocumentFolderTemplates(hubState.documentFolderTemplates);
          if (hubState.engineerFlowTemplate) setEngineerFlowTemplate(hubState.engineerFlowTemplate);
          if (hubState.flowStepCompletion) setFlowStepCompletion(hubState.flowStepCompletion);
          if (hubState.quoteCostCentres) setQuoteCostCentres(hubState.quoteCostCentres);
          if (hubState.customQuoteCatalog) setCustomQuoteCatalog(hubState.customQuoteCatalog);
          if (hubState.jobCostCentres) setJobEstimateCostCentres(hubState.jobCostCentres);
          if (hubState.jobReviews) setJobReviewApprovals(hubState.jobReviews);
          if (hubState.jobDeliveryEvents) setJobDeliveryEvents(hubState.jobDeliveryEvents);
          if (hubState.communications) setCommunicationRecords(hubState.communications);
          if (hubState.invoices) setInvoices(hubState.invoices);
          setHasLoadedHubDetailState(true);
        } else {
          hasOfflineFallback = true;
        }

        if (stopped) return;

        if (hasOfflineFallback) {
          setSectionError("Some Verrova workflows are currently using local workspace data.");
        } else {
          setSectionError(null);
        }
      } catch {
        if (!stopped) {
          setSectionError("Could not reach live workflow APIs, so local data is shown.");
        }
      }
    };

    loadLiveData().catch(() => {});
    const timer = setInterval(() => {
      if (!stopped) {
        loadLiveData().catch(() => {});
      }
    }, 20000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [hasHydratedLocalData, requestHeaders]);

  useEffect(() => {
    if (!hasHydratedLocalData) return;

    safeSaveStoredJson(STORAGE_KEYS.clients, clients);
    safeSaveStoredJson(STORAGE_KEYS.clientSites, clientSites);
    safeSaveStoredJson(STORAGE_KEYS.leads, leads);
    safeSaveStoredJson(STORAGE_KEYS.jobs, jobs);
    safeSaveStoredJson(STORAGE_KEYS.quotes, quotes);
    safeSaveStoredJson(STORAGE_KEYS.purchaseRequests, purchaseRequests);
    safeSaveStoredJson(STORAGE_KEYS.auditEvents, auditEvents);
    safeSaveStoredJson(STORAGE_KEYS.invoices, invoices);
    safeSaveStoredJson(STORAGE_KEYS.documentFolders, documentFolderTemplates);
    safeSaveStoredJson(STORAGE_KEYS.engineerFlow, engineerFlowTemplate);
    safeSaveStoredJson(STORAGE_KEYS.flowCompletion, flowStepCompletion);
    safeSaveStoredJson(STORAGE_KEYS.quoteCostCentres, quoteCostCentres);
    safeSaveStoredJson(STORAGE_KEYS.customCatalog, customQuoteCatalog);
    safeSaveStoredJson(STORAGE_KEYS.jobCostCentres, jobEstimateCostCentres);
    safeSaveStoredJson(STORAGE_KEYS.jobReviews, jobReviewApprovals);
    safeSaveStoredJson(STORAGE_KEYS.jobDeliveryEvents, jobDeliveryEvents);
    safeSaveStoredJson(STORAGE_KEYS.communications, communicationRecords);

    if (!hasLoadedHubDetailState) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const payload: HubDetailStatePayload = {
        documentFolderTemplates,
        engineerFlowTemplate,
        flowStepCompletion,
        quoteCostCentres,
        customQuoteCatalog,
        jobCostCentres: jobEstimateCostCentres,
        jobReviews: jobReviewApprovals,
        jobDeliveryEvents,
        communications: communicationRecords,
        invoices,
      };

      fetch("/api/hub-state", {
        method: "PUT",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).catch(() => {
        if (!controller.signal.aborted) {
          setSectionError("Could not save shared hub detail state, so local fallback is being used.");
        }
      });
    }, 700);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    clients,
    clientSites,
    leads,
    jobs,
    quotes,
    purchaseRequests,
    auditEvents,
    invoices,
    documentFolderTemplates,
    engineerFlowTemplate,
    flowStepCompletion,
    quoteCostCentres,
    customQuoteCatalog,
    jobEstimateCostCentres,
    jobReviewApprovals,
    jobDeliveryEvents,
    communicationRecords,
    hasHydratedLocalData,
    hasLoadedHubDetailState,
    requestHeaders,
  ]);

  useEffect(() => {
    if (!hasHydratedLocalData || !selectedJob) return;
    refreshSelectedJobVariationPortalStatuses().catch(() => {});
  }, [hasHydratedLocalData, selectedJob?.id]);

  useEffect(() => {
    if (!hasHydratedLocalData || handledInitialRoute || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const quoteParam = params.get("quote");
    if (!quoteParam) {
      setHandledInitialRoute(true);
      return;
    }

    const targetQuote = quotes.find((quote) => quote.id === quoteParam || quote.ref === quoteParam);
    if (!targetQuote) return;

    openQuoteDrawer(targetQuote.id);
    setQuoteStatusFilter("All quotes");
    showNotice(`${targetQuote.ref} opened from AI Surveyor handoff.`);
    setHandledInitialRoute(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, [handledInitialRoute, hasHydratedLocalData, quotes]);

  useEffect(() => {
    return () => {
      if (noticeClearTimeout.current) clearTimeout(noticeClearTimeout.current);
    };
  }, []);

  const filteredLeads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesSearch =
        !query ||
        [
          lead.ref,
          lead.customerName,
          lead.phone,
          lead.email,
          lead.address,
          lead.description,
          lead.source,
          lead.status,
          lead.surveyor,
          lead.createdBy,
        ].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = leadStatusFilter === "All leads" || lead.status === leadStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [leadStatusFilter, leads, search]);

  const leadQuoteMap = useMemo(() => {
    const index = new Map<string, Quote>();
    for (const quote of quotes) {
      if (quote.sourceLeadId) index.set(quote.sourceLeadId, quote);
      if (quote.sourceLeadRef) index.set(quote.sourceLeadRef, quote);
    }
    return index;
  }, [quotes]);

  function getLeadQuote(lead: Lead) {
    return leadQuoteMap.get(lead.id) ?? leadQuoteMap.get(lead.ref);
  }

  function getQuoteJob(quote: Quote | null | undefined) {
    if (!quote) return null;
    return quote.convertedJobId
      ? jobs.find((job) => job.id === quote.convertedJobId) ?? null
      : jobs.find((job) => job.sourceQuoteId === quote.id || job.sourceQuoteRef === quote.ref) ?? null;
  }

  function getInvoiceForWorkflow(quote: Quote | null | undefined, job: Job | null | undefined) {
    if (job) {
      const jobInvoice = invoiceSourceMap.byJob.get(job.id);
      if (jobInvoice) return jobInvoice;
    }
    return quote ? invoiceSourceMap.byQuote.get(quote.id) ?? null : null;
  }

  function stageState(isDone: boolean, isCurrent: boolean): WorkflowTrackerState {
    if (isDone) return "done";
    if (isCurrent) return "current";
    return "waiting";
  }

  function buildWorkflowTrackerStages(input: {
    lead?: Lead | null;
    quote?: Quote | null;
    job?: Job | null;
    invoice?: Invoice | null;
  }): WorkflowTrackerStage[] {
    const lead = input.lead ?? null;
    const quote = input.quote ?? (lead ? getLeadQuote(lead) ?? null : null);
    const job = input.job ?? getQuoteJob(quote);
    const invoice = input.invoice ?? getInvoiceForWorkflow(quote, job);

    return [
      {
        label: "Lead",
        detail: lead ? `${lead.ref} · ${lead.status}` : quote?.sourceLeadRef ?? "No lead linked",
        state: stageState(Boolean(lead && ["Quoted", "Lost"].includes(lead.status)), Boolean(lead && !quote)),
      },
      {
        label: "Quote",
        detail: quote ? `${quote.ref} · ${quote.status}` : "Waiting for quote",
        state: stageState(Boolean(quote && ["Accepted", "Converted"].includes(quote.status)), Boolean(quote && !job)),
      },
      {
        label: "Job",
        detail: job ? `${job.ref} · ${job.status}` : "Waiting for job",
        state: stageState(Boolean(job && ["Ready to invoice", "Completed", "Invoiced", "Closed"].includes(job.status)), Boolean(job && !invoice)),
      },
      {
        label: "Invoice",
        detail: invoice ? `${invoice.ref} · ${invoice.status}` : "Waiting for invoice",
        state: stageState(Boolean(invoice && invoice.status !== "Draft"), Boolean(invoice)),
      },
    ];
  }

  function renderWorkflowTracker(stages: WorkflowTrackerStage[]) {
    return (
      <section className="workflow-tracker" aria-label="Record workflow progress">
        {stages.map((stage) => (
          <article className={`workflow-stage ${stage.state}`} key={stage.label}>
            <span>{stage.state === "done" ? <Check size={14} /> : null}</span>
            <div>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </div>
          </article>
        ))}
      </section>
    );
  }

  const filteredQuotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      const matchesSearch =
        !query ||
        [quote.ref, quote.customer, quote.description, quote.owner, quote.status].some((value) =>
          value.toLowerCase().includes(query),
        );
      const matchesStatus = quoteStatusFilter === "All quotes" || quote.status === quoteStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [quotes, quoteStatusFilter, search]);

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const matchesSearch =
        !query ||
        [job.ref, job.customer, job.site, job.description, job.manager, job.status].some((value) =>
          value.toLowerCase().includes(query),
        );
      const matchesStatus = statusFilter === "All statuses" || job.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [jobs, search, statusFilter]);

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const matchesSearch =
        !query ||
        [invoice.ref, invoice.sourceRef, invoice.sourceName, invoice.customer, invoice.title, invoice.status].some((value) =>
          value.toLowerCase().includes(query),
        );
      const matchesStatus =
        invoiceStatusFilter === "All invoices" || invoice.status === invoiceStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [invoiceStatusFilter, invoices, search]);

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      if (!query) return true;
      return [
        client.name,
        client.accountReference,
        client.primaryContact,
        client.email,
        client.phone,
        client.status,
        client.commercialOwner,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [clients, search]);

  const visibleModules = useMemo(() => {
    return modules.filter((module) => {
      if (module.label === "People" && !access.showCustomers) return false;
      if (module.label === "Jobs" && !access.showJobs) return false;
      if (module.label === "Schedules" && !access.showSchedule) return false;
      if (module.label === "Quotes" && !access.showQuotes) return false;
      if (module.label === "Invoices" && !access.showFinance) return false;
      return true;
    });
  }, [access]);

  const visibleSideNav = useMemo(() => {
    return activeEmployee?.role === "Engineer"
      ? sideNavigation.filter((item) => item.label !== "Reports")
      : sideNavigation;
  }, [activeEmployee]);

  const metrics = useMemo(() => {
    const activeJobs = jobs.filter((job) => !["Invoiced", "Closed"].includes(job.status));
    const attentionJobs = jobs.filter((job) => ["red", "amber"].includes(job.health));
    const readyToInvoice = jobs.filter((job) => job.status === "Ready to invoice");
    const bookedLeads = leads.filter((lead) => lead.status === "Survey booked");
    const activeValue = activeJobs.reduce((sum, job) => sum + job.value, 0);
    const readyValue = readyToInvoice.reduce((sum, job) => sum + job.value, 0);

    const base = [
      {
        label: "Open leads",
        value: String(leads.filter((lead) => !["Quoted", "Lost"].includes(lead.status)).length),
        detail: `${bookedLeads.length} survey visits booked`,
        trend: `${leads.filter((lead) => lead.status === "Needs scheduling").length} need diary`,
        tone: "amber",
      },
      {
        label: "Active jobs",
        value: String(activeJobs.length),
        detail: `${access.showFinance ? `${currency(activeValue)} ` : ""}live position`,
        trend: `${jobs.filter((job) => job.status === "In progress").length} in progress`,
        tone: "blue",
      },
      {
        label: "Attention required",
        value: String(attentionJobs.length),
        detail: `${jobs.filter((job) => job.health === "red").length} jobs are blocked`,
        trend: `${jobs.filter((job) => job.due === "Today" && ["red", "amber"].includes(job.health)).length} urgent`,
        tone: "red",
      },
    ];

    if (!access.showFinance) return base;

    return [
      ...base,
      {
        label: "Ready to invoice",
        value: currency(readyValue),
        detail: `${readyToInvoice.length} jobs passed all gates`,
        trend: "Live position",
        tone: "green",
      },
      {
        label: "Pending variations",
        value: "£8,420",
        detail: "7 awaiting action",
        trend: "3 need pricing",
        tone: "amber",
      },
    ];
  }, [access.showFinance, jobs, leads]);

  const workflowBuckets = useMemo(
    () => [
      {
        key: "lead-intake",
        label: "Lead intake",
        detail: "New enquiries and survey bookings",
        tone: "amber",
        count: leads.filter((lead) => !["Quoted", "Lost"].includes(lead.status)).length,
      },
      {
        key: "quotes-sent",
        label: "Quotes sent",
        detail: "Pending customer response",
        tone: "blue",
        count: quotes.filter((quote) => quote.status === "Sent").length,
      },
      {
        key: "quotes-accepted",
        label: "Quotes accepted",
        detail: "Ready to convert into jobs",
        tone: "green",
        count: quotes.filter((quote) => quote.status === "Accepted").length,
      },
      {
        key: "jobs-ready-schedule",
        label: "Ready to schedule",
        detail: "Accepted and intake queue",
        tone: "blue",
        count: jobs.filter((job) => ["Enquiry", "Accepted"].includes(job.status)).length,
      },
      {
        key: "jobs-booked",
        label: "Booked / in progress",
        detail: "Scheduled and active",
        tone: "green",
        count: jobs.filter((job) => ["Scheduled", "In progress"].includes(job.status)).length,
      },
      {
        key: "jobs-signoff",
        label: "Complete awaiting sign-off",
        detail: "Waiting for final checks",
        tone: "amber",
        count: jobs.filter((job) => ["Completed", "Approval required"].includes(job.status)).length,
      },
      {
        key: "jobs-ready-invoice",
        label: "Ready for invoice",
        detail: "Invoice gates passed",
        tone: "green",
        count: jobs.filter((job) => job.status === "Ready to invoice").length,
      },
      {
        key: "po-pending",
        label: "POs requiring approval",
        detail: "Engineer request queue",
        tone: "amber",
        count: purchaseRequests.filter((request) => request.status === "Requested").length,
      },
    ],
    [jobs, leads, purchaseRequests, quotes],
  );

  const pendingPORequests = useMemo(
    () => purchaseRequests.filter((request) => request.status === "Requested"),
    [purchaseRequests],
  );

  const officeAlerts = useMemo(() => getOfficeAlerts(), []);
  const officePoRequests = useMemo(() => getOfficePoRequests(), []);
  const highPriorityOfficeAlerts = officeAlerts.filter((alert) => alert.priority === "High").length;
  const officeExceptionCards = useMemo(
    () => [
      {
        label: "Variations",
        title: "Review before works proceed",
        detail: `${officeAlerts.filter((alert) => alert.type === "Variation detected").length} draft variation quote awaiting office review`,
        tone: "amber",
        href: "/office/alerts",
      },
      {
        label: "Stop / go",
        title: "Completion evidence missing",
        detail: `${officeAlerts.filter((alert) => alert.type === "Stop/go missing").length} required photos, notes or form fields blocking close-out`,
        tone: "red",
        href: "/office/alerts",
      },
      {
        label: "Parts / PO",
        title: "Engineer parts support",
        detail: `${officePoRequests.length + pendingPORequests.length} supplier or PO requests need office action`,
        tone: "amber",
        href: "/office/po-requests",
      },
      {
        label: "WhatsApp",
        title: "Message doorway pilot",
        detail: "Replies can become time checks, variations, PO requests and job notes",
        tone: "blue",
        href: "/office/whatsapp-pilot",
      },
    ],
    [officeAlerts, officePoRequests.length, pendingPORequests.length],
  );

  const scheduledLeadVisits = useMemo(
    () =>
      leads
        .filter((lead) => lead.status !== "Lost" && lead.surveyDate && lead.surveyTime)
        .map((lead) => ({
          time: lead.surveyTime,
          title: "Lead survey",
          detail: `${lead.ref} · ${lead.surveyor} · ${lead.customerName}`,
          tone: "amber",
        })),
    [leads],
  );

  const leadSurveyBookings = useMemo(
    () =>
      leads
        .filter((lead) => lead.status !== "Lost" && Boolean(lead.surveyDate && lead.surveyTime))
        .filter((lead): lead is Lead & { surveyDate: string; surveyTime: string } => Boolean(lead.surveyDate && lead.surveyTime))
        .map((lead) => ({
          id: lead.id,
          ref: lead.ref,
          surveyor: lead.surveyor,
          date: lead.surveyDate,
          time: lead.surveyTime,
          customerName: lead.customerName,
          address: lead.address,
          description: lead.description,
        })),
    [leads],
  );

  const scheduledJobs = useMemo(
    () =>
      jobs
        .filter((job) => Boolean(job.scheduledDate && job.scheduledTime))
        .filter((job): job is Job & { scheduledDate: string; scheduledTime: string } => Boolean(job.scheduledDate && job.scheduledTime))
        .map((job) => ({
          id: job.id,
          ref: job.ref,
          surveyor: job.manager ?? "Unassigned",
          manager: job.manager ?? "Unassigned",
          date: job.scheduledDate,
          time: job.scheduledTime,
          customerName: job.customer,
          customer: job.customer,
          address: job.site,
          description: job.description,
          type: "Job" as const,
        })),
    [jobs],
  );

  const jobScheduleBookings = useMemo(
    () =>
      jobs
        .filter((job) => Boolean(job.scheduledDate && job.scheduledTime))
        .filter((job): job is Job & { scheduledDate: string; scheduledTime: string } => Boolean(job.scheduledDate && job.scheduledTime))
        .map((job) => ({
          id: job.id,
          ref: job.ref,
          manager: job.manager,
          date: job.scheduledDate,
          time: job.scheduledTime,
          customerName: job.customer,
        })),
    [jobs],
  );

  const bookingsForSelectedDate = useMemo(
    () => [...leadSurveyBookings, ...scheduledJobs].filter((booking) => booking.date === scheduleDate),
    [leadSurveyBookings, scheduledJobs, scheduleDate],
  );

  type StaffScheduleClash = {
    type: "lead" | "job";
    ref: string;
    time: string;
    customerName: string;
    resourceType: "lead" | "job";
  };

  function findLeadSurveyClash(booking: { leadId?: string; surveyor: string; date: string; time: string }): StaffScheduleClash | null {
    if (!booking.date || !booking.time) return null;
    const leadClash = leadSurveyBookings.find(
      (existing) =>
        existing.id !== booking.leadId &&
        existing.surveyor === booking.surveyor &&
        existing.date === booking.date &&
        timeRangesOverlap(booking.time, existing.time),
    );
    if (leadClash) {
      return {
        type: "lead",
        resourceType: "lead",
        ref: leadClash.ref,
        time: leadClash.time,
        customerName: leadClash.customerName,
      };
    }

    const jobClash = jobScheduleBookings.find(
      (existing) =>
        existing.manager === booking.surveyor &&
        existing.date === booking.date &&
        timeRangesOverlap(booking.time, existing.time),
    );
    if (!jobClash) return null;
    return {
      type: "job",
      resourceType: "job",
      ref: jobClash.ref,
      time: jobClash.time,
      customerName: jobClash.customerName,
    };
  }

  function findJobScheduleClash(booking: { jobId?: string; manager: string; date: string; time: string }): StaffScheduleClash | null {
    if (!booking.date || !booking.time) return null;
    const jobClash = jobScheduleBookings.find(
      (existing) =>
        existing.id !== booking.jobId &&
        existing.manager === booking.manager &&
        existing.date === booking.date &&
        timeRangesOverlap(booking.time, existing.time),
    );
    if (jobClash) {
      return {
        type: "job",
        resourceType: "job",
        ref: jobClash.ref,
        time: jobClash.time,
        customerName: jobClash.customerName,
      };
    }

    const leadClash = leadSurveyBookings.find(
      (existing) =>
        existing.surveyor === booking.manager &&
        existing.date === booking.date &&
        timeRangesOverlap(booking.time, existing.time),
    );
    if (!leadClash) return null;
    return {
      type: "lead",
      resourceType: "lead",
      ref: leadClash.ref,
      time: leadClash.time,
      customerName: leadClash.customerName,
    };
  }

  function validateJobSchedule(booking: { jobId?: string; manager: string; date: string; time: string }) {
    if (!booking.date || !booking.time || !booking.manager) return null;
    const clash = findJobScheduleClash(booking);
    if (clash) {
      return `${booking.manager} already has ${clash.resourceType} ${clash.ref} at ${clash.time} for ${clash.customerName}.`;
    }
    return null;
  }

  function validateLeadSurveyBooking(booking: { leadId?: string; surveyor: string; date: string; time: string }) {
    if (!booking.date || !booking.time) return null;
    const availability = availabilityForDate(booking.surveyor, booking.date);
    if (!availability.active) return `${booking.surveyor} is unavailable on ${booking.date}.`;
    const start = timeToMinutes(booking.time);
    const end = start + surveyDurationMinutes;
    if (start < timeToMinutes(availability.from) || end > timeToMinutes(availability.to)) {
      return `${booking.surveyor} is only available ${availability.from}-${availability.to} on ${booking.date}.`;
    }
    const clash = findLeadSurveyClash(booking);
    if (clash) {
      return `${booking.surveyor} already has ${clash.resourceType} ${clash.ref} at ${clash.time} for ${clash.customerName}.`;
    }
    return null;
  }

  const scheduleVisits = useMemo(
    () => [...scheduledLeadVisits, ...today].sort((first, second) => first.time.localeCompare(second.time)),
    [scheduledLeadVisits],
  );

  const newLeadScheduleWarning = useMemo(
    () =>
      validateLeadSurveyBooking({
        surveyor: newLead.surveyor,
        date: newLead.surveyDate,
        time: newLead.surveyTime,
      }),
    [leadSurveyBookings, jobScheduleBookings, newLead.surveyDate, newLead.surveyTime, newLead.surveyor],
  );

  const newJobScheduleWarning = useMemo(
    () =>
      validateJobSchedule({
        manager: newJob.manager,
        date: newJob.scheduledDate,
        time: newJob.scheduledTime,
      }),
    [jobScheduleBookings, leadSurveyBookings, newJob.manager, newJob.scheduledDate, newJob.scheduledTime],
  );

  const selectedLeadScheduleWarning = useMemo(
    () =>
      selectedLead
        ? validateLeadSurveyBooking({
            leadId: selectedLead.id,
            surveyor: selectedLead.surveyor,
            date: selectedLead.surveyDate,
            time: selectedLead.surveyTime,
          })
        : null,
    [leadSurveyBookings, jobScheduleBookings, selectedLead],
  );

  const leadClientSites = useMemo(
    () => clientSites.filter((site) => site.clientId === newLead.clientId),
    [clientSites, newLead.clientId],
  );

  const leadCustomerMatches = useMemo(() => {
    return buildLeadCustomerMatches(newLead, clients, clientSites);
  }, [clientSites, clients, newLead.clientId, newLead.customerName, newLead.email, newLead.phone, newLead.address]);

  const leadAddressMatches = useMemo(() => {
    const query = leadPostcodeSearch.trim().toLowerCase();
    if (query.length < 3) return [];
    return postcodeDirectory
      .filter((entry) => entry.postcode.toLowerCase().includes(query))
      .flatMap((entry) => entry.addresses.map((address) => ({ postcode: entry.postcode, address })))
      .slice(0, 8);
  }, [leadPostcodeSearch]);

  function showNotice(message: string) {
    if (noticeClearTimeout.current) clearTimeout(noticeClearTimeout.current);
    setSectionNotice(message);
    noticeClearTimeout.current = setTimeout(() => setSectionNotice(null), 4200);
  }

  function recordDocumentFolders(recordType: RecordDocumentScope) {
    return documentFolderTemplates.filter((folder) => folder.recordTypes.includes(recordType));
  }

  function updateDocumentFolder(folderId: string, patch: Partial<DocumentFolderTemplate>) {
    setDocumentFolderTemplates((current) =>
      current.map((folder) => (folder.id === folderId ? { ...folder, ...patch } : folder)),
    );
  }

  function addDocumentFolderTemplate() {
    const name = newDocumentFolderName.trim();
    if (!name) return;
    setDocumentFolderTemplates((current) => [
      ...current,
      {
        id: `folder-${Date.now()}`,
        name,
        description: "Custom document folder.",
        recordTypes: ["lead", "quote", "job", "invoice"],
        defaultVisibility: "Private",
      },
    ]);
    setNewDocumentFolderName("");
    showNotice(`${name} folder added to the default document template.`);
  }

  function removeDocumentFolderTemplate(folderId: string) {
    setDocumentFolderTemplates((current) => current.filter((folder) => folder.id !== folderId));
    showNotice("Folder removed from the default template.");
  }

  function updateEngineerFlowStep(stepId: string, patch: Partial<EngineerFlowStep>) {
    setEngineerFlowTemplate((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }));
  }

  function flowCompletionKey(recordId: string, stepId: string) {
    return `${recordId}:${stepId}`;
  }

  function toggleFlowStep(recordId: string, stepId: string) {
    const key = flowCompletionKey(recordId, stepId);
    setFlowStepCompletion((current) => ({ ...current, [key]: !current[key] }));
  }

  function logAuditEvent(event: Omit<AuditEvent, "id" | "createdAt">) {
    const stamp = new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const optimisticId = `audit-${Date.now()}-${Math.round(Math.random() * 1000)}`;

    setAuditEvents((current) => [
      {
        id: optimisticId,
        createdAt: stamp.replace(",", ""),
        ...event,
      },
      ...current,
    ]);

    fetch("/api/audit", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as AuditEvent;
      })
      .then((saved) => {
        if (!saved) return;
        setAuditEvents((current) =>
          current.map((item) => (item.id === optimisticId ? saved : item)),
        );
      })
      .catch(() => {});
  }

  function communicationDraftKey(recordType: CommunicationRecordType, recordId: string) {
    return `${recordType}:${recordId}`;
  }

  function updateCommunicationDraft(recordType: CommunicationRecordType, recordId: string, patch: Partial<CommunicationDraft>) {
    const key = communicationDraftKey(recordType, recordId);
    setCommunicationDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? blankCommunicationDraft), ...patch },
    }));
  }

  function resetCommunicationDraft(recordType: CommunicationRecordType, recordId: string) {
    const key = communicationDraftKey(recordType, recordId);
    setCommunicationDrafts((current) => ({
      ...current,
      [key]: blankCommunicationDraft,
    }));
  }

  function addCommunicationRecord(record: Omit<CommunicationRecord, "id" | "createdAt">) {
    const created: CommunicationRecord = {
      ...record,
      id: `comm-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      createdAt: workflowTimestamp(),
    };
    setCommunicationRecords((current) => [created, ...current]);
    return created;
  }

  function captureOutlookReply(
    recordType: CommunicationRecordType,
    recordId: string,
    draft: CommunicationDraft,
    options: { defaultFrom: string; to: string; relatedJobId?: string; label: string },
  ) {
    const subject = draft.subject.trim();
    const body = draft.body.trim();
    if (!subject || !body) {
      showNotice("Add the Outlook reply subject and message before capturing it.");
      return;
    }

    const created = addCommunicationRecord({
      recordType,
      recordId,
      relatedJobId: options.relatedJobId,
      direction: "inbound",
      channel: "Outlook",
      subject,
      body,
      from: draft.from.trim() || options.defaultFrom,
      to: options.to,
      status: "Received",
      messageId: `outlook-reply-${recordId}-${Date.now()}`,
    });
    resetCommunicationDraft(recordType, recordId);
    logAuditEvent({
      actor: created.from,
      action: "reply captured",
      recordType,
      recordId,
      summary: `Outlook reply captured on ${options.label}: ${created.subject}.`,
      source: "outlook capture",
      importance: "normal",
    });
    showNotice("Outlook reply captured against this record.");
  }

  function renderCommunicationThread(records: CommunicationRecord[]) {
    if (records.length === 0) {
      return <p>No Outlook messages captured yet.</p>;
    }

    return records.map((record) => (
      <article className="communication-item" key={record.id}>
        <span className={`communication-direction ${record.direction}`}>{record.direction}</span>
        <div>
          <strong>{record.subject}</strong>
          <p>{record.body}</p>
          <small>
            {record.from} to {record.to} · {record.createdAt} · {record.channel}
          </small>
        </div>
      </article>
    ));
  }

  function resetEmployeeDraft() {
    if (!activeEditingEmployee) return;
    setEmployeeRoleDraft(activeEditingEmployee.role);
    setEmployeePermissionDraft({ ...(activeEditingEmployee.permissions ?? {}) });
    setEmployeeProfileDraft(makeEmployeeProfileDraft(activeEditingEmployee));
    setActiveEmployeeTab("details");
  }

  function clearEmployeeEditingState() {
    setEditingEmployeeId(null);
    setEmployeePermissionDraft({});
    setEmployeeProfileDraft(createBlankEmployeeProfileDraft());
    setActiveEmployeeTab("details");
  }

  function returnToClientsDirectory() {
    setHomeView("clients");
    setActiveClientTab("overview");
    scrollWorkspaceToTop();
  }

  function returnToLeadsDirectory() {
    setHomeView("leads");
    setActiveLeadTab("details");
    scrollWorkspaceToTop();
  }

  function returnToDashboard() {
    setHomeView("dashboard");
    clearEmployeeEditingState();
    setActiveClientTab("overview");
    scrollWorkspaceToTop();
  }

  function goToPeopleSection(item: string) {
    setOpenModuleMenu(null);
    if (item === "Employees") {
      clearEmployeeEditingState();
      setHomeView("employees");
      scrollWorkspaceToTop();
      return;
    }
    if (item === "Clients") {
      setHomeView("clients");
      setActiveClientTab("overview");
      scrollWorkspaceToTop();
      return;
    }
    showNotice(`${item} module is coming soon in this build.`);
  }

  function openEmployeeCardView(employeeId: string) {
    setActiveEmployeeId(employeeId);
    setEditingEmployeeId(employeeId);
    setActiveEmployeeTab("details");
    setHomeView("employee-card");
  }

  function returnToEmployeeDirectory() {
    setHomeView("employees");
    clearEmployeeEditingState();
  }

  function scrollWorkspaceToTop() {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      document.querySelector(".workspace")?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function openClientRecordView(clientId: string) {
    setActiveClientId(clientId);
    setActiveClientTab("overview");
    setHomeView("client-record");
    scrollWorkspaceToTop();
  }

  function openLeadRecord(leadId: string) {
    setSelectedQuoteId(null);
    setSelectedJobId(null);
    setSelectedInvoiceId(null);
    setSelectedLeadId(leadId);
    setActiveLeadTab("details");
    setHomeView("lead-record");
    scrollWorkspaceToTop();
  }

  function closeDetailDrawers() {
    setSelectedLeadId(null);
    setSelectedQuoteId(null);
    setSelectedJobId(null);
    setSelectedInvoiceId(null);
    setHomeView("dashboard");
  }

  function openQuoteDrawer(quoteId: string) {
    setSelectedLeadId(null);
    setSelectedJobId(null);
    setSelectedQuoteCostCentreId(null);
    setSelectedInvoiceId(null);
    setSelectedQuoteId(quoteId);
    setActiveQuoteTab("setup");
    setHomeView("quote-record");
    scrollWorkspaceToTop();
  }

  function openJobDrawer(jobId: string) {
    setSelectedLeadId(null);
    setSelectedQuoteId(null);
    setSelectedQuoteCostCentreId(null);
    setSelectedInvoiceId(null);
    setSelectedJobId(jobId);
    setSelectedCostCentreId(null);
    setActiveJobTab("summary");
    setHomeView("job-record");
    scrollWorkspaceToTop();
  }

  function openInvoiceRecord(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    setActiveInvoiceTab("summary");
    setHomeView("invoice-record");
    scrollWorkspaceToTop();
  }

  function buildVariationsForJob(job: Job) {
    const capturedVariations = jobDeliveryEvents
      .filter((event) => event.jobId === job.id && event.kind === "variation")
      .map((event, index) => buildEventVariationFromDeliveryEvent(event, index));

    return [...capturedVariations, ...buildJobVariations(job)];
  }

  function openInvoiceForQuote(quote: Quote) {
    if (!quote) return;
    const existing = invoiceSourceMap.byQuote.get(quote.id) ?? null;
    if (existing) {
      openInvoiceRecord(existing.id);
      showNotice(`Opening existing invoice ${existing.ref} for ${quote.ref}.`);
      return;
    }

    const client = clients.find((item) => item.id === quote.clientId) ?? null;
    const sourceCentres = quoteCostCentres[quote.id] ?? [];

    if (!sourceCentres.length) {
      showNotice(`Quote ${quote.ref} does not yet have cost centres; invoice created from current values.`);
    }

    const created = makeInvoiceFromQuote(quote, client, sourceCentres, invoices);
    setInvoices((current) => [created, ...current]);
    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: "created",
      recordType: "invoice",
      recordId: created.id,
      summary: `Invoice ${created.ref} created from ${quote.ref} cost centres.`,
      source: "web",
      importance: "high",
    });
    openInvoiceRecord(created.id);
    showNotice(`Invoice ${created.ref} created from ${quote.ref}.`);
  }

  function openInvoiceForJob(job: Job) {
    if (!job) return;
    const existing = invoiceSourceMap.byJob.get(job.id) ?? null;
    if (existing) {
      openInvoiceRecord(existing.id);
      showNotice(`Opening existing invoice ${existing.ref} for ${job.ref}.`);
      return;
    }

    const client = clients.find((item) => item.id === job.clientId) ?? null;
    const sourceCentres = jobEstimateCostCentres[job.id] ?? makeDefaultEstimateCostCentres(job);
    const sourceLineTotals = buildInvoiceLineTotalsFromEstimate(sourceCentres);
    const sourceTotals = sourceLineTotals.reduce(
      (acc, line) => ({
        cost: acc.cost + line.costToUs,
        charge: acc.charge + line.chargeToClient,
        lineItems: [...acc.lineItems, line],
      }),
      { cost: 0, charge: 0, lineItems: [] as InvoiceLine[] },
    );

    const created = makeInvoiceFromJobTotals(job, client, sourceTotals, invoices, buildVariationsForJob(job));

    if (!sourceLineTotals.length) {
      showNotice(`Job ${job.ref} does not yet have cost centre lines; invoice created from current values.`);
    }

    setInvoices((current) => [created, ...current]);
    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: "created",
      recordType: "invoice",
      recordId: created.id,
      summary: `Invoice ${created.ref} created from ${job.ref} job estimate and variations.`,
      source: "web",
      importance: "high",
    });
    openInvoiceRecord(created.id);
    showNotice(`Invoice ${created.ref} created from ${job.ref}.`);
  }

  function updateSelectedInvoiceStatus(status: InvoiceStatus) {
    if (!selectedInvoice) return;
    if (selectedInvoice.status === status) return;

    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === selectedInvoice.id
          ? {
              ...invoice,
              status,
            }
          : invoice,
      ),
    );
    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: status.toLowerCase(),
      recordType: "invoice",
      recordId: selectedInvoice.id,
      summary: `Invoice ${selectedInvoice.ref} status changed to ${status}.`,
      source: "web",
      importance: status === "Paid" ? "high" : "normal",
    });
  }

  function updateSelectedInvoiceEmailDraft(patch: Partial<InvoiceEmailDraft>) {
    if (!selectedInvoice) return;
    const existing = invoiceEmailDrafts[selectedInvoice.id] ?? makeInvoiceEmailDraft(selectedInvoice, selectedInvoiceClient);
    setInvoiceEmailDrafts((current) => ({
      ...current,
      [selectedInvoice.id]: { ...existing, ...patch },
    }));
  }

  function sendSelectedInvoiceEmail() {
    if (!selectedInvoice || !selectedInvoiceEmailDraft) return;
    if (!selectedInvoiceEmailDraft.to.trim()) {
      showNotice("Add a recipient before sending the invoice.");
      return;
    }
    const sentAt = workflowTimestamp();
    const outlookMessageId = `outlook-${selectedInvoice.ref.toLowerCase()}-${Date.now()}`;
    const sourceJob =
      selectedInvoice.sourceType === "job"
        ? jobs.find((job) => job.id === selectedInvoice.sourceId) ?? null
        : null;
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === selectedInvoice.id
          ? {
              ...invoice,
              status: "Sent",
              sentTo: selectedInvoiceEmailDraft.to.trim(),
              sentAt,
              outlookMessageId,
            }
          : invoice,
      ),
    );
    if (sourceJob) {
      setJobs((current) =>
        current.map((job) =>
          job.id === sourceJob.id
            ? {
                ...job,
                status: "Invoiced",
                health: "green",
                next: `Invoice ${selectedInvoice.ref} sent. Await payment.`,
                due: selectedInvoice.dueDate,
              }
            : job,
        ),
      );
    }
    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: "emailed",
      recordType: "invoice",
      recordId: selectedInvoice.id,
      summary: `Invoice ${selectedInvoice.ref} emailed from Verrova via Outlook to ${selectedInvoiceEmailDraft.to}.`,
      source: "outlook draft",
      importance: "high",
    });
    if (sourceJob) {
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "invoiced",
        recordType: "job",
        recordId: sourceJob.id,
        summary: `${sourceJob.ref} marked Invoiced after ${selectedInvoice.ref} was emailed to ${selectedInvoiceEmailDraft.to}.`,
        source: "invoice email",
        importance: "high",
      });
    }
    addCommunicationRecord({
      recordType: "invoice",
      recordId: selectedInvoice.id,
      relatedJobId: selectedInvoice.sourceType === "job" ? selectedInvoice.sourceId : undefined,
      direction: "outbound",
      channel: "Outlook",
      subject: selectedInvoiceEmailDraft.subject,
      body: selectedInvoiceEmailDraft.body,
      from: "accounts@errolwatsongroup.co.uk",
      to: selectedInvoiceEmailDraft.to.trim(),
      cc: selectedInvoiceEmailDraft.cc.trim(),
      messageId: outlookMessageId,
      status: "Sent",
    });
    showNotice(sourceJob ? `Invoice ${selectedInvoice.ref} sent and ${sourceJob.ref} marked invoiced.` : `Invoice ${selectedInvoice.ref} sent and logged.`);
  }

  function openQuoteCostCentreRecord(centreId: string) {
    setSelectedQuoteCostCentreId(centreId);
    setActiveCostCentreTab("summary");
    setHomeView("quote-cost-centre-record");
  }

  function openCostCentreRecord(centreId: string) {
    setSelectedCostCentreId(centreId);
    setActiveCostCentreTab("summary");
    setHomeView("cost-centre-record");
  }

  function returnToInvoiceDirectory() {
    setSelectedInvoiceId(null);
    setActiveInvoiceTab("summary");
    setHomeView("invoices");
  }

  function returnFromInvoiceRecord() {
    if (selectedInvoice?.sourceType === "quote" && selectedInvoiceSourceQuote) {
      openQuoteDrawer(selectedInvoiceSourceQuote.id);
      return;
    }

    if (selectedInvoice?.sourceType === "job" && selectedInvoiceSourceJob) {
      openJobDrawer(selectedInvoiceSourceJob.id);
      return;
    }

    returnToInvoiceDirectory();
  }

  function markQuoteReviewQuestionChecked(questionId: string) {
    setCheckedQuoteReviewQuestions((current) => ({
      ...current,
      [questionId]: true,
    }));
  }

  function actOnQuoteReviewQuestion(question: QuoteReviewQuestion) {
    if (question.action === "open-centre" && question.centreId) {
      openQuoteCostCentreRecord(question.centreId);
      return;
    }

    if (question.action === "cost-build") {
      setActiveQuoteTab("cost-build");
      return;
    }

    showNotice("Review noted.");
  }

  function updateSelectedQuoteEmailDraft(patch: Partial<QuoteEmailDraft>) {
    if (!selectedQuote) return;
    const existing = quoteEmailDrafts[selectedQuote.id] ?? makeQuoteEmailDraft(selectedQuote, selectedQuoteClient);
    setQuoteEmailDrafts((current) => ({
      ...current,
      [selectedQuote.id]: { ...existing, ...patch },
    }));
  }

  async function persistQuotePatch(quoteId: string, patch: Partial<Quote>) {
    const response = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("Unable to update quote");
    const updated = (await response.json()) as Quote;
    setQuotes((current) => current.map((quote) => (quote.id === updated.id ? updated : quote)));
    return updated;
  }

  async function sendSelectedQuoteEmail() {
    if (!selectedQuote || !selectedQuoteEmailDraft) return;
    if (!selectedQuoteEmailDraft.to.trim()) {
      showNotice("Add a recipient before sending the quote.");
      return;
    }

    const portalToken = selectedQuote.portalToken ?? makeQuotePortalToken(selectedQuote);
    const portalBaseUrl = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";
    const portalUrl = selectedQuote.portalUrl ?? `${portalBaseUrl}/client/quotes/${portalToken}`;
    const sentAt = workflowTimestamp();
    const outlookMessageId = `outlook-${selectedQuote.ref.toLowerCase()}-${Date.now()}`;

    try {
      await persistQuotePatch(selectedQuote.id, {
        status: "Sent" as QuoteStatus,
        next: "Await customer response",
        portalToken,
        portalUrl,
        outlookMessageId,
        sentAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send quote right now.";
      setSectionError(message);
      showNotice(message);
      return;
    }

    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: "emailed",
      recordType: "quote",
      recordId: selectedQuote.id,
      summary: `${selectedQuote.ref} emailed from Verrova via Outlook to ${selectedQuoteEmailDraft.to} with ${documentLayouts.find((layout) => layout.key === selectedQuoteEmailDraft.layout)?.label ?? "quote"} PDF attached. Portal link: ${portalUrl}.`,
      source: "outlook draft",
      importance: "normal",
    });
    addCommunicationRecord({
      recordType: "quote",
      recordId: selectedQuote.id,
      relatedJobId: selectedQuote.convertedJobId,
      direction: "outbound",
      channel: "Outlook",
      subject: selectedQuoteEmailDraft.subject,
      body: `${selectedQuoteEmailDraft.body}\n\nPortal link: ${portalUrl}`,
      from: "office@errolwatsongroup.co.uk",
      to: selectedQuoteEmailDraft.to.trim(),
      cc: selectedQuoteEmailDraft.cc.trim(),
      messageId: outlookMessageId,
      status: "Sent",
    });

    showNotice("Quote sent from Verrova and captured against the quote.");
  }

  async function logQuotePortalViewed() {
    if (!selectedQuote) return;
    const viewedAt = workflowTimestamp();
    try {
      await persistQuotePatch(selectedQuote.id, { viewedAt });
    } catch {
      showNotice("Portal view logged locally, but quote metadata could not be updated.");
    }
    logAuditEvent({
      actor: selectedQuoteClient?.primaryContact ?? selectedQuote.customer,
      action: "viewed",
      recordType: "quote",
      recordId: selectedQuote.id,
      summary: `${selectedQuote.ref} was opened in the client portal.`,
      source: "client portal",
      importance: "normal",
    });
    showNotice("Client portal view logged on the quote timeline.");
  }

  async function respondToQuoteOnline(status: Extract<QuoteStatus, "Accepted" | "Declined">) {
    if (!selectedQuote) return;
    const respondedAt = workflowTimestamp();
    let updatedQuote: Quote;
    try {
      updatedQuote = await persistQuotePatch(selectedQuote.id, {
        status,
        next: status === "Accepted" ? "Create pending job and schedule" : "Review client feedback",
        respondedAt,
        viewedAt: selectedQuote.viewedAt ?? respondedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to record the online response.";
      setSectionError(message);
      showNotice(message);
      return;
    }
    logAuditEvent({
      actor: selectedQuoteClient?.primaryContact ?? selectedQuote.customer,
      action: status === "Accepted" ? "accepted" : "declined",
      recordType: "quote",
      recordId: selectedQuote.id,
      summary: `${selectedQuote.ref} was ${status.toLowerCase()} online via the client portal.`,
      source: "client portal",
      importance: status === "Accepted" ? "high" : "normal",
    });
    if (status === "Accepted" && !updatedQuote.convertedJobId) {
      await convertQuoteToJob(updatedQuote);
      return;
    }
    showNotice(status === "Accepted" ? "Quote accepted online and logged." : "Quote declined online and logged.");
  }

  function returnToQuoteRecord() {
    setSelectedQuoteCostCentreId(null);
    setHomeView("quote-record");
    setActiveQuoteTab("cost-build");
  }

  function returnToJobRecord() {
    setSelectedCostCentreId(null);
    setHomeView("job-record");
    setActiveJobTab("cost-centres");
  }

  function updateSelectedJobScheduleDraft(patch: Partial<JobScheduleDraft>) {
    if (!selectedJob) return;
    setJobScheduleDrafts((current) => {
      const existing = current[selectedJob.id] ?? {
        manager: selectedJob.manager,
        scheduledDate: selectedJob.scheduledDate ?? "",
        scheduledTime: selectedJob.scheduledTime ?? "",
      };
      return {
        ...current,
        [selectedJob.id]: { ...existing, ...patch },
      };
    });
  }

  function updateSelectedJobDeliveryDraft(patch: Partial<JobDeliveryDraft>) {
    if (!selectedJob) return;
    setJobDeliveryDrafts((current) => ({
      ...current,
      [selectedJob.id]: { ...(current[selectedJob.id] ?? blankJobDeliveryDraft), ...patch },
    }));
  }

  function resetSelectedJobDeliveryDraft(patch: Partial<JobDeliveryDraft>) {
    if (!selectedJob) return;
    setJobDeliveryDrafts((current) => ({
      ...current,
      [selectedJob.id]: { ...(current[selectedJob.id] ?? blankJobDeliveryDraft), ...patch },
    }));
  }

  function addJobDeliveryEvent(event: Omit<JobDeliveryEvent, "id" | "createdAt">) {
    const created: JobDeliveryEvent = {
      ...event,
      id: `delivery-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      createdAt: workflowTimestamp(),
    };
    setJobDeliveryEvents((current) => [created, ...current]);
    return created;
  }

  function logSelectedJobWhatsappUpdate() {
    if (!selectedJob) return;
    const note = selectedJobDeliveryDraft.whatsappNote.trim();
    if (!note) {
      showNotice("Add a WhatsApp/site update first.");
      return;
    }
    const created = addJobDeliveryEvent({
      jobId: selectedJob.id,
      jobRef: selectedJob.ref,
      kind: "whatsapp",
      actor: activeEmployee?.name ?? selectedJob.manager,
      summary: note,
      source: "WhatsApp",
      status: "Captured",
    });
    resetSelectedJobDeliveryDraft({ whatsappNote: "" });
    logAuditEvent({
      actor: created.actor,
      action: "captured",
      recordType: "job",
      recordId: selectedJob.id,
      summary: `WhatsApp update captured for ${selectedJob.ref}: ${note}`,
      source: "whatsapp doorway",
      importance: "normal",
    });
    showNotice("WhatsApp update captured against the job.");
  }

  function submitSelectedJobTimesheet() {
    if (!selectedJob) return;
    const hours = Number(selectedJobDeliveryDraft.timesheetHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      showNotice("Enter the hours before submitting the timesheet.");
      return;
    }
    const note = selectedJobDeliveryDraft.timesheetNote.trim() || `${hours} hrs submitted by ${selectedJob.manager}.`;
    const created = addJobDeliveryEvent({
      jobId: selectedJob.id,
      jobRef: selectedJob.ref,
      kind: "timesheet",
      actor: selectedJob.manager,
      summary: note,
      source: "WhatsApp",
      hours,
      status: "Submitted",
    });
    resetSelectedJobDeliveryDraft({ timesheetHours: "", timesheetNote: "" });
    logAuditEvent({
      actor: created.actor,
      action: "submitted",
      recordType: "job",
      recordId: selectedJob.id,
      summary: `${hours} hrs timesheet submitted for ${selectedJob.ref}.`,
      source: "timesheet capture",
      importance: "normal",
    });
    showNotice("Timesheet captured against the job.");
  }

  function raiseSelectedJobVariation() {
    if (!selectedJob) return;
    const description = selectedJobDeliveryDraft.variationDescription.trim();
    if (!description) {
      showNotice("Describe the variation before raising it.");
      return;
    }
    const hours = Number(selectedJobDeliveryDraft.variationHours) || 0;
    const costValue = Number(selectedJobDeliveryDraft.variationCost) || Math.round(hours * 40);
    const sellValue = Number(selectedJobDeliveryDraft.variationSell) || Math.round(costValue * 1.3);
    addJobDeliveryEvent({
      jobId: selectedJob.id,
      jobRef: selectedJob.ref,
      kind: "variation",
      actor: selectedJob.manager,
      summary: description,
      source: "WhatsApp",
      hours,
      materials: selectedJobDeliveryDraft.variationMaterials.trim(),
      costValue,
      sellValue,
      reason: "Engineer raised",
      requiresClientApproval: true,
      status: "Office review",
    });
    resetSelectedJobDeliveryDraft({
      variationDescription: "",
      variationHours: "",
      variationMaterials: "",
      variationCost: "",
      variationSell: "",
    });
    logAuditEvent({
      actor: selectedJob.manager,
      action: "variation raised",
      recordType: "job",
      recordId: selectedJob.id,
      summary: `Variation raised for ${selectedJob.ref}: ${description}. Office review required before client approval.`,
      source: "variation capture",
      importance: "high",
    });
    showNotice("Variation draft created for office review.");
  }

  function updateSelectedJobVariationEvent(variationId: string, patch: Partial<JobDeliveryEvent>) {
    if (!selectedJob) return null;
    let updated: JobDeliveryEvent | undefined;
    setJobDeliveryEvents((current) =>
      current.map((event) => {
        if (event.id !== variationId || event.jobId !== selectedJob.id || event.kind !== "variation") {
          return event;
        }
        updated = { ...event, ...patch };
        return updated;
      }),
    );
    return updated ?? null;
  }

  function sendSelectedJobVariationForApproval(variationId: string) {
    if (!selectedJob) return;
    const variationEvent = jobDeliveryEvents.find((event) => event.id === variationId && event.kind === "variation" && event.jobId === selectedJob.id);
    if (!variationEvent) {
      showNotice("This variation is not yet linked to a live event.");
      return;
    }
    if (!variationEvent.requiresClientApproval) {
      const approved = updateSelectedJobVariationEvent(variationEvent.id, { status: "Approved", clientApprovalStatus: "Approved" });
      if (!approved) {
        showNotice("Could not update variation status.");
        return;
      }
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "approved",
        recordType: "job",
        recordId: selectedJob.id,
        summary: `${variationEvent.summary} marked approved on ${selectedJob.ref}.`,
        source: "variation actions",
        importance: "high",
      });
      showNotice(`${variationEvent.summary} marked as approved (no client approval required).`);
      return;
    }
    if (variationEvent.status === "Client approved") {
      showNotice("Variation already approved by client.");
      return;
    }
    if (variationEvent.status === "Sent for approval") {
      showNotice("Variation already sent to client for approval.");
      return;
    }
    const clientEmail = selectedJobClient?.email ?? selectedJob.customer;

    const requestVariationApproval = async () => {
      const response = await fetch("/api/variation-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variationEventId: variationEvent.id,
          jobId: selectedJob.id,
          jobRef: selectedJob.ref,
          summary: variationEvent.summary,
          description: variationEvent.summary,
          costValue: variationEvent.costValue ?? 0,
          sellValue: variationEvent.sellValue ?? 0,
          actor: activeEmployee?.name ?? selectedJob.manager,
          clientEmail,
          requiresClientApproval: variationEvent.requiresClientApproval ?? true,
        }),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error((errorPayload as { error?: string })?.error ?? "Unable to send the variation approval request.");
      }
      return response.json() as Promise<{ token: string }>;
    };

    requestVariationApproval()
      .then((created) => {
        const target = updateSelectedJobVariationEvent(variationEvent.id, {
          status: "Sent for approval",
          clientApprovalStatus: "Sent",
          portalToken: created.token,
        });
        if (!target) {
          showNotice("Could not update variation status.");
          return;
        }

        const portalUrl = variationPortalLink(created.token);
        addCommunicationRecord({
          recordType: "job",
          recordId: selectedJob.id,
          relatedJobId: selectedJob.id,
          direction: "outbound",
          channel: "Client portal",
          subject: `${variationEvent.summary} - approval requested`,
          body: `Please review and approve the additional variation for ${selectedJob.ref}. Amount: ${currency(target.sellValue ?? 0)}.\n\nApprove here: ${portalUrl}`,
          from: "office@errolwatsongroup.co.uk",
          to: clientEmail,
          status: "Sent",
        });

        logAuditEvent({
          actor: activeEmployee?.name ?? selectedJob.manager,
          action: "variation approval requested",
          recordType: "job",
          recordId: selectedJob.id,
          summary: `Variation ${target.summary} sent to client for approval from ${selectedJob.ref}.`,
          source: "variation actions",
          importance: "high",
        });
        showNotice(`Variation sent to client via variation approval flow. ${formatVariationPortalCopyNotice(target)}`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to send variation approval request.";
        showNotice(message);
      });
  }

  function approveSelectedJobVariation(variationId: string) {
    if (!selectedJob) return;
    const variationEvent = jobDeliveryEvents.find((event) => event.id === variationId && event.kind === "variation" && event.jobId === selectedJob.id);
    if (!variationEvent) {
      showNotice("This variation is not yet linked to a live event.");
      return;
    }
    if (variationEvent.status === "Approved" || variationEvent.status === "Client approved") {
      showNotice("Variation is already approved for job billing/proceed.");
      return;
    }
    if (variationEvent.requiresClientApproval && variationEvent.status !== "Sent for approval") {
      showNotice("Send this variation for client approval before marking approved.");
      return;
    }

    const nextStatus = variationEvent.requiresClientApproval ? "Client approved" : "Approved";
    const target = updateSelectedJobVariationEvent(variationEvent.id, {
      status: nextStatus,
      clientApprovalStatus: variationEvent.requiresClientApproval ? "Approved" : undefined,
    });
    if (!target) {
      showNotice("Could not update variation status.");
      return;
    }
    logAuditEvent({
      actor: activeEmployee?.name ?? selectedJob.manager,
      action: "variation approved",
      recordType: "job",
      recordId: selectedJob.id,
      summary: `${variationEvent.summary} approved for ${selectedJob.ref}.`,
      source: "variation actions",
      importance: "high",
    });
    showNotice("Variation approved and marked ready to proceed.");
  }

  async function copySelectedJobVariationPortalLink(variationId: string) {
    if (typeof window === "undefined") return;
    if (!selectedJob) return;
    const variationEvent = jobDeliveryEvents.find((event) => event.id === variationId && event.kind === "variation" && event.jobId === selectedJob.id);
    if (!variationEvent?.portalToken) {
      showNotice("No portal link has been generated for this variation yet.");
      return;
    }

    const portalUrl = variationPortalLink(variationEvent.portalToken);
    try {
      await window.navigator.clipboard.writeText(portalUrl);
      showNotice(`Copied variation approval link for ${variationEvent.summary}.`);
    } catch {
      showNotice(`Copy manually from here: ${portalUrl}`);
    }
  }

  async function refreshSelectedJobVariationPortalStatuses() {
    if (!selectedJob) return;
    try {
      const response = await fetch(`/api/variation-portal?jobId=${encodeURIComponent(selectedJob.id)}`);
      if (!response.ok) return;
      const records = await response.json() as VariationPortalSyncRecord[];
      const byEvent = new Map<string, VariationPortalSyncRecord>(records.map((entry) => [entry.variationEventId, entry]));

      setJobDeliveryEvents((current) =>
        current.map((event) => {
          if (
            event.jobId !== selectedJob.id ||
            event.kind !== "variation" ||
            !byEvent.has(event.id)
          ) {
            return event;
          }

          const portalStatus = byEvent.get(event.id);
          if (!portalStatus) return event;
          return {
            ...event,
            portalToken: portalStatus.token,
            status: mapVariationEventStatusFromPortalStatus(portalStatus.status),
            clientApprovalStatus: mapVariationClientStatusFromPortalStatus(portalStatus.status),
          };
        }),
      );
    } catch {
      // If the portal service is unavailable we keep local status.
    }
  }

  async function requestSelectedJobPurchaseOrder() {
    if (!selectedJob) return;
    const supplier = selectedJobDeliveryDraft.poSupplier.trim();
    const item = selectedJobDeliveryDraft.poItem.trim();
    if (!supplier || !item) {
      showNotice("Add the supplier and item before requesting a PO.");
      return;
    }

    try {
      const response = await fetch("/api/purchase-requests", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: selectedJob.id,
          jobRef: selectedJob.ref,
          requestedBy: activeEmployee?.name ?? selectedJob.manager,
          supplier,
          item,
          estimatedCost: Number(selectedJobDeliveryDraft.poEstimatedCost) || 0,
          reason: selectedJobDeliveryDraft.poReason.trim() || "Requested during job delivery",
        }),
      });

      if (!response.ok) throw new Error("Unable to create purchase request");

      const created = (await response.json()) as PurchaseRequest;
      setPurchaseRequests((current) => [created, ...current]);
      addJobDeliveryEvent({
        jobId: selectedJob.id,
        jobRef: selectedJob.ref,
        kind: "po",
        actor: created.requestedBy,
        summary: `${created.item} from ${created.supplier}`,
        source: "Verrova",
        costValue: created.estimatedCost,
        status: created.status,
      });
      resetSelectedJobDeliveryDraft({
        poSupplier: "",
        poItem: "",
        poEstimatedCost: "",
        poReason: "",
      });
      logAuditEvent({
        actor: created.requestedBy,
        action: "created",
        recordType: "purchase_request",
        recordId: created.id,
        summary: `PO request created for ${created.jobRef} with ${created.supplier}.`,
        source: "job delivery",
        importance: "normal",
      });
      showNotice("PO request submitted for office approval.");
    } catch {
      setSectionError("Unable to submit PO request right now.");
    }
  }

  async function patchSelectedJob(patch: Partial<Job>, successMessage: string) {
    if (!selectedJob) return null;
    type JobScheduleConflict = {
      conflict: true;
      message: string;
    };

    const response = await fetch(`/api/jobs/${selectedJob.id}`, {
      method: "PATCH",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (response.status === 409) {
      const conflict = (await response.json()) as JobScheduleConflict;
      const warning = conflict.message || "Selected slot is already taken.";
      setSectionError(warning);
      showNotice(warning);
      return null;
    }

    if (!response.ok) {
      throw new Error("Unable to update job");
    }

    const updated = (await response.json()) as Job;
    setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
    showNotice(successMessage);
    return updated;
  }

  async function scheduleSelectedJob() {
    if (!selectedJob || !selectedJobScheduleDraft) return;
    if (!selectedJobScheduleDraft.manager || !selectedJobScheduleDraft.scheduledDate || !selectedJobScheduleDraft.scheduledTime) {
      showNotice("Choose an engineer, date and time before scheduling this job.");
      return;
    }

    try {
      const updated = await patchSelectedJob(
        {
          manager: selectedJobScheduleDraft.manager,
          scheduledDate: selectedJobScheduleDraft.scheduledDate,
          scheduledTime: selectedJobScheduleDraft.scheduledTime,
          status: "Scheduled",
          next: "Engineer scheduled. Await attendance confirmation.",
        },
        `${selectedJob.ref} scheduled for ${selectedJobScheduleDraft.scheduledDate} at ${selectedJobScheduleDraft.scheduledTime}.`,
      );
      if (!updated) return;
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "scheduled",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.ref} scheduled with ${updated.manager} on ${updated.scheduledDate} at ${updated.scheduledTime}.`,
        source: "scheduler",
        importance: "high",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to schedule job.";
      setSectionError(message);
      showNotice(message);
    }
  }

  function requestSelectedJobAttendanceConfirmation() {
    if (!selectedJob) return;
    if (!selectedJob.scheduledDate || !selectedJob.scheduledTime) {
      showNotice("Schedule the job before requesting attendance confirmation.");
      return;
    }

    const created = addJobDeliveryEvent({
      jobId: selectedJob.id,
      jobRef: selectedJob.ref,
      kind: "attendance",
      actor: activeEmployee?.name ?? "Verrova user",
      summary: `Attendance confirmation requested from ${selectedJob.manager} for ${selectedJob.scheduledDate} at ${selectedJob.scheduledTime}.`,
      source: "WhatsApp",
      status: "Requested",
    });
    logAuditEvent({
      actor: created.actor,
      action: "attendance requested",
      recordType: "job",
      recordId: selectedJob.id,
      summary: `${selectedJob.manager} was asked to confirm attendance for ${selectedJob.ref}.`,
      source: "schedule confirmation",
      importance: "normal",
    });
    showNotice("Attendance confirmation requested and logged.");
  }

  async function confirmSelectedJobAttendance() {
    if (!selectedJob) return;
    if (!selectedJob.scheduledDate || !selectedJob.scheduledTime) {
      showNotice("Schedule the job before confirming attendance.");
      return;
    }

    try {
      const created = addJobDeliveryEvent({
        jobId: selectedJob.id,
        jobRef: selectedJob.ref,
        kind: "attendance",
        actor: selectedJob.manager,
        summary: `${selectedJob.manager} confirmed attendance for ${selectedJob.scheduledDate} at ${selectedJob.scheduledTime}.`,
        source: "WhatsApp",
        status: "Confirmed",
      });
      const updated = await patchSelectedJob(
        {
          next: `${selectedJob.manager} confirmed attendance. Await arrival on site.`,
        },
        `${selectedJob.ref} attendance confirmed.`,
      );
      if (!updated) return;
      logAuditEvent({
        actor: created.actor,
        action: "attendance confirmed",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.manager} confirmed scheduled attendance for ${updated.ref}.`,
        source: "schedule confirmation",
        importance: "high",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to confirm attendance.";
      setSectionError(message);
      showNotice(message);
    }
  }

  async function markSelectedJobArrived() {
    if (!selectedJob) return;
    if (!selectedJob.scheduledDate || !selectedJob.scheduledTime) {
      showNotice("Schedule the job before marking arrival.");
      return;
    }

    try {
      const created = addJobDeliveryEvent({
        jobId: selectedJob.id,
        jobRef: selectedJob.ref,
        kind: "attendance",
        actor: selectedJob.manager,
        summary: `${selectedJob.manager} arrived on site for ${selectedJob.ref}.`,
        source: "WhatsApp",
        status: "Arrived",
      });
      const updated = await patchSelectedJob(
        {
          status: "In progress",
          next: "Engineer on site. Track timesheets, POs, WhatsApp updates and variations.",
        },
        `${selectedJob.ref} marked arrived and moved to in progress.`,
      );
      if (!updated) return;
      logAuditEvent({
        actor: created.actor,
        action: "arrived",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.manager} arrived on site and ${updated.ref} moved into delivery.`,
        source: "schedule confirmation",
        importance: "high",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to mark job arrived.";
      setSectionError(message);
      showNotice(message);
    }
  }

  async function startSelectedJob() {
    if (!selectedJob) return;
    if (!selectedJob.scheduledDate || !selectedJob.scheduledTime) {
      showNotice("Schedule the job before starting it.");
      return;
    }
    try {
      const updated = await patchSelectedJob(
        {
          status: "In progress",
          next: "Track timesheets, POs, WhatsApp updates and variations.",
        },
        `${selectedJob.ref} moved to in progress.`,
      );
      if (!updated) return;
      addJobDeliveryEvent({
        jobId: updated.id,
        jobRef: updated.ref,
        kind: "attendance",
        actor: updated.manager,
        summary: `${updated.manager} started ${updated.ref} from the schedule control.`,
        source: "Verrova",
        status: "Arrived",
      });
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "started",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.ref} moved from scheduled into in progress delivery.`,
        source: "scheduler",
        importance: "high",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start job.";
      setSectionError(message);
      showNotice(message);
    }
  }

  async function completeSelectedJob() {
    if (!selectedJob) return;
    try {
      const updated = await patchSelectedJob(
        {
          status: "Completed",
          next: "Completion review required before invoicing.",
        },
        `${selectedJob.ref} marked complete and sent for review.`,
      );
      if (!updated) return;
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "completed",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.ref} marked complete and moved into office review.`,
        source: "job completion",
        importance: "high",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to complete job.";
      setSectionError(message);
      showNotice(message);
    }
  }

  function toggleSelectedJobReview(check: JobReviewKey) {
    if (!selectedJob) return;
    setJobReviewApprovals((current) => {
      const existing = current[selectedJob.id] ?? emptyJobReviewState;
      const next = { ...existing, [check]: !existing[check] };
      return { ...current, [selectedJob.id]: next };
    });
    const checkLabel = jobReviewChecks.find((item) => item.key === check)?.label ?? "Review";
    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: "reviewed",
      recordType: "job",
      recordId: selectedJob.id,
      summary: `${checkLabel} ${selectedJobReviewState[check] ? "unchecked" : "approved"} for ${selectedJob.ref}.`,
      source: "completion review",
      importance: "normal",
    });
  }

  async function approveSelectedJobForInvoice() {
    if (!selectedJob) return;
    if (!selectedJobReviewComplete) {
      showNotice("All completion review checks must be ticked before invoicing.");
      return;
    }
    try {
      const updated = await patchSelectedJob(
        {
          status: "Ready to invoice",
          next: "Raise and email final invoice.",
        },
        `${selectedJob.ref} approved and ready to invoice.`,
      );
      if (!updated) return;
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "approved",
        recordType: "job",
        recordId: updated.id,
        summary: `${updated.ref} passed completion review and is ready to invoice.`,
        source: "completion review",
        importance: "high",
      });
      openInvoiceForJob(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to approve job for invoice.";
      setSectionError(message);
      showNotice(message);
    }
  }

  function setJobCentresForSelected(updater: (centres: EstimateCostCentre[]) => EstimateCostCentre[]) {
    if (!selectedJob) return;
    setJobEstimateCostCentres((current) => {
      const existing = current[selectedJob.id] ?? makeDefaultEstimateCostCentres(selectedJob);
      return {
        ...current,
        [selectedJob.id]: updater(existing),
      };
    });
  }

  function addJobCostCentre() {
    if (!selectedJob) return;
    setJobCentresForSelected((centres) => [
      ...centres,
      makeEstimateCostCentre(selectedJob.id, centres.length, jobCostCentreNameDraft, jobCostCentreTemplateDraft),
    ]);
    setJobCostCentreNameDraft("");
  }

  function updateEstimateCostCentre(centreId: string, patch: Partial<EstimateCostCentre>) {
    setJobCentresForSelected((centres) =>
      centres.map((centre) => (centre.id === centreId ? { ...centre, ...patch } : centre)),
    );
  }

  function addEstimateMaterialLine(centreId: string, catalogItemId: string) {
    const item = quoteCatalog.find((catalogItem) => catalogItem.id === catalogItemId) ?? quoteCatalog[0];
    if (!item) return;

    setJobCentresForSelected((centres) =>
      centres.map((centre) =>
        centre.id === centreId
          ? { ...centre, materials: [...centre.materials, makeEstimateMaterialLine(item)] }
          : centre,
      ),
    );
  }

  function updateEstimateMaterialLine(centreId: string, lineId: string, patch: Partial<EstimateMaterialLine>) {
    setJobCentresForSelected((centres) =>
      centres.map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              materials: centre.materials.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
            }
          : centre,
      ),
    );
  }

  function removeEstimateMaterialLine(centreId: string, lineId: string) {
    setJobCentresForSelected((centres) =>
      centres.map((centre) =>
        centre.id === centreId
          ? { ...centre, materials: centre.materials.filter((line) => line.id !== lineId) }
          : centre,
      ),
    );
  }

  function addEstimateLabourLine(centreId: string) {
    setJobCentresForSelected((centres) =>
      centres.map((centre) =>
        centre.id === centreId
          ? { ...centre, labour: [...centre.labour, makeEstimateLabourLine()] }
          : centre,
      ),
    );
  }

  function updateEstimateLabourLine(centreId: string, lineId: string, patch: Partial<EstimateLabourLine>) {
    setJobCentresForSelected((centres) =>
      centres.map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              labour: centre.labour.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
            }
          : centre,
      ),
    );
  }

  function removeEstimateLabourLine(centreId: string, lineId: string) {
    setJobCentresForSelected((centres) =>
      centres.map((centre) =>
        centre.id === centreId
          ? { ...centre, labour: centre.labour.filter((line) => line.id !== lineId) }
          : centre,
      ),
    );
  }

  function returnFromRecord() {
    setSelectedQuoteId(null);
    setSelectedJobId(null);
    setSelectedQuoteCostCentreId(null);
    setSelectedCostCentreId(null);
    setHomeView("dashboard");
  }

  function addQuoteCostCentre() {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => {
      const existing = current[selectedQuote.id] ?? [];
      return {
        ...current,
        [selectedQuote.id]: [
          ...existing,
          makeQuoteCostCentre(selectedQuote.id, existing.length, quoteCostCentreNameDraft, quoteCostCentreTemplateDraft),
        ],
      };
    });
    setQuoteCostCentreNameDraft("");
  }

  function startRenameCostCentre(scope: "quote" | "job", centre: QuoteCostCentre | EstimateCostCentre) {
    setRenamingCostCentre({ scope, id: centre.id });
    setRenameCostCentreDraft(centre.name);
    setCostCentreActionMenu(null);
  }

  function saveRenameCostCentre() {
    if (!renamingCostCentre) return;
    const name = renameCostCentreDraft.trim();
    if (!name) return;
    if (renamingCostCentre.scope === "quote") {
      updateQuoteCostCentreName(renamingCostCentre.id, name);
    } else {
      updateEstimateCostCentre(renamingCostCentre.id, { name });
    }
    setRenamingCostCentre(null);
    setRenameCostCentreDraft("");
  }

  function cancelRenameCostCentre() {
    setRenamingCostCentre(null);
    setRenameCostCentreDraft("");
  }

  function updateQuoteCostCentre(centreId: string, patch: Partial<QuoteCostCentre>) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId ? { ...centre, ...patch } : centre,
      ),
    }));
  }

  function updateQuoteCostCentreName(centreId: string, name: string) {
    updateQuoteCostCentre(centreId, { name });
  }

  function makeSurveyAsset(centre: QuoteCostCentre, kind: SurveyAssetKind): SurveyAsset {
    const stamp = new Date().toISOString();
    const count = (centre.surveyAssets ?? []).filter((asset) => asset.kind === kind).length + 1;
    const defaults: Record<SurveyAssetKind, Pick<SurveyAsset, "title" | "detail" | "status" | "clientVisible">> = {
      "Room scan": {
        title: `${centre.name} room scan ${count}`,
        detail: "Draft iPad room scan placeholder. Later this will hold dimensions, openings, ceiling height and scan file output.",
        status: "Draft",
        clientVisible: false,
      },
      "Survey photo": {
        title: `${centre.name} survey photo ${count}`,
        detail: "Survey evidence placeholder. Later this can be uploaded from the iPad and marked internal or client visible.",
        status: "Review",
        clientVisible: false,
      },
      "Concept look": {
        title: `${centre.name} concept option ${count}`,
        detail: "Client concept placeholder. Later this can be generated from the room photo and selected finish style.",
        status: "Ready",
        clientVisible: true,
      },
    };

    return {
      id: `${centre.id}-survey-${Date.now()}-${count}`,
      kind,
      createdAt: stamp,
      ...defaults[kind],
    };
  }

  function addSurveyAssetToQuoteCentre(centre: QuoteCostCentre, kind: SurveyAssetKind) {
    const asset = makeSurveyAsset(centre, kind);
    updateQuoteCostCentre(centre.id, { surveyAssets: [asset, ...(centre.surveyAssets ?? [])] });
    showNotice(`${asset.kind} added to ${centre.name}.`);
  }

  function toggleSurveyAssetClientVisible(centreId: string, assetId: string) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              surveyAssets: (centre.surveyAssets ?? []).map((asset) =>
                asset.id === assetId ? { ...asset, clientVisible: !asset.clientVisible } : asset,
              ),
            }
          : centre,
      ),
    }));
  }

  function importSampleTakeoffRows(centre: QuoteCostCentre) {
    const rows = makeSampleTakeoffRows(centre);
    updateQuoteCostCentre(centre.id, { takeoffRows: [...(centre.takeoffRows ?? []), ...rows] });
    setActiveQuoteBuildTab("takeoff");
    showNotice(`${rows.length} takeoff / BOQ rows imported for review.`);
  }

  function updateTakeoffRow(centreId: string, rowId: string, patch: Partial<TakeoffBoqRow>) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              takeoffRows: (centre.takeoffRows ?? []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
            }
          : centre,
      ),
    }));
  }

  function applyTakeoffRowsToQuote(centre: QuoteCostCentre) {
    if (!selectedQuote) return;
    const rows = centre.takeoffRows ?? [];
    if (!rows.length) {
      showNotice("Import or add takeoff rows before applying them to the quote.");
      return;
    }

    const lines = rows.map(makeTakeoffQuoteLine);
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((item) =>
        item.id === centre.id
          ? {
              ...item,
              lines: [
                ...item.lines.filter((line) => !lines.some((takeoffLine) => takeoffLine.id === line.id)),
                ...lines,
              ],
            }
          : item,
      ),
    }));
    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova",
      action: "imported",
      recordType: "quote",
      recordId: selectedQuote.id,
      summary: `${rows.length} takeoff / BOQ row(s) applied into ${centre.name}.`,
      source: "web",
      importance: "normal",
    });
    showNotice(`${rows.length} takeoff / BOQ row(s) applied to the scope summary.`);
  }

  async function handleTakeoffDocumentUpload(centre: QuoteCostCentre, kind: TakeoffDocumentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const document = makeTakeoffDocument(kind, file.name);
    const parseResult = await parseTakeoffRowsFromUpload(centre, document, file).catch(() => ({
      rows: makeTakeoffRowsFromDocument(centre, document),
      status: "fallback" as const,
      notes: ["Upload parsing failed; fallback draft lines added."],
    }));

    const rows = parseResult.rows.length ? parseResult.rows : makeTakeoffRowsFromDocument(centre, document);
    const recordDocument: TakeoffSourceDocument = {
      ...document,
      questions: [...document.questions, ...parseResult.notes],
    };

    updateQuoteCostCentre(centre.id, {
      takeoffDocuments: [...(centre.takeoffDocuments ?? []), recordDocument],
      takeoffRows: [...(centre.takeoffRows ?? []), ...rows],
    });

    if (selectedQuote) {
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova",
        action: "uploaded",
        recordType: "quote",
        recordId: selectedQuote.id,
        summary: `${kind} file ${file.name} uploaded into ${centre.name}; ${rows.length} draft takeoff row(s) created for review.${parseResult.status === "parsed" ? " Parsed automatically." : " Manual review expected."}`,
        source: "web",
        importance: "normal",
      });
    }

    event.currentTarget.value = "";
    if (parseResult.notes.length) {
      showNotice(parseResult.notes.join(" "));
    } else {
      showNotice(`${file.name} scanned into ${rows.length} draft takeoff row(s) for review.`);
    }
  }

  function updateSupplierQuoteDraft(centreId: string, patch: Partial<SupplierQuoteDraft>) {
    setSupplierQuoteDrafts((current) => {
      const existing = current[centreId] ?? {
        supplier: "",
        contactEmail: "",
        subject: "",
        message: "",
        fileName: "",
        markupPercent: 30,
        lines: [],
      };

      return {
        ...current,
        [centreId]: { ...existing, ...patch },
      };
    });
  }

  function updateSupplierQuoteMarkup(centreId: string, markupPercent: number) {
    setSupplierQuoteDrafts((current) => {
      const existing = current[centreId];
      if (!existing) {
        return {
          ...current,
          [centreId]: {
            supplier: "",
            contactEmail: "",
            subject: "",
            message: "",
            fileName: "",
            markupPercent,
            lines: [],
          },
        };
      }

      return {
        ...current,
        [centreId]: {
          ...existing,
          markupPercent,
          lines: existing.lines.map((line) => ({
            ...line,
            unitSell: lineSellFromMarkup(line.unitCost, markupPercent),
          })),
        },
      };
    });
  }

  function addHeatLossRoomToQuoteCentre(centreId: string) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) => {
        if (centre.id !== centreId) return centre;
        const existingRooms = centre.heatLossRooms ?? [];
        return {
          ...centre,
          heatLossRooms: [...existingRooms, makeHeatLossRoom(existingRooms.length)],
        };
      }),
    }));
  }

  function updateHeatLossRoom(centreId: string, roomId: string, patch: Partial<HeatLossRoom>) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              heatLossRooms: (centre.heatLossRooms ?? []).map((room) =>
                room.id === roomId ? { ...room, ...patch } : room,
              ),
            }
          : centre,
      ),
    }));
  }

  function removeHeatLossRoom(centreId: string, roomId: string) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              heatLossRooms: (centre.heatLossRooms ?? []).filter((room) => room.id !== roomId),
            }
          : centre,
      ),
    }));
  }

  function heatLossLinesForCentre(centre: QuoteCostCentre) {
    return (centre.heatLossRooms ?? [])
      .map((room, index) => heatLossRadiatorLine(room, index))
      .filter((line): line is QuoteCostLine => Boolean(line));
  }

  function applyHeatLossRadiatorsToQuote(centre: QuoteCostCentre) {
    if (!selectedQuote) return;
    const lines = heatLossLinesForCentre(centre);
    if (!lines.length) {
      showNotice("Add at least one room before applying radiators to the quote.");
      return;
    }

    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((item) =>
        item.id === centre.id ? { ...item, lines: [...item.lines, ...lines] } : item,
      ),
    }));

    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova",
      action: "calculated",
      recordType: "quote",
      recordId: selectedQuote.id,
      summary: `${lines.length} radiator material line(s) added from heat loss schedule in ${centre.name}.`,
      source: "web",
      importance: "normal",
    });
    showNotice(`${lines.length} radiator line(s) added to ${centre.name}.`);
  }

  function stageHeatLossSupplierRequest(centre: QuoteCostCentre) {
    const lines = heatLossLinesForCentre(centre);
    if (!lines.length) {
      showNotice("Add at least one room before staging a radiator supplier request.");
      return;
    }

    setSupplierQuoteDrafts((current) => ({
      ...current,
      [centre.id]: {
        supplier: current[centre.id]?.supplier || "Stelrad / radiator merchant",
        contactEmail: current[centre.id]?.contactEmail ?? "",
        subject: current[centre.id]?.subject || `${selectedQuote?.ref ?? "Quote"} radiator request - ${centre.name}`,
        message: current[centre.id]?.message || `Please price the attached radiator schedule for ${centre.name}.`,
        fileName: `Radiator request - ${centre.name}`,
        markupPercent: 30,
        lines,
      },
    }));
    showNotice(`${lines.length} radiator line(s) staged in the supplier request preview.`);
  }

  function selectedSupplierRequestLinesForCentre(centre: QuoteCostCentre) {
    const takeoffSupplierLines = (centre.takeoffRows ?? [])
      .filter((row) => row.supplierRequired)
      .map(makeTakeoffQuoteLine);
    const materialLines = quoteCostCentreTotals(centre).materialLines;
    const flaggedSupplierLines = materialLines.filter((line) => line.supplierRequired);
    return [...takeoffSupplierLines, ...flaggedSupplierLines];
  }

  function supplierRequestLinesForCentre(centre: QuoteCostCentre) {
    const stagedLines = supplierQuoteDrafts[centre.id]?.lines ?? [];
    if (stagedLines.length) return stagedLines;

    return selectedSupplierRequestLinesForCentre(centre);
  }

  function selectedQuoteMaterialLinesForCentre(centre: QuoteCostCentre) {
    const selectedIds = new Set(selectedQuoteMaterialLineIds[centre.id] ?? []);
    return quoteCostCentreTotals(centre).materialLines.filter((line) => selectedIds.has(line.id));
  }

  function toggleQuoteMaterialLineSelection(centreId: string, lineId: string, checked: boolean) {
    setSelectedQuoteMaterialLineIds((current) => {
      const currentIds = new Set(current[centreId] ?? []);
      if (checked) {
        currentIds.add(lineId);
      } else {
        currentIds.delete(lineId);
      }

      return {
        ...current,
        [centreId]: Array.from(currentIds),
      };
    });
  }

  function toggleAllQuoteMaterialLineSelection(centre: QuoteCostCentre) {
    const materialLines = quoteCostCentreTotals(centre).materialLines;
    const selectedIds = new Set(selectedQuoteMaterialLineIds[centre.id] ?? []);
    const allSelected = materialLines.length > 0 && materialLines.every((line) => selectedIds.has(line.id));

    setSelectedQuoteMaterialLineIds((current) => ({
      ...current,
      [centre.id]: allSelected ? [] : materialLines.map((line) => line.id),
    }));
  }

  function stageSelectedSupplierRequestLines(centre: QuoteCostCentre) {
    const lines = selectedQuoteMaterialLinesForCentre(centre).map((line) => ({
      ...line,
      supplierRequired: true,
    }));
    if (!lines.length) {
      showNotice("Select the items you want priced before staging the supplier request.");
      return;
    }

    if (selectedQuote) {
      const selectedIds = new Set(lines.map((line) => line.id));
      setQuoteCostCentres((current) => ({
        ...current,
        [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((item) =>
          item.id === centre.id
            ? {
                ...item,
                lines: item.lines.map((line) => (selectedIds.has(line.id) ? { ...line, supplierRequired: true } : line)),
              }
            : item,
        ),
      }));
    }

    setSupplierQuoteDrafts((current) => ({
      ...current,
      [centre.id]: {
        supplier: current[centre.id]?.supplier ?? "",
        contactEmail: current[centre.id]?.contactEmail ?? "",
        subject: current[centre.id]?.subject || `${selectedQuote?.ref ?? "Quote"} supplier quote request - ${centre.name}`,
        message: current[centre.id]?.message || `Please price the selected items for ${centre.name}. Quantities and notes are included below.`,
        fileName: current[centre.id]?.fileName || `Supplier request - ${centre.name}`,
        markupPercent: current[centre.id]?.markupPercent ?? 30,
        lines,
        sentAt: current[centre.id]?.sentAt,
      },
    }));
    setActiveQuoteBuildTab("supplier-request");
    showNotice(`${lines.length} selected supplier item(s) staged in the request form.`);
  }

  function openSelectedQuoteLinesCatalogFolderModal(centre: QuoteCostCentre) {
    if (!selectedQuote) return;
    const lines = selectedQuoteMaterialLinesForCentre(centre);
    if (!lines.length) {
      showNotice("Select the one-off or material items you want to save to the catalogue.");
      return;
    }

    setCatalogueFolderDrafts((current) => {
      const next = { ...current };
      lines.forEach((line) => {
        next[line.id] = next[line.id] ?? inferCatalogFolder({ name: line.description, type: "Material", category: undefined });
      });
      return next;
    });
    setCatalogueFolderModalCentreId(centre.id);
  }

  function saveSelectedQuoteLinesToCatalog(centre: QuoteCostCentre) {
    if (!selectedQuote) return;
    const lines = selectedQuoteMaterialLinesForCentre(centre);
    if (!lines.length) {
      showNotice("Select the one-off or material items you want to save to the catalogue.");
      return;
    }

    const catalogPool: CatalogItem[] = [...quoteCatalog, ...customQuoteCatalog];
    const lineCatalogUpdates: Record<string, string> = {};
    const nextCustomItems: CatalogItem[] = [];
    let skippedBlank = 0;
    let reusedCount = 0;
    const savedFolders = new Set<string>();

    lines.forEach((line, index) => {
      const name = line.description.trim();
      if (!name) {
        skippedBlank += 1;
        return;
      }
      const category = catalogueFolderDrafts[line.id] ?? inferCatalogFolder({ name, type: "Material" as const, category: undefined });
      savedFolders.add(category);

      const existing =
        [...catalogPool, ...nextCustomItems].find(
          (item) =>
            item.name.trim().toLowerCase() === name.toLowerCase() &&
            item.type !== "Labour" &&
            inferCatalogFolder(item) === category,
        ) ?? null;
      if (existing) {
        lineCatalogUpdates[line.id] = existing.id;
        reusedCount += 1;
        return;
      }

      const nextItem: CatalogItem = {
        id: `custom-material-${Date.now()}-${index}`,
        type: "Material",
        name,
        unit: "item",
        costRate: line.unitCost,
        sellRate: line.unitSell || lineSellFromMarkup(line.unitCost, 30),
        category,
      };
      nextCustomItems.push(nextItem);
      lineCatalogUpdates[line.id] = nextItem.id;
    });

    if (!nextCustomItems.length && !Object.keys(lineCatalogUpdates).length) {
      showNotice("Add descriptions before saving selected items to the catalogue.");
      return;
    }

    if (nextCustomItems.length) {
      setCustomQuoteCatalog((current) => [...nextCustomItems, ...current]);
    }

    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((item) =>
        item.id === centre.id
          ? {
              ...item,
              lines: item.lines.map((line) => {
                const catalogItemId = lineCatalogUpdates[line.id];
                return catalogItemId ? { ...line, catalogItemId } : line;
              }),
            }
          : item,
      ),
    }));

    showNotice(
      `${nextCustomItems.length} item(s) added to the catalogue${reusedCount ? `, ${reusedCount} matched existing items` : ""}${skippedBlank ? `, ${skippedBlank} skipped without descriptions` : ""}.`,
    );
    setCatalogueFolderModalCentreId(null);
    const firstSavedFolder = Array.from(savedFolders)[0];
    if (firstSavedFolder) {
      setActiveCatalogueFolder(firstSavedFolder);
      setActiveQuoteBuildTab("catalogue");
      scrollWorkspaceToTop();
    }
  }

  function supplierLineMatchState(centre: QuoteCostCentre, line: QuoteCostLine) {
    if (line.unitCost === 0 || line.unitSell === 0) return "Awaiting price";
    return centre.lines.some((existingLine) => existingLine.id === line.id) ? "Matched" : "New line";
  }

  function sendSupplierQuoteRequest(centre: QuoteCostCentre) {
    const supplier = supplierQuoteDrafts[centre.id]?.supplier?.trim();
    if (!supplier) {
      showNotice("Choose or enter a supplier before sending the quote request.");
      setActiveQuoteBuildTab("supplier-request");
      return;
    }

    const lines = supplierRequestLinesForCentre(centre);
    if (!lines.length) {
      showNotice("Add catalogue, one-off, takeoff or radiator items before sending a supplier request.");
      return;
    }

    setSupplierQuoteDrafts((current) => ({
      ...current,
      [centre.id]: {
        supplier,
        contactEmail: current[centre.id]?.contactEmail ?? "",
        subject: current[centre.id]?.subject || `${selectedQuote?.ref ?? "Quote"} supplier quote request - ${centre.name}`,
        message: current[centre.id]?.message || `Please price the listed items for ${centre.name}. Quantities and notes are included below.`,
        fileName: current[centre.id]?.fileName || `Supplier request - ${centre.name}`,
        markupPercent: current[centre.id]?.markupPercent ?? 30,
        lines,
        sentAt: new Date().toISOString(),
      },
    }));

    if (selectedQuote) {
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova",
        action: "sent",
        recordType: "quote",
        recordId: selectedQuote.id,
        summary: `Supplier quote request sent to ${supplier} for ${centre.name}: ${lines.length} item(s).`,
        source: "web",
        importance: "normal",
      });
    }

    showNotice(`Supplier quote request staged for ${supplier} with ${lines.length} item(s).`);
  }

  async function handleSupplierQuoteUpload(centre: QuoteCostCentre, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const lowered = file.name.toLowerCase();
    const isCsvLike = lowered.endsWith(".csv") || lowered.endsWith(".txt") || lowered.endsWith(".tsv");
    if (!lowered.endsWith(".pdf") && !isCsvLike) {
      showNotice("Supplier quote upload now supports PDF, CSV and TXT/TSV for automatic parsing.");
      event.currentTarget.value = "";
      return;
    }

    const existing = supplierQuoteDrafts[centre.id];
    const markupPercent = existing?.markupPercent ?? 30;
    const supplier = existing?.supplier || file.name.replace(/\.pdf$/i, "");
    if (isCsvLike) {
      const parsed = await parseSupplierQuoteRowsFromUpload(file, centre, markupPercent).catch(() => ({
        lines: [],
        status: "fallback" as const,
        notes: ["Supplier quote parse failed; using existing draft lines."],
      }));

      if (parsed.lines.length > 0) {
        setSupplierQuoteDrafts((current) => ({
          ...current,
          [centre.id]: {
            ...current[centre.id],
            supplier,
            fileName: file.name,
            markupPercent,
            lines: parsed.lines,
          },
        }));

        if (selectedQuote) {
          logAuditEvent({
            actor: activeEmployee?.name ?? "Verrova",
            action: "uploaded",
            recordType: "quote",
            recordId: selectedQuote.id,
            summary: `${file.name} parsed into ${parsed.lines.length} supplier-priced lines for ${centre.name}.`,
            source: "web",
            importance: "normal",
          });
        }

        showNotice(parsed.lines.length ? parsed.notes.join(" ") : "Supplier quote parsed.");
      } else {
        showNotice(parsed.notes.join(" ") || "No supplier lines parsed; fallback sample retained.");
      }

      event.currentTarget.value = "";
      return;
    }

    const requestedLines = existing?.lines.length ? existing.lines : makeSupplierQuoteLines(file.name, centre, markupPercent);
    const lines = requestedLines.map((line, index) => {
      const radiatorMatch = radiatorCatalogue.find((radiator) =>
        line.description.includes(radiator.range) && line.description.includes(radiator.model),
      );
      const unitCost = line.unitCost || radiatorMatch?.costRate || 90 + (index * 42);

      return {
        ...line,
        unitCost,
        unitSell: lineSellFromMarkup(unitCost, markupPercent),
      };
    });

    setSupplierQuoteDrafts((current) => ({
      ...current,
      [centre.id]: {
        ...current[centre.id],
        supplier,
        fileName: file.name,
        markupPercent,
        lines,
      },
    }));

    if (selectedQuote) {
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova",
        action: "uploaded",
        recordType: "quote",
        recordId: selectedQuote.id,
        summary: `Supplier quote PDF ${file.name} uploaded for ${centre.name}: ${lines.length} item(s) priced for review.`,
        source: "web",
        importance: "normal",
      });
    }
    showNotice(`${file.name} priced ${lines.length} supplier item(s) ready to apply.`);
  }

  function applySupplierQuoteImport(centreId: string) {
    if (!selectedQuote) return;
    const draft = supplierQuoteDrafts[centreId];
    if (!draft || draft.lines.length === 0) {
      showNotice("Upload a supplier quote PDF before applying materials.");
      return;
    }

    const centreName = selectedQuoteCostCentres.find((centre) => centre.id === centreId)?.name ?? "cost centre";
    const importedLines = draft.lines.map((line) => ({
      ...line,
    }));

    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              lines: [
                ...centre.lines.map((line) => {
                  const matchedImport = importedLines.find((importedLine) => importedLine.id === line.id);
                  return matchedImport ? { ...line, unitCost: matchedImport.unitCost, unitSell: matchedImport.unitSell } : line;
                }),
                ...importedLines.filter((importedLine) => !centre.lines.some((line) => line.id === importedLine.id)),
              ],
            }
          : centre,
      ),
    }));

    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova",
      action: "imported",
      recordType: "quote",
      recordId: selectedQuote.id,
      summary: `Supplier quote ${draft.fileName} applied into ${centreName}: ${draft.lines.length} material lines at ${draft.markupPercent}% markup.`,
      source: "web",
      importance: "normal",
    });

    showNotice(`${draft.lines.length} supplier material lines applied to ${centreName}.`);
  }

  function addQuoteLine(centreId: string, catalogItemId: string) {
    if (!selectedQuote) return;
    const item = availableQuoteCatalog.find((catalogItem) => catalogItem.id === catalogItemId) ?? availableQuoteCatalog[0];
    if (!item) return;

    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              lines: [...centre.lines, makeQuoteCostLine(item)],
            }
          : centre,
      ),
    }));
  }

  function openOneOffMaterialModal(centreId: string) {
    setOneOffMaterialCentreId(centreId);
    setOneOffMaterialDraft(blankOneOffMaterialDraft);
  }

  function addOneOffQuoteMaterialLine(centreId: string, draft: OneOffMaterialDraft = blankOneOffMaterialDraft) {
    if (!selectedQuote) return;

    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              lines: [...centre.lines, makeOneOffQuoteMaterialLine(draft)],
            }
          : centre,
      ),
    }));
    showNotice("One-off material line added.");
  }

  function saveOneOffMaterialModal() {
    if (!oneOffMaterialCentreId) return;
    addOneOffQuoteMaterialLine(oneOffMaterialCentreId, oneOffMaterialDraft);
    setOneOffMaterialCentreId(null);
    setOneOffMaterialDraft(blankOneOffMaterialDraft);
    setActiveQuoteBuildTab("one-off");
    scrollWorkspaceToTop();
  }

  function updateQuoteLine(centreId: string, lineId: string, patch: Partial<QuoteCostLine>) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              lines: centre.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
            }
          : centre,
      ),
    }));
  }

  function convertQuoteLineToCatalogItem(centreId: string, line: QuoteCostLine) {
    if (!selectedQuote) return;
    const name = line.description.trim();
    if (!name) {
      showNotice("Add a description before saving this item to the catalogue.");
      return;
    }

    const existing = availableQuoteCatalog.find(
      (item) => item.name.trim().toLowerCase() === name.toLowerCase() && item.type !== "Labour",
    );
    const nextItem: CatalogItem =
      existing ??
      {
        id: `custom-material-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        type: "Material",
        name,
        unit: "item",
        costRate: line.unitCost,
        sellRate: line.unitSell || lineSellFromMarkup(line.unitCost, 30),
        category: inferCatalogFolder({ name, type: "Material" as const, category: undefined }),
      };

    if (!existing) {
      setCustomQuoteCatalog((current) => [nextItem, ...current]);
    }

    updateQuoteLine(centreId, line.id, { catalogItemId: nextItem.id });
    showNotice(existing ? `${existing.name} already exists in the catalogue.` : `${nextItem.name} saved to the reusable catalogue.`);
  }

  function removeQuoteLine(centreId: string, lineId: string) {
    if (!selectedQuote) return;
    setQuoteCostCentres((current) => ({
      ...current,
      [selectedQuote.id]: (current[selectedQuote.id] ?? []).map((centre) =>
        centre.id === centreId
          ? {
              ...centre,
              lines: centre.lines.filter((line) => line.id !== lineId),
            }
          : centre,
      ),
    }));
    setSelectedQuoteMaterialLineIds((current) => ({
      ...current,
      [centreId]: (current[centreId] ?? []).filter((id) => id !== lineId),
    }));
  }

  function toggleEmployeePermission(permission: keyof AccessProfile) {
    if (!editingEmployeeId) return;
    const baseForRole = getAccessProfile(employeeRoleDraft);
    const nextValue = !employeeAccessForEditor[permission];
    const merged = { ...employeePermissionDraft };

    if (nextValue === baseForRole[permission]) {
      delete merged[permission];
    } else {
      merged[permission] = nextValue;
    }

    setEmployeePermissionDraft(merged);
  }

  function addEmployeeLicense() {
    setEmployeeProfileDraft((current) => ({
      ...current,
      licenses: [
        ...current.licenses,
        {
          id: `lic-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          type: "",
          reference: "",
          expiresOn: "",
          status: "Current",
        },
      ],
    }));
  }

  function updateEmployeeLicense(id: string, patch: Partial<EmployeeLicense>) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      licenses: current.licenses.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }

  function addEmployeeLicenseAttachment(id: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    updateEmployeeLicense(id, {
      attachmentFileName: file.name,
      attachmentUploadedAt: new Date().toISOString().slice(0, 10),
    });

    event.currentTarget.value = "";
  }

  function removeEmployeeLicense(id: string) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      licenses: current.licenses.filter((item) => item.id !== id),
    }));
  }

  function removeEmployeeLicenseAttachment(id: string) {
    updateEmployeeLicense(id, {
      attachmentFileName: "",
      attachmentUploadedAt: "",
    });
  }

  function addEmployeeContact() {
    setEmployeeProfileDraft((current) => ({
      ...current,
      emergencyContacts: [
        ...current.emergencyContacts,
        {
          id: `contact-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          name: "",
          relationship: "",
          phone: "",
        },
      ],
    }));
  }

  function updateEmployeeContact(id: string, patch: Partial<EmployeeEmergencyContact>) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      emergencyContacts: current.emergencyContacts.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function removeEmployeeContact(id: string) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      emergencyContacts: current.emergencyContacts.filter((item) => item.id !== id),
    }));
  }

  function addEmployeeDocument(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const uploadedAt = new Date().toISOString().slice(0, 10);

    setEmployeeProfileDraft((current) => ({
      ...current,
      documents: [
        ...current.documents,
        ...files.map((file) => ({
          id: `document-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          label: "Document",
          fileName: file.name,
          uploadedAt,
        })),
      ],
    }));

    event.currentTarget.value = "";
  }

  function addManualEmployeeDocument() {
    setEmployeeProfileDraft((current) => ({
      ...current,
      documents: [
        ...current.documents,
        {
          id: `document-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          label: "Document",
          fileName: "",
          uploadedAt: new Date().toISOString().slice(0, 10),
        },
      ],
    }));
  }

  function updateEmployeeDocument(id: string, patch: Partial<EmployeeDocument>) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      documents: current.documents.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }

  function removeEmployeeDocument(id: string) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      documents: current.documents.filter((item) => item.id !== id),
    }));
  }

  function updateEmployeeAvailability(day: Weekday, patch: { active?: boolean; from?: string; to?: string }) {
    setEmployeeProfileDraft((current) => ({
      ...current,
      availability: {
        ...current.availability,
        [day]: {
          ...current.availability[day],
          ...patch,
        },
      },
    }));
  }

  function cleanNumber(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function saveEmployeeDetails() {
    if (!editingEmployeeId) return;

    const cleanedLicenses = employeeProfileDraft.licenses.filter(
      (license) =>
        license.type.trim() ||
        license.reference.trim() ||
        license.expiresOn.trim() ||
        license.status.trim() ||
        license.attachmentFileName?.trim() ||
        license.attachmentUploadedAt?.trim(),
    );

    const cleanedContacts = employeeProfileDraft.emergencyContacts.filter(
      (contact) => contact.name.trim() || contact.relationship.trim() || contact.phone.trim(),
    );

    const cleanedDocuments = employeeProfileDraft.documents.filter(
      (document) => document.label.trim() || document.fileName.trim(),
    );

    setEmployees((current) =>
      current.map((employee) =>
        employee.id === editingEmployeeId
          ? {
              ...employee,
              name: employeeProfileDraft.name.trim() || employee.name,
              role: employeeRoleDraft,
              permissions: { ...employeePermissionDraft },
              profile: {
                email: employeeProfileDraft.email.trim() || undefined,
                phone: employeeProfileDraft.phone.trim() || undefined,
                address: employeeProfileDraft.address.trim() || undefined,
                startDate: employeeProfileDraft.startDate.trim() || undefined,
                roleLabel: employeeProfileDraft.roleLabel.trim() || undefined,
                payroll: {
                  hourlyRate: cleanNumber(employeeProfileDraft.hourlyRate),
                  overtimeRate: cleanNumber(employeeProfileDraft.overtimeRate),
                  niMultiplier: cleanNumber(employeeProfileDraft.niMultiplier),
                  pensionPercent: cleanNumber(employeeProfileDraft.pensionPercent),
                  dailyToolAllowance: cleanNumber(employeeProfileDraft.dailyToolAllowance),
                },
                employmentCostNote: employeeProfileDraft.employmentCostNote.trim() || undefined,
                licenses: cleanedLicenses,
                documents: cleanedDocuments,
                emergencyContacts: cleanedContacts,
                availability: employeeProfileDraft.availability,
                bankDetails: {
                  sortCode: employeeProfileDraft.bankSortCode.trim() || undefined,
                  accountNumber: employeeProfileDraft.bankAccountNumber.trim() || undefined,
                },
              },
            }
          : employee,
      ),
    );

    logAuditEvent({
      actor: activeEmployee?.name ?? "Verrova user",
      action: "updated",
      recordType: "employee",
      recordId: editingEmployeeId,
      summary: `Employee card updated for ${employeeProfileDraft.name || activeEditingEmployee?.name || "employee"}.`,
      source: "web",
      importance: employeeRoleDraft === "Finance" ? "high" : "normal",
    });
    showNotice("Employee card updated.");
  }

  function openCreateMenu(event: MouseEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCreateMenuPosition({
      top: Math.round(bounds.bottom + 7),
      left: Math.max(16, Math.round(bounds.right - 220)),
    });
    setShowCreateMenu(true);
  }

  function createLead() {
    if (!access.canCreateLead) {
      showNotice("Your role does not have permission to create leads.");
      setShowCreateMenu(false);
      return;
    }
    setShowCreateMenu(false);
    setLeadPostcodeSearch("");
    setShowCreateLead(true);
  }

  function createQuote() {
    if (!access.canCreateQuote) {
      showNotice("Your role does not have permission to create quotes.");
      setShowCreateMenu(false);
      return;
    }
    setShowCreateMenu(false);
    setShowCreateQuote(true);
  }

  function createJobFromMenu() {
    if (!access.canCreateJob) {
      showNotice("Your role does not have permission to create jobs.");
      setShowCreateMenu(false);
      return;
    }
    setShowCreateMenu(false);
    setShowCreateJob(true);
  }

  function createRef() {
    const refs = quotes.map((item) => Number(item.ref.replace(/\D/g, "")));
    return `Q-${Math.max(2000, ...refs) + 1}`;
  }

  function createLeadRef() {
    const refs = leads.map((item) => Number(item.ref.replace(/\D/g, "")));
    return `L-${Math.max(1000, ...refs) + 1}`;
  }

  function postcodeFromAddress(address: string) {
    return address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i)?.[0].toUpperCase() ?? "";
  }

  function setLeadExistingClient(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    const site = clientSites.find((item) => item.clientId === clientId);
    if (!client) return;
    setLeadPostcodeSearch(site ? postcodeFromAddress(site.address) : postcodeFromAddress(client.billingAddress));
    setNewLead((current) => ({
      ...current,
      customerMode: "existing",
      clientId,
      siteId: site?.id ?? "",
      customerName: client.name,
      phone: client.phone,
      email: client.email,
      address: site?.address ?? client.billingAddress,
    }));
  }

  function setLeadExistingSite(siteId: string) {
    const site = clientSites.find((item) => item.id === siteId);
    setNewLead((current) => ({
      ...current,
      siteId,
      address: site?.address ?? current.address,
    }));
  }

  function clearLeadCustomerMatch() {
    setNewLead((current) => ({
      ...current,
      customerMode: "new",
      clientId: undefined,
      siteId: undefined,
    }));
  }

  function setQuoteExistingClient(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    const site = clientSites.find((item) => item.clientId === clientId);
    if (!client) return;
    setNewQuote((current) => ({
      ...current,
      clientId,
      siteId: site?.id ?? "",
      customer: client.name,
      phone: client.phone,
      email: client.email,
      address: site?.address ?? client.billingAddress,
    }));
  }

  function setQuoteExistingSite(siteId: string) {
    const site = clientSites.find((item) => item.id === siteId);
    setNewQuote((current) => ({
      ...current,
      siteId,
      address: site?.address ?? current.address,
    }));
  }

  function clearQuoteCustomerMatch() {
    setNewQuote((current) => ({
      ...current,
      clientId: "",
      siteId: "",
      customer: "",
      phone: "",
      email: "",
      address: "",
    }));
  }

  function setJobExistingClient(clientId: string) {
    const client = clients.find((item) => item.id === clientId);
    const site = clientSites.find((item) => item.clientId === clientId);
    if (!client) return;
    setNewJob((current) => ({
      ...current,
      clientId,
      siteId: site?.id ?? "",
      customer: client.name,
      phone: client.phone,
      email: client.email,
      address: site?.address ?? client.billingAddress,
      site: site?.address ?? current.site,
    }));
  }

  function setJobExistingSite(siteId: string) {
    const site = clientSites.find((item) => item.id === siteId);
    setNewJob((current) => ({
      ...current,
      siteId,
      address: site?.address ?? current.address,
      site: site?.address ?? current.site,
    }));
  }

  function clearJobCustomerMatch() {
    setNewJob((current) => ({
      ...current,
      clientId: "",
      siteId: "",
      customer: "",
      phone: "",
      email: "",
      address: "",
      site: "",
    }));
  }

  async function createCustomerFromDraft(source: string, draft: { customer: string; phone: string; email: string; address: string }) {
    if (!draft.customer.trim()) {
      showNotice("Add the customer name before creating the customer record.");
      return null;
    }
    if (!draft.address.trim()) {
      showNotice("Add the site address before creating the customer record.");
      return null;
    }

    type ClientCreateResponse = {
      client: ClientRecord;
      site?: ClientSite;
      clients: ClientRecord[];
      clientSites: ClientSite[];
      auditEvents?: AuditEvent[];
    };

    const response = await fetch("/api/clients", {
      method: "POST",
      headers: { ...requestHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.customer.trim(),
        primaryContact: draft.customer.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        address: draft.address.trim(),
        source,
        actor: activeEmployee?.name ?? "Verrova user",
      }),
    });

    const result = (await response.json()) as Partial<ClientCreateResponse> & { error?: string };
    if (!response.ok || !result.client) {
      throw new Error(result.error || "Unable to create customer");
    }

    const createdClient = result.client;
    const createdSite = result.site;

    setClients((current) => {
      const map = new Map<string, ClientRecord>(current.map((client) => [client.id, client]));
      (result.clients ?? [createdClient]).forEach((client) => map.set(client.id, client));
      return Array.from(map.values());
    });
    setClientSites((current) => {
      const map = new Map<string, ClientSite>(current.map((site) => [site.id, site]));
      (result.clientSites ?? (createdSite ? [createdSite] : [])).forEach((site) => map.set(site.id, site));
      return Array.from(map.values());
    });
    const createdAuditEvents = result.auditEvents ?? [];
    if (createdAuditEvents.length) {
      setAuditEvents((current) => [
        ...createdAuditEvents,
        ...current.filter((event) => !createdAuditEvents.some((created) => created.id === event.id)),
      ]);
    }

    return { client: createdClient, site: createdSite };
  }

  function selectLeadAddress(address: string, postcode: string) {
    const matchingSite = clientSites.find((site) => site.clientId === newLead.clientId && site.address === address);
    setNewLead((current) => ({
      ...current,
      siteId: matchingSite?.id,
      address,
    }));
    setLeadPostcodeSearch(postcode);
  }

  async function submitLead() {
    if (!newLead.customerName.trim() || !newLead.address.trim() || !newLead.description.trim()) {
      showNotice("Add the customer name, address and work description before saving the lead.");
      return;
    }
    const hasSurveyBooking = Boolean(newLead.surveyDate && newLead.surveyTime);
    if (hasSurveyBooking && newLeadScheduleWarning) {
      showNotice(newLeadScheduleWarning);
      return;
    }

    const payload = {
      source: newLead.source,
      clientId: newLead.clientId || undefined,
      siteId: newLead.siteId || undefined,
      customerName: newLead.customerName.trim(),
      phone: newLead.phone.trim(),
      email: newLead.email.trim(),
      address: newLead.address.trim(),
      description: newLead.description.trim(),
      status: hasSurveyBooking ? "Survey booked" : "Needs scheduling",
      surveyor: newLead.surveyor,
      surveyDate: newLead.surveyDate,
      surveyTime: newLead.surveyTime,
      createdBy: newLead.createdBy || activeEmployee?.name || "Verrova user",
      next: hasSurveyBooking ? `Survey booked and notification sent to ${newLead.surveyor}.` : "Check diary and book survey appointment.",
    };

    type LeadCreateResponse = {
      lead: Lead;
      clients: ClientRecord[];
      clientSites: ClientSite[];
    };
    type LeadScheduleConflict = {
      conflict: true;
      conflictLeadRef: string;
      message: string;
    };

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as LeadScheduleConflict;
        const warning = conflict.message || "Selected slot is already taken.";
        showNotice(warning);
        setSectionError(warning);
        return;
      }

      if (!response.ok) throw new Error("Unable to create lead");

      const result = (await response.json()) as LeadCreateResponse;
      const mergedClients = result.clients.length ? result.clients : clients;
      const mergedSites = result.clientSites.length ? result.clientSites : clientSites;

      setClients((current) => {
        const map = new Map<string, ClientRecord>(current.map((item) => [item.id, item]));
        mergedClients.forEach((client) => {
          map.set(client.id, client);
        });
        return Array.from(map.values());
      });
      setClientSites((current) => {
        const map = new Map<string, ClientSite>(current.map((item) => [item.id, item]));
        mergedSites.forEach((site) => {
          map.set(site.id, site);
        });
        return Array.from(map.values());
      });
      setLeads((current) => [result.lead, ...current.filter((lead) => lead.id !== result.lead.id)]);
      setShowCreateLead(false);
      setLeadPostcodeSearch("");
      setNewLead(blankLead);
      logAuditEvent({
        actor: newLead.createdBy || activeEmployee?.name || "Verrova user",
        action: "created",
        recordType: "lead",
        recordId: result.lead.id,
        summary: `${result.lead.ref} created from ${result.lead.source} for ${result.lead.customerName}.`,
        source: "office intake",
        importance: "normal",
      });
      if (result.lead.status === "Survey booked") {
        logAuditEvent({
          actor: "Verrova",
          action: "notified",
          recordType: "lead",
          recordId: result.lead.id,
          summary: `${result.lead.surveyor} notified for survey at ${result.lead.surveyTime || "time to confirm"} on ${result.lead.surveyDate || "date to confirm"}.`,
          source: "lead scheduler",
          importance: "high",
        });
      }
      showNotice(
        result.lead.status === "Survey booked"
          ? `${result.lead.ref} saved and ${result.lead.surveyor} notified.`
          : `${result.lead.ref} saved. Survey still needs scheduling.`,
      );
      return;
    } catch {
      if (hasSurveyBooking && newLeadScheduleWarning) {
        showNotice(newLeadScheduleWarning);
        return;
      }
      const trimmedCustomerName = newLead.customerName.trim();
      const trimName = trimmedCustomerName.toLowerCase();
      const matchedClient =
        (newLead.clientId ? clients.find((client) => client.id === newLead.clientId) : undefined) ??
        resolveLeadCustomer(newLead, clients) ??
        buildLeadCustomerMatches(newLead, clients, clientSites)[0]?.client ??
        clients.find((client) => normalizeClientIdentity(client.name) === trimName || trimName.includes(normalizeClientIdentity(client.name)));

      const { newClient, newSite } = matchedClient ? { newClient: undefined, newSite: undefined } : buildClientFromLead(newLead, clients);
      const selectedClient = matchedClient ?? newClient;
      if (!selectedClient) {
        showNotice("Add a customer before saving the lead.");
        return;
      }

      const existingSiteForAddress = clientSites.find(
        (site) =>
          site.clientId === selectedClient.id &&
          normalizeClientIdentity(site.address) === normalizeClientIdentity(newLead.address),
      );
      const chosenSiteFromDraft = newLead.siteId ? clientSites.find((site) => site.id === newLead.siteId) : undefined;
      const resolvedSite = chosenSiteFromDraft ?? existingSiteForAddress ?? newSite;
      const createdClient = matchedClient ? null : newClient;
      const createdSite = resolvedSite && resolvedSite !== newSite ? null : newSite;

      if (createdClient) {
        setClients((current) => {
          const existing = current.find((client) => client.id === createdClient.id || normalizeClientIdentity(client.name) === trimName);
          return existing ? current : [createdClient, ...current];
        });
        if (createdSite) {
          setClientSites((current) => {
            const existing = current.find((site) => site.id === createdSite.id);
            return existing ? current : [createdSite, ...current];
          });
        }
      }

      const createdLead: Lead = {
        id: `lead-${Date.now()}`,
        ref: createLeadRef(),
        source: newLead.source,
        clientId: selectedClient.id,
        siteId: resolvedSite?.id,
        customerName: selectedClient.name,
        phone: newLead.phone.trim(),
        email: newLead.email.trim(),
        address: newLead.address.trim(),
        description: newLead.description.trim(),
        status: hasSurveyBooking ? "Survey booked" : "Needs scheduling",
        surveyor: newLead.surveyor,
        surveyDate: newLead.surveyDate,
        surveyTime: newLead.surveyTime,
        createdBy: newLead.createdBy,
        next: hasSurveyBooking
          ? `Survey booked and notification sent to ${newLead.surveyor}.`
          : "Check diary and book survey appointment.",
        createdAt: new Date()
          .toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
          .replace(",", ""),
      };

      setLeads((current) => [createdLead, ...current]);
      setShowCreateLead(false);
      setLeadPostcodeSearch("");
      setNewLead(blankLead);
      logAuditEvent({
        actor: newLead.createdBy || activeEmployee?.name || "Verrova user",
        action: "created",
        recordType: "lead",
        recordId: createdLead.id,
        summary: `${createdLead.ref} created from ${createdLead.source} for ${createdLead.customerName}.`,
        source: "office intake",
        importance: "normal",
      });
      if (createdLead.status === "Survey booked") {
        logAuditEvent({
          actor: "Verrova",
          action: "notified",
          recordType: "lead",
          recordId: createdLead.id,
          summary: `${createdLead.surveyor} notified for survey at ${createdLead.surveyTime || "time to confirm"} on ${
            createdLead.surveyDate || "date to confirm"
          }.`,
          source: "lead scheduler",
          importance: "high",
        });
      }
      showNotice(
        createdLead.status === "Survey booked"
          ? `${createdLead.ref} saved and ${createdLead.surveyor} notified.`
          : `${createdLead.ref} saved. Survey still needs scheduling.`,
      );
      return;
    }
  }

  type LeadSyncResult =
    | {
        ok: true;
        lead: Lead;
      }
    | {
        ok: false;
        status: number;
        error: string;
      };

  async function syncLead(
    leadId: string,
    patch: Partial<Pick<Lead, "status" | "surveyor" | "surveyDate" | "surveyTime" | "next">>,
  ): Promise<LeadSyncResult> {
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | {
              message?: string;
              error?: string;
            }
          | null;
        return {
          ok: false,
          status: response.status,
          error: body?.error || body?.message || "Unable to save lead update right now.",
        };
      }
      return { ok: true, lead: (await response.json()) as Lead };
    } catch {
      return {
        ok: false,
        status: 500,
        error: "Unable to save lead changes. Please retry.",
      };
    }
  }

  async function markLeadSurveyBooked(lead: Lead) {
    if (!lead.surveyDate || !lead.surveyTime) {
      showNotice("Add a survey date and time before booking this lead.");
      return;
    }
    const warning = validateLeadSurveyBooking({
      leadId: lead.id,
      surveyor: lead.surveyor,
      date: lead.surveyDate,
      time: lead.surveyTime,
    });
    if (warning) {
      showNotice(warning);
      return;
    }
    const nextValue = `Survey booked and notification sent to ${lead.surveyor}.`;
    const optimistic: Lead = {
      ...lead,
      status: "Survey booked",
      next: nextValue,
    };
    setLeads((current) => current.map((item) => (item.id === lead.id ? optimistic : item)));
    const updated = await syncLead(lead.id, {
      status: "Survey booked",
      next: nextValue,
      surveyor: lead.surveyor,
      surveyDate: lead.surveyDate,
      surveyTime: lead.surveyTime,
    });
    if (updated.ok) {
      setLeads((current) => current.map((item) => (item.id === updated.lead.id ? updated.lead : item)));
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "booked",
        recordType: "lead",
        recordId: lead.id,
        summary: `${lead.ref} survey booked with ${lead.surveyor}.`,
        source: "lead scheduler",
        importance: "high",
      });
      showNotice(`${lead.ref} marked as survey booked.`);
      return;
    }
    setLeads((current) => current.map((item) => (item.id === lead.id ? lead : item)));
    showNotice(updated.error || "Unable to mark survey booked. Please check scheduling and try again.");
  }

  async function updateLeadSurvey(leadId: string, patch: Partial<Pick<Lead, "surveyor" | "surveyDate" | "surveyTime">>) {
    const previousLead = leads.find((lead) => lead.id === leadId);
    if (!previousLead) return;
    const nextLead = {
      ...previousLead,
      ...patch,
    };
    const scheduleWarning = validateLeadSurveyBooking({
      leadId,
      surveyor: nextLead.surveyor,
      date: nextLead.surveyDate,
      time: nextLead.surveyTime,
    });

    if (scheduleWarning) {
      setLeads((current) => current.map((lead) => (lead.id === leadId ? { ...lead, ...previousLead } : lead)));
      showNotice(scheduleWarning);
      return;
    }

    setLeads((current) =>
      current.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              ...patch,
              status: "Needs scheduling",
              next: "Review availability and save survey booking.",
              }
          : lead,
      ),
    );

    const updated = await syncLead(leadId, {
      ...patch,
      status: "Needs scheduling",
      next: "Review availability and save survey booking.",
    });
    if (updated.ok) {
      setLeads((currentList) => currentList.map((item) => (item.id === updated.lead.id ? updated.lead : item)));
      return;
    }
    setLeads((currentList) =>
      currentList.map((lead) =>
        lead.id === leadId ? { ...lead, ...previousLead } : lead,
      ),
    );
    showNotice(updated.error || "Unable to save lead schedule changes. Data was restored.");
  }

  async function markLeadQuoted(lead: Lead) {
    if (!access.canCreateQuote) {
      showNotice("Your role does not have permission to create quotes.");
      return;
    }

    const existingQuote = getLeadQuote(lead);
    if (existingQuote) {
      showNotice(`${lead.ref} already has ${existingQuote.ref}.`);
      openQuoteDrawer(existingQuote.id);
      return;
    }

    if (lead.status === "Quoted") {
      showNotice(`${lead.ref} is already marked as quoted.`);
      return;
    }

    const actor = activeEmployee?.name ?? "Verrova user";
    const leadDraft: LeadDraft = {
      customerMode: "new",
      clientId: lead.clientId,
      siteId: lead.siteId,
      source: lead.source,
      customerName: lead.customerName,
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      description: lead.description,
      status: lead.status,
      surveyor: lead.surveyor,
      surveyDate: lead.surveyDate,
      surveyTime: lead.surveyTime,
      createdBy: lead.createdBy,
    };

    const matchedClient = lead.clientId
      ? clients.find((client) => client.id === lead.clientId) ?? undefined
      : resolveLeadCustomer(leadDraft, clients);
    const { newClient } = matchedClient ? { newClient: undefined } : buildClientFromLead(leadDraft, clients);
    const resolvedClient = matchedClient ?? newClient;
    const resolvedSite = resolveLeadSiteFromDraft(leadDraft, resolvedClient, clientSites);

    const ref = createRef();
    const quotePayload = {
      ref,
      clientId: resolvedClient?.id,
      siteId: resolvedSite?.id,
      sourceLeadId: lead.id,
      sourceLeadRef: lead.ref,
      customer: resolvedClient?.name ?? lead.customerName,
      description: lead.description.trim() || `${lead.customerName} quote scope`,
      owner: actor,
      status: "Draft" as QuoteStatus,
      value: 0,
      next: `Generated from ${lead.ref}.`,
      due: "Today",
    };

    type QuoteCreateError = {
      error?: string;
      message?: string;
      linkedQuoteId?: string;
      linkedQuoteRef?: string;
    };

    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(quotePayload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as QuoteCreateError | null;
        if (body?.linkedQuoteId) {
          const linked = quotes.find((quote) => quote.id === body.linkedQuoteId)
            ?? (body.linkedQuoteRef ? quotes.find((quote) => quote.ref === body.linkedQuoteRef) : undefined);
          if (linked) {
            openQuoteDrawer(linked.id);
            throw new Error(body.error || body.message || "Lead already has a linked quote.");
          }
        }
        throw new Error(body?.error || body?.message || "Unable to create quote from lead");
      }

      const created = (await response.json()) as Quote;

      if (resolvedClient && newClient) {
        setClients((current) => {
          const exists = current.find(
            (client) =>
              client.id === resolvedClient.id ||
              normalizeClientIdentity(client.name) === normalizeClientIdentity(resolvedClient.name),
          );
          return exists ? current : [resolvedClient, ...current];
        });
      }

      if (resolvedSite && !clientSites.find((site) => site.id === resolvedSite.id)) {
        setClientSites((current) => {
          const exists = current.find((site) => site.id === resolvedSite.id);
          return exists ? current : [resolvedSite, ...current];
        });
      }

      setQuotes((current) => [created, ...current]);
      setQuoteCostCentres((current) => ({
        ...current,
        [created.id]: makeInitialQuoteCostCentresFromLead(created.id, lead),
      }));

      const nextValue = `Quote ${created.ref} created from ${lead.ref}.`;
      const updated = await syncLead(lead.id, {
        status: "Quoted",
        next: nextValue,
      });
      setLeads((current) =>
        current.map((item) =>
          item.id === lead.id
            ? updated.ok && updated.lead
              ? { ...item, status: updated.lead.status, next: updated.lead.next }
              : item
            : item,
        ),
      );

      if (!updated.ok) {
        showNotice(`${lead.ref} converted to ${created.ref}, but updating lead status is queued: ${updated.error}`);
      }

      logAuditEvent({
        actor,
        action: "created",
        recordType: "quote",
        recordId: created.id,
        summary: `Quote ${created.ref} created from ${lead.ref} for ${lead.customerName}.`,
        source: "web",
        importance: "normal",
      });
      logAuditEvent({
        actor,
        action: "quoted",
        recordType: "lead",
        recordId: lead.id,
        summary: `${lead.ref} linked to quote ${created.ref}.`,
        source: "web",
        importance: "normal",
      });
      openQuoteDrawer(created.id);
      showNotice(`Quote ${created.ref} created and opened.`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create quote from lead right now.";
      setSectionError(message);
      showNotice(message);
    }
  }

  async function submitQuote() {
    let client = clients.find((item) => item.id === newQuote.clientId);
    let site = clientSites.find((item) => item.id === newQuote.siteId);
    if (!client) {
      try {
        const createdCustomer = await createCustomerFromDraft("quote intake", newQuote);
        if (!createdCustomer) return;
        client = createdCustomer.client;
        site = createdCustomer.site;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to create customer before quote.";
        setSectionError(message);
        showNotice(message);
        return;
      }
    }
    if (!newQuote.description.trim()) {
      showNotice("Add a quote description before creating the quote.");
      return;
    }

    const payload = {
      ref: createRef(),
      clientId: client.id,
      siteId: site?.id,
      customer: client.name,
      description: newQuote.description.trim(),
      owner: newQuote.owner,
      status: newQuote.status,
      value: Number(newQuote.value) || 0,
      next: newQuote.next.trim() || "Send quote to customer",
      due: newQuote.due,
    };

    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Unable to create quote");

      const created = (await response.json()) as Quote;
      setQuotes((current) => [created, ...current]);
      setShowCreateQuote(false);
      setNewQuote(blankQuote);
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "created",
        recordType: "quote",
        recordId: created.id,
        summary: `Quote ${created.ref} created for ${created.customer}.`,
        source: "web",
        importance: "normal",
      });
      openQuoteDrawer(created.id);
      showNotice(`Quote ${created.ref} created and opened.`);
    } catch {
      setSectionError("Unable to create quote right now.");
    }
  }

  async function createJob() {
    let client = clients.find((item) => item.id === newJob.clientId);
    let site = clientSites.find((item) => item.id === newJob.siteId);
    if (!client) {
      try {
        const createdCustomer = await createCustomerFromDraft("reactive job intake", newJob);
        if (!createdCustomer) return;
        client = createdCustomer.client;
        site = createdCustomer.site;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to create customer before job.";
        setSectionError(message);
        showNotice(message);
        return;
      }
    }
    if (!newJob.description.trim()) {
      showNotice("Add a job description before creating the job.");
      return;
    }
    if (newJob.scheduledDate && newJob.scheduledTime && newJobScheduleWarning) {
      showNotice(newJobScheduleWarning);
      return;
    }

    const payload = {
      clientId: client.id,
      siteId: site?.id,
      customer: client.name,
      site: site?.address ?? "Site to be confirmed",
      description: newJob.description.trim(),
      manager: newJob.manager,
      scheduledDate: newJob.scheduledDate,
      scheduledTime: newJob.scheduledTime,
      status: newJob.status,
      value: Number(newJob.value) || 0,
      next: newJob.next.trim() || "Review job",
      due: newJob.due,
    };

    type JobScheduleConflict = {
      conflict: true;
      conflictJobRef: string;
      message: string;
    };

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as JobScheduleConflict;
        const warning = conflict.message || "Selected slot is already taken.";
        showNotice(warning);
        setSectionError(warning);
        return;
      }

      if (!response.ok) throw new Error("Unable to create job");

      const created = (await response.json()) as Job;
      setJobs((current) => [created, ...current]);
      setShowCreateJob(false);
      setNewJob(blankJob);
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "created",
        recordType: "job",
        recordId: created.id,
        summary: `Job ${created.ref} created for ${created.customer}.`,
        source: "web",
        importance: "high",
      });
      openJobDrawer(created.id);
      showNotice(`Job ${created.ref} created and opened.`);
    } catch {
      setSectionError("Unable to create job right now.");
    }
  }

  async function convertQuoteToJob(quote: Quote) {
    if (!access.canCreateJob || quote.status !== "Accepted" || quote.convertedJobId) return;

    try {
      const response = await fetch(`/api/quotes/${quote.id}/convert`, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: activeEmployee?.name ?? "Verrova user",
          chargeValue: quote.id === selectedQuote?.id && selectedQuoteTotals.sell > 0 ? selectedQuoteTotals.sell : undefined,
        }),
      });

      if (!response.ok) throw new Error("Unable to convert quote");

      const result = (await response.json()) as {
        quote: Quote;
        job: Job;
        auditEvents: AuditEvent[];
      };

      setQuotes((current) =>
        current.map((item) => (item.id === result.quote.id ? result.quote : item)),
      );
      setJobs((current) => [result.job, ...current.filter((job) => job.id !== result.job.id)]);
      setJobEstimateCostCentres((current) => ({
        ...current,
        [result.job.id]: estimateCostCentresFromQuote(result.job, quoteCostCentres[quote.id] ?? []),
      }));
      setAuditEvents((current) => [
        ...result.auditEvents,
        ...current.filter((event) => !result.auditEvents.some((created) => created.id === event.id)),
      ]);
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova",
        action: "converted",
        recordType: "job",
        recordId: result.job.id,
        summary: `${result.job.ref} received ${(quoteCostCentres[quote.id] ?? []).length} quote cost centre(s), engineer notes and priced materials from ${quote.ref}.`,
        source: "web",
        importance: "high",
      });
      openJobDrawer(result.job.id);
      showNotice(`${result.quote.ref} converted into ${result.job.ref}.`);
    } catch {
      setSectionError("Unable to convert quote into a job right now.");
    }
  }

  async function createPurchaseRequest() {
    const job = selectedJob ?? jobs[0];
    if (!job || !purchaseDraft.supplier.trim() || !purchaseDraft.item.trim()) return;

    try {
      const response = await fetch("/api/purchase-requests", {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          jobRef: job.ref,
          requestedBy: activeEmployee?.name ?? "Engineer",
          supplier: purchaseDraft.supplier.trim(),
          item: purchaseDraft.item.trim(),
          estimatedCost: Number(purchaseDraft.estimatedCost) || 0,
          reason: purchaseDraft.reason.trim() || "Requested from site",
        }),
      });

      if (!response.ok) throw new Error("Unable to create purchase request");

      const created = (await response.json()) as PurchaseRequest;
      setPurchaseRequests((current) => [created, ...current]);
      setPurchaseDraft(blankPurchaseRequest);
      setShowPurchaseForm(false);
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: "created",
        recordType: "purchase_request",
        recordId: created.id,
        summary: `PO request created for ${created.jobRef} with ${created.supplier}.`,
        source: "web",
        importance: "normal",
      });
      showNotice("PO request submitted.");
    } catch {
      setSectionError("Unable to submit PO request right now.");
    }
  }

  async function markPurchaseRequestStatus(id: string, status: PurchaseStatus) {
    try {
      const response = await fetch(`/api/purchase-requests/${id}`, {
        method: "PATCH",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) throw new Error("Unable to update PO request");

      const updated = (await response.json()) as PurchaseRequest;
      setPurchaseRequests((current) =>
        current.map((request) => (request.id === updated.id ? updated : request)),
      );
      logAuditEvent({
        actor: activeEmployee?.name ?? "Verrova user",
        action: status === "Approved" ? "approved" : "updated",
        recordType: "purchase_request",
        recordId: updated.id,
        summary: `PO request ${updated.jobRef} marked ${status}.`,
        source: "web",
        importance: status === "Approved" ? "high" : "normal",
      });
    } catch {
      setSectionError("Unable to update PO request right now.");
    }
  }

  function documentFilesForRecord(recordType: RecordDocumentScope, recordRef: string): RecordDocumentFile[] {
    const baseFiles: RecordDocumentFile[] = [
      {
        folderId: "drawings",
        name: `${recordRef} marked-up drawing.pdf`,
        type: "Drawing",
        visibility: "Engineer",
        linkedTo: recordRef,
      },
      {
        folderId: "survey-photos",
        name: `${recordRef} survey photo set`,
        type: "Photos",
        visibility: "Engineer",
        linkedTo: recordRef,
      },
      {
        folderId: "bill-of-quantities",
        name: `${recordRef} reviewed BOQ.xlsx`,
        type: "BOQ",
        visibility: "Private",
        linkedTo: recordRef,
      },
    ];

    if (recordType !== "quote" && recordType !== "job") return baseFiles;

    const quote =
      recordType === "quote"
        ? quotes.find((item) => item.ref === recordRef)
        : quotes.find((item) => item.convertedJobRef === recordRef);
    if (!quote) return baseFiles;

    const centres = quoteCostCentres[quote.id] ?? [];
    const workflowFiles = centres.flatMap((centre): RecordDocumentFile[] => {
      const sourceDocuments = (centre.takeoffDocuments ?? []).map((document): RecordDocumentFile => ({
        folderId:
          document.kind === "Drawings"
            ? "drawings"
            : document.kind === "Contractor BOQ"
              ? "bill-of-quantities"
              : "office-private",
        name: document.fileName,
        type: document.kind,
        visibility: document.kind === "Drawings" ? "Engineer" : "Private",
        linkedTo: centre.name,
      }));

      const supplierDraft = supplierQuoteDrafts[centre.id];
      const supplierFiles: RecordDocumentFile[] = supplierDraft?.fileName
        ? [
            {
              folderId: "supplier-quotes",
              name: supplierDraft.fileName,
              type: supplierDraft.fileName.toLowerCase().endsWith(".pdf") ? "Returned supplier quote" : "Supplier request",
              visibility: "Private",
              linkedTo: centre.name,
            },
          ]
        : [];

      return [...sourceDocuments, ...supplierFiles];
    });

    return [...workflowFiles, ...baseFiles];
  }

  function renderDocumentWorkspace(recordType: RecordDocumentScope, recordRef: string) {
    const folders = recordDocumentFolders(recordType);
    const exampleFiles = documentFilesForRecord(recordType, recordRef)
      .filter((file) => folders.some((folder) => folder.id === file.folderId));

    return (
      <section className="documents-workspace">
        <div className="documents-toolbar">
          <div>
            <span className="permission-heading">Document folders</span>
            <h2>{recordRef} document hub</h2>
          </div>
          <button className="primary-button" type="button" onClick={() => showNotice("File upload storage is next to connect.")}>
            <Plus size={15} />
            Add document
          </button>
        </div>

        <div className="document-folder-grid">
          {folders.map((folder) => {
            const count = exampleFiles.filter((file) => file.folderId === folder.id).length;
            return (
              <article className="document-folder-card" key={folder.id}>
                <FileText size={19} />
                <div>
                  <strong>{folder.name}</strong>
                  <span>{folder.description}</span>
                </div>
                <small>
                  {count} files · {folder.defaultVisibility}
                </small>
              </article>
            );
          })}
        </div>

        <div className="document-file-list">
          <div className="document-file-row table-head">
            <span>File</span>
            <span>Folder</span>
            <span>Type</span>
            <span>Visibility</span>
            <span>Linked to</span>
          </div>
          {exampleFiles.map((file) => {
            const folder = folders.find((item) => item.id === file.folderId);
            return (
              <div className="document-file-row" key={`${file.folderId}-${file.name}`}>
                <strong>{file.name}</strong>
                <span>{folder?.name ?? "Unfiled"}</span>
                <span>{file.type}</span>
                <span className={`document-visibility ${file.visibility.toLowerCase()}`}>{file.visibility}</span>
                <span>{file.linkedTo}</span>
              </div>
            );
          })}
          {exampleFiles.length === 0 ? (
            <div className="employee-empty-panel">
              <strong>No documents yet</strong>
              <span>Files uploaded here inherit folders and visibility from Setup.</span>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderEngineerFlowWorkspace(job: Job) {
    const requiredSteps = engineerFlowTemplate.steps.filter((step) => step.required);
    const completedRequired = requiredSteps.filter((step) => flowStepCompletion[flowCompletionKey(job.id, step.id)]).length;
    const nextBlockedStep = requiredSteps.find((step) => !flowStepCompletion[flowCompletionKey(job.id, step.id)]);

    return (
      <section className="engineer-flow-workspace">
        <div className="documents-toolbar">
          <div>
            <span className="permission-heading">Engineer app stop/go</span>
            <h2>{engineerFlowTemplate.name}</h2>
          </div>
          <span className={nextBlockedStep ? "flow-status blocked" : "flow-status ready"}>
            {nextBlockedStep ? "Blocked" : "Ready"}
          </span>
        </div>

        <div className="flow-progress-panel">
          <strong>
            {completedRequired}/{requiredSteps.length}
          </strong>
          <span>required checks complete</span>
          {nextBlockedStep ? <p>Next required item: {nextBlockedStep.label}</p> : <p>All required stop/go items are complete.</p>}
        </div>

        <div className="engineer-flow-list">
          {engineerFlowTemplate.steps.map((step) => {
            const checked = Boolean(flowStepCompletion[flowCompletionKey(job.id, step.id)]);
            return (
              <label className={checked ? "engineer-flow-step complete" : "engineer-flow-step"} key={step.id}>
                <input type="checkbox" checked={checked} onChange={() => toggleFlowStep(job.id, step.id)} />
                <span>
                  <strong>{step.label}</strong>
                  <small>
                    {step.stage} · {step.evidence}
                    {step.required ? " · Required" : ""}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </section>
    );
  }

  const createMenuItems = [
    { label: "New lead", icon: Mail, onClick: createLead },
    { label: "New quote", icon: FileText, onClick: createQuote },
    { label: "New job", icon: Wrench, onClick: createJobFromMenu },
  ];

  return (
    <div className="platform">
      <header className="global-header">
        <div className="brand-lockup">
          <span className="verrova-mark" aria-hidden="true">V</span>
          <div className="product-name">
            <strong>Verrova</strong>
            <span>Control every moving part.</span>
          </div>
        </div>

        <label className="global-search">
          <Search size={17} />
          <input
            aria-label="Search Verrova"
            placeholder="Search customers, jobs, quotes, assets..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>

        <div className="header-actions">
          <button className="header-icon" aria-label="Messages" onClick={() => showNotice("Messages are coming next.")}>
            <Mail size={18} />
            <span className="counter">3</span>
          </button>
          <button className="header-icon" aria-label="Notifications" onClick={() => showNotice("Notification center is not connected yet.")}>
            <Bell size={18} />
            <span className="alert-dot" />
          </button>
          <button className="create-button" aria-label="Open create menu" onClick={openCreateMenu}>
            <Plus size={17} />
            <span>Create</span>
            <ChevronDown size={14} />
          </button>
          <div className="employee-switch">
            <span>Employee</span>
            <select
              value={activeEmployee?.id ?? seedEmployees[0]?.id ?? ""}
              aria-label="Select employee"
              onChange={(event) => setActiveEmployeeId(event.target.value)}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.role})
                </option>
              ))}
            </select>
            <button
              className="employee-config-button"
              type="button"
              aria-label="Open employee card"
              onClick={() => {
                if (activeEmployee?.id) openEmployeeCardView(activeEmployee.id);
              }}
            >
              <Settings size={14} />
            </button>
          </div>
          <button className="account-button" aria-label="Account menu" onClick={() => showNotice("Account panel is coming soon.")}>
            <span className="account-avatar">V</span>
            <span className="account-copy">
              <strong>{activeEmployee?.name ?? "Employee"}</strong>
              <small>Verrova workspace</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>

      <nav className="module-bar" aria-label="Main modules">
        <button className="mobile-menu" aria-label="Open navigation" onClick={() => showNotice("Mobile navigation is not enabled in this preview.")}>
          <Menu size={19} />
        </button>
        {visibleModules.map((module) => {
          const Icon = module.icon;
          const isActiveModule =
            (module.label === "Dashboard" && homeView === "dashboard") ||
            (module.label === "Leads" && ["leads", "lead-record"].includes(homeView)) ||
            (module.label === "Quotes" && ["quote-record", "quote-cost-centre-record"].includes(homeView)) ||
            (module.label === "Jobs" && ["job-record", "cost-centre-record"].includes(homeView)) ||
            (module.label === "Schedules" && homeView === "schedule") ||
            (module.label === "Setup" && homeView === "settings") ||
            (module.label === "Invoices" && ["invoices", "invoice-record"].includes(homeView)) ||
            (module.label === "Add-ons" && homeView === "addons") ||
            (module.label === "People" && ["employees", "employee-card", "clients", "client-record"].includes(homeView));

          if (module.subItems?.length) {
            const isOpen = openModuleMenu === module.label;
            return (
              <div
                key={module.label}
                className="module-dropdown-host"
                onMouseEnter={() => setOpenModuleMenu(module.label)}
                onMouseLeave={() => setOpenModuleMenu(null)}
              >
                <button
                  type="button"
                  className={`${isOpen || isActiveModule ? "module-link active" : "module-link"} module-dropdown-trigger`}
                  aria-expanded={isOpen}
                  onClick={() => setOpenModuleMenu(isOpen ? null : module.label)}
                >
                  <Icon size={16} strokeWidth={1.8} />
                  <span>{module.label}</span>
                  <ChevronDown size={13} />
                </button>
                <div className={isOpen ? "module-submenu open" : "module-submenu"}>
                  {module.subItems.map((item) => (
                    <button key={item} type="button" onClick={() => goToPeopleSection(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <a
              href="#"
              key={module.label}
              className={isActiveModule ? "module-link active" : "module-link"}
              onClick={(event) => {
                event.preventDefault();
                if (module.label === "Dashboard") {
                  returnToDashboard();
                } else if (module.label === "Leads") {
                  setHomeView("leads");
                } else if (module.label === "Schedules") {
                  setHomeView("schedule");
                } else if (module.label === "Setup") {
                  setHomeView("settings");
                } else if (module.label === "Invoices") {
                  setHomeView("invoices");
                } else if (module.label === "Add-ons") {
                  setHomeView("addons");
                } else {
                  showNotice(`${module.label} module is coming soon in this build.`);
                }
                scrollWorkspaceToTop();
              }}
            >
              <Icon size={16} strokeWidth={1.8} />
              <span>{module.label}</span>
            </a>
          );
        })}
        <button className="module-more" aria-label="More modules" onClick={() => showNotice("Assets, stock, reports and settings can sit under More once the core workflow is built.")}>
          <MoreHorizontal size={18} />
        </button>
      </nav>

      <div className="body-shell">
        <aside className="context-sidebar">
          <div className="context-title">
            <span>
              {homeView === "employee-card"
                ? "Employee card"
                : homeView === "quote-record"
                  ? "Quote setup"
                : homeView === "quote-cost-centre-record"
                  ? "Quote cost centre"
                : homeView === "job-record"
                  ? "Job record"
                : homeView === "cost-centre-record"
                  ? "Cost centre"
                : homeView === "invoices" || homeView === "invoice-record"
                  ? "Invoices"
                : homeView === "leads"
                  ? "Leads"
                : homeView === "lead-record"
                  ? "Lead record"
                : homeView === "schedule"
                  ? "Schedules"
                : homeView === "settings"
                  ? "Setup"
                : homeView === "addons"
                  ? "Add-ons"
                : homeView === "clients" || homeView === "client-record"
                  ? "Clients"
                  : homeView === "employees"
                    ? "People"
                    : "Dashboard"}
            </span>
            <button aria-label="Dashboard settings" onClick={() => showNotice("Dashboard settings is not connected yet.")}>
              <Settings size={15} />
            </button>
          </div>

          <nav aria-label="Dashboard navigation">
            {visibleSideNav.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  href="#"
                  className={item.active ? "context-link active" : "context-link"}
                  key={item.label}
                  onClick={(event) => {
                    event.preventDefault();
                    showNotice(`${item.label} view is coming soon in this build.`);
                  }}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {item.badge ? <b>{item.badge}</b> : null}
                </a>
              );
            })}
          </nav>

          <div className="sidebar-divider" />
          <p className="sidebar-label">Quick access</p>
          <a href="/ai-surveyor" className="context-link">
            <Sparkles size={17} />
            <span>Verrova Takeoff</span>
          </a>
          <a href="/engineer" className="context-link">
            <HardHat size={17} />
            <span>Verrova Field</span>
          </a>
          <a href="/office/whatsapp-pilot" className="context-link">
            <Inbox size={17} />
            <span>Verrova Connect</span>
          </a>
          <a href="/office/alerts" className="context-link">
            <Bell size={17} />
            <span>Office alerts</span>
            <b className={highPriorityOfficeAlerts ? "danger" : ""}>{officeAlerts.length}</b>
          </a>
          <a href="#" className="context-link" onClick={(event) => { event.preventDefault(); showNotice("Blocked jobs quick view is not wired yet."); }}>
            <ShieldAlert size={17} />
            <span>Blocked jobs</span>
            <b className="danger">4</b>
          </a>
          <a href="#" className="context-link" onClick={(event) => { event.preventDefault(); showNotice("Overdue tasks quick view is not wired yet."); }}>
            <Clock3 size={17} />
            <span>Overdue tasks</span>
            <b>6</b>
          </a>
          {access.showQuotes ? (
            <a href="#" className="context-link" onClick={(event) => { event.preventDefault(); showNotice("Draft quotes queue is not wired yet."); }}>
              <FileText size={17} />
              <span>Draft quotes</span>
              <b>5</b>
            </a>
          ) : null}

          <div className="support-panel">
            <span>Verrova workspace</span>
            <strong>All systems operational</strong>
            <small>Last sync 2 minutes ago</small>
          </div>
        </aside>

        <main className="workspace">
          <div className="workspace-header">
            <div>
              <div className="breadcrumb">
                <span>Verrova Operations</span>
                <ChevronRight size={13} />
                <strong>
                  {homeView === "employee-card"
                    ? "Employee card"
                    : homeView === "quote-record"
                      ? "Quote"
                    : homeView === "quote-cost-centre-record"
                      ? "Quote cost centre"
                    : homeView === "job-record"
                      ? "Job"
                    : homeView === "cost-centre-record"
                      ? "Cost centre"
                    : homeView === "invoices"
                      ? "Invoices"
                    : homeView === "invoice-record"
                      ? selectedInvoice?.ref
                        ? `Invoice ${selectedInvoice.ref}`
                        : "Invoice"
                    : homeView === "leads"
                      ? "Leads"
                    : homeView === "lead-record"
                      ? "Lead record"
                    : homeView === "schedule"
                      ? "Schedules"
                    : homeView === "settings"
                      ? "Setup"
                    : homeView === "addons"
                      ? "Add-ons"
                    : homeView === "client-record"
                      ? "Client record"
                      : homeView === "clients"
                        ? "Clients"
                    : homeView === "employees"
                      ? "Employees"
                      : "Dashboard"}
                </strong>
              </div>
              <h1>
                {homeView === "employee-card"
                  ? employeeProfileDraft.name || activeEditingEmployee?.name || "Employee card"
                  : homeView === "quote-record"
                    ? selectedQuote?.ref ?? "Quote setup"
                  : homeView === "quote-cost-centre-record"
                    ? selectedQuoteCostCentre?.name ?? "Quote cost centre"
                  : homeView === "job-record"
                    ? selectedJob?.ref ?? "Job record"
                  : homeView === "cost-centre-record"
                    ? selectedCostCentre?.name ?? "Cost centre"
                  : homeView === "invoice-record"
                    ? selectedInvoice?.ref
                      ? `Invoice ${selectedInvoice.ref}`
                      : "Invoice"
                  : homeView === "leads"
                    ? "Leads"
                  : homeView === "lead-record"
                    ? selectedLead?.ref ?? "Lead record"
                  : homeView === "schedule"
                    ? "Scheduler"
                  : homeView === "settings"
                    ? "Setup"
                  : homeView === "addons"
                    ? "Verrova add-ons"
                  : homeView === "client-record"
                    ? activeClient?.name || "Client record"
                    : homeView === "clients"
                      ? "Clients"
                  : homeView === "employees"
                    ? "Employee cards"
                    : "Operations overview"}
              </h1>
              <p>
                {homeView === "employee-card"
                  ? `${employeeProfileDraft.roleLabel || activeEditingEmployee?.profile?.roleLabel || activeEditingEmployee?.role || "Employee"} · ${employeeProfileDraft.email || activeEditingEmployee?.profile?.email || "No email on file"}`
                  : homeView === "quote-record"
                    ? `${selectedQuote?.customer ?? "Quote"} · build costs before creating the job`
                  : homeView === "quote-cost-centre-record"
                    ? `${selectedQuote?.ref ?? "Quote"} · parts and labour inside this cost centre`
                  : homeView === "job-record"
                    ? `${selectedJob?.customer ?? "Job"} · summary, cost centres and variations`
                  : homeView === "cost-centre-record"
                    ? `${selectedJob?.ref ?? "Job"} · materials, labour and descriptions`
                  : homeView === "invoices"
                    ? `${filteredInvoices.length} invoices · ${invoiceStatusFilter}`
                  : homeView === "invoice-record"
                    ? `${selectedInvoice?.sourceName ?? "Source not linked"} · due ${selectedInvoice?.dueDate ?? "TBC"}`
                  : homeView === "leads"
                  ? `${leads.filter((lead) => !["Quoted", "Lost"].includes(lead.status)).length} open enquiries · ${leads.filter((lead) => lead.status === "Survey booked").length} surveys booked`
                  : homeView === "lead-record"
                    ? `${selectedLead?.customerName ?? "Lead"} · ${selectedLead?.address ?? "Address to confirm"}`
                  : homeView === "schedule"
                    ? `${bookingsForSelectedDate.length} appointments booked · availability for ${surveyorOptions.join(", ")}`
                  : homeView === "settings"
                    ? `${documentFolderTemplates.length} document folders · ${engineerFlowTemplate.steps.length} engineer stop/go checks`
                  : homeView === "addons"
                    ? "Takeoff, Field and Connect feed structured work back into Verrova Core"
                  : homeView === "client-record"
                    ? `${activeClient?.primaryContact || "No contact"} · ${activeClient?.email || "No email on file"}`
                    : homeView === "clients"
                      ? `${clients.length} client accounts and ${clientSites.length} live sites in Verrova`
                  : homeView === "employees"
                    ? `${employees.length} employees onboarded in Verrova`
                    : "Monday, 22 June 2026 · Live business position"}
              </p>
            </div>

            <div className="workspace-actions">
              {homeView === "employee-card" ? (
                <>
                  <button className="secondary-button" onClick={returnToEmployeeDirectory}>
                    Back to employees
                  </button>
                  <button className="primary-button" onClick={saveEmployeeDetails}>
                    Save employee details
                  </button>
                </>
              ) : homeView === "cost-centre-record" ? (
                <button className="secondary-button" onClick={returnToJobRecord}>
                  Back to job
                </button>
              ) : homeView === "quote-cost-centre-record" ? (
                <button className="secondary-button" onClick={returnToQuoteRecord}>
                  Back to quote
                </button>
              ) : homeView === "invoices" ? (
                <>
                  <button className="secondary-button" onClick={returnToDashboard}>
                    Back to dashboard
                  </button>
                  {access.canEditInvoice ? (
                    <button className="primary-button" onClick={() => showNotice("Use quote or job records to create a new invoice quickly.")}>
                      New invoice from source
                    </button>
                  ) : null}
                </>
              ) : homeView === "invoice-record" ? (
                <>
                  <button className="secondary-button" onClick={returnFromInvoiceRecord}>
                    Back to source
                  </button>
                  {access.canEditInvoice ? (
                    <label className="status-filter">
                      <span className="permission-heading">Status</span>
                      <select
                        value={selectedInvoice?.status ?? "Draft"}
                        onChange={(event) =>
                          updateSelectedInvoiceStatus(event.target.value as InvoiceStatus)
                        }
                      >
                        {invoiceStatuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : homeView === "quote-record" || homeView === "job-record" ? (
                <>
                  <button className="secondary-button" onClick={returnFromRecord}>
                    Back to dashboard
                  </button>
                  {homeView === "quote-record" && selectedInvoiceFromQuote ? (
                    <button className="secondary-button" onClick={() => openInvoiceRecord(selectedInvoiceFromQuote.id)}>
                      Open invoice
                    </button>
                  ) : null}
                  {homeView === "job-record" && selectedInvoiceFromJob ? (
                    <button className="secondary-button" onClick={() => openInvoiceRecord(selectedInvoiceFromJob.id)}>
                      Open invoice
                    </button>
                  ) : null}
                  {homeView === "quote-record" && !selectedInvoiceFromQuote && selectedQuote?.status === "Accepted" ? (
                    <button className="primary-button" onClick={() => openInvoiceForQuote(selectedQuote)}>
                      Create invoice
                    </button>
                  ) : null}
                  {homeView === "job-record" && !selectedInvoiceFromJob && selectedJob?.status === "Ready to invoice" ? (
                    <button
                      className="primary-button"
                      onClick={() => {
                        if (selectedJob) {
                          openInvoiceForJob(selectedJob);
                        }
                      }}
                    >
                      Create invoice
                    </button>
                  ) : null}
                  {homeView === "quote-record" && selectedQuote?.status === "Accepted" && access.canCreateJob ? (
                    <button className="primary-button" onClick={() => convertQuoteToJob(selectedQuote)}>
                      Convert to job
                    </button>
                  ) : null}
                  {homeView === "quote-record" && selectedQuoteJob ? (
                    <button className="secondary-button" onClick={() => openJobDrawer(selectedQuoteJob.id)}>
                      Open linked job
                    </button>
                  ) : null}
                </>
              ) : homeView === "leads" ? (
                <>
                  <button className="secondary-button" onClick={returnToDashboard}>
                    Back to dashboard
                  </button>
                  <button className="primary-button" onClick={createLead}>
                    <Plus size={16} />
                    New lead
                  </button>
                </>
              ) : homeView === "lead-record" ? (
                <>
                  <button className="secondary-button" onClick={returnToLeadsDirectory}>
                    Back to leads
                  </button>
                  {selectedLead ? (
                    <button className="primary-button" onClick={() => markLeadQuoted(selectedLead)}>
                      Create quote
                    </button>
                  ) : null}
                </>
              ) : homeView === "schedule" ? (
                <>
                  <button className="secondary-button" onClick={returnToDashboard}>
                    Back to dashboard
                  </button>
                  <button className="primary-button" onClick={createLead}>
                    <Plus size={16} />
                    Book lead survey
                  </button>
                </>
              ) : homeView === "settings" ? (
                <>
                  <button className="secondary-button" onClick={returnToDashboard}>
                    Back to dashboard
                  </button>
                  <button className="primary-button" onClick={addDocumentFolderTemplate}>
                    <Plus size={16} />
                    Add folder
                  </button>
                </>
              ) : homeView === "addons" ? (
                <>
                  <button className="secondary-button" onClick={returnToDashboard}>
                    Back to Core
                  </button>
                  <a className="primary-button" href="/ai-surveyor">
                    <Sparkles size={16} />
                    Open Takeoff
                  </a>
                </>
              ) : homeView === "client-record" ? (
                <>
                  <button className="secondary-button" onClick={returnToClientsDirectory}>
                    Back to clients
                  </button>
                  <button
                    className="primary-button"
                    onClick={() =>
                      activeClient
                        ? (() => {
                            logAuditEvent({
                              actor: activeEmployee?.name ?? "Verrova user",
                              action: "reviewed",
                              recordType: "client",
                              recordId: activeClient.id,
                              summary: `Client record reviewed for ${activeClient.name}.`,
                              source: "web",
                              importance: "normal",
                            });
                            showNotice("Client history note added.");
                          })()
                        : null
                    }
                  >
                    Add history note
                  </button>
                </>
              ) : (
                <button
                  className="secondary-button"
                  onClick={() =>
                    showNotice(
                      access.canCustomize
                        ? "Customise is planned as a per-user dashboard layout."
                        : "Customise is restricted for this role in this build.",
                    )
                  }
                >
                  <SlidersHorizontal size={16} />
                  Customise
                </button>
              )}
            </div>
          </div>

          {sectionError ? <p className="section-error">{sectionError}</p> : null}
          {sectionNotice ? <p className="section-notice">{sectionNotice}</p> : null}

          {showCreateMenu ? (
            <>
              <div className="create-menu-backdrop" onClick={() => setShowCreateMenu(false)} />
              <div className="create-menu" style={{ left: createMenuPosition.left, top: createMenuPosition.top }}>
                {createMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button onClick={item.onClick} key={item.label}>
                      <Icon size={16} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {homeView === "addons" ? (
            <section className="addon-workspace">
              <div className="addon-hero">
                <div>
                  <span className="permission-heading">Product suite</span>
                  <h2>Verrova Core stays the hub</h2>
                  <p>
                    Specialist add-ons can do the heavy work, then push clean leads, quotes, cost centres,
                    job events, documents and audit logs back into Core.
                  </p>
                </div>
                <div className="addon-core-badge">
                  <strong>Core</strong>
                  <span>Clients · Leads · Quotes · Jobs · Invoices</span>
                </div>
              </div>

              <div className="addon-card-grid">
                <a className="addon-product-card" href="/ai-surveyor">
                  <span className="addon-icon"><Sparkles size={20} /></span>
                  <div>
                    <strong>Verrova Takeoff</strong>
                    <p>Drawings, specifications, BOQs, heat loss and supplier lists.</p>
                    <small>Outputs quote cost centres, BOQ lines, supplier requests and documents.</small>
                  </div>
                  <ChevronRight size={17} />
                </a>
                <a className="addon-product-card" href="/engineer">
                  <span className="addon-icon"><HardHat size={20} /></span>
                  <div>
                    <strong>Verrova Field</strong>
                    <p>Engineer packs, stop/go checks, photos, forms, timesheets and variations.</p>
                    <small>Outputs job events, evidence, timesheets, variations and completion checks.</small>
                  </div>
                  <ChevronRight size={17} />
                </a>
                <a className="addon-product-card" href="/office/whatsapp-pilot">
                  <span className="addon-icon"><Inbox size={20} /></span>
                  <div>
                    <strong>Verrova Connect</strong>
                    <p>Outlook, WhatsApp, suppliers, Checkatrade, accounting and API intake.</p>
                    <small>Outputs communications, approvals, supplier costs and audit events.</small>
                  </div>
                  <ChevronRight size={17} />
                </a>
              </div>

              <section className="addon-flow-panel">
                <span className="permission-heading">How the data moves</span>
                <div className="addon-flow">
                  <div>
                    <strong>1. Capture</strong>
                    <span>Takeoff, Field or Connect receives information from the real world.</span>
                  </div>
                  <div>
                    <strong>2. Structure</strong>
                    <span>The add-on turns it into cost centres, events, documents or messages.</span>
                  </div>
                  <div>
                    <strong>3. Feed Core</strong>
                    <span>Verrova Core controls the quote, job, approval, invoice and audit trail.</span>
                  </div>
                </div>
              </section>
            </section>
          ) : homeView === "quote-record" ? (
            selectedQuote ? (
              <section className="quote-record-shell">
                <div className="quote-record-banner">
                  <div>
                    <span className="employee-record-eyebrow">Quote setup</span>
                    <h2>{selectedQuote.ref}</h2>
                    <p>{selectedQuote.description}</p>
                  </div>
                  <div className="quote-record-stats">
                    <div>
                      <strong>{currency(selectedQuoteTotals.sell)}</strong>
                      <span>Charge</span>
                    </div>
                    <div>
                      <strong>{currency(selectedQuoteTotals.cost)}</strong>
                      <span>Cost</span>
                    </div>
                    <div className={selectedQuoteTotals.profit >= 0 ? "profit-positive" : "profit-negative"}>
                      <strong>{currency(selectedQuoteTotals.profit)}</strong>
                      <span>{selectedQuoteTotals.margin}% margin</span>
                    </div>
                  </div>
                </div>

                {renderWorkflowTracker(
                  buildWorkflowTrackerStages({
                    lead: selectedQuote.sourceLeadId
                      ? leads.find((lead) => lead.id === selectedQuote.sourceLeadId) ?? null
                      : null,
                    quote: selectedQuote,
                    job: selectedQuoteJob,
                    invoice: selectedInvoiceFromQuote,
                  }),
                )}

                <div className="simpro-main-tabs" role="tablist" aria-label="Quote setup sections">
                  {quoteDetailTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeQuoteTab === tab.key}
                      className={activeQuoteTab === tab.key ? "simpro-tab active" : "simpro-tab"}
                      onClick={() => {
                        setActiveQuoteTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeQuoteTab === "setup" ? (
                  <section className="quote-record-panel">
                    <div className="client-overview-grid">
                      <article className="client-info-card">
                        <span className="permission-heading">Quote details</span>
                        <dl>
                          <div>
                            <dt>Client</dt>
                            <dd>{selectedQuoteClient?.name ?? selectedQuote.customer}</dd>
                          </div>
                          <div>
                            <dt>Site</dt>
                            <dd>{selectedQuoteSite?.name ?? "Site to confirm"}</dd>
                          </div>
                          <div>
                            <dt>Owner</dt>
                            <dd>{selectedQuote.owner}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedQuote.status}</dd>
                          </div>
                        </dl>
                      </article>
                      <article className="client-info-card">
                        <span className="permission-heading">Commercial position</span>
                        <p>Build the quote from cost centres before it becomes a job. Jobs should inherit this structure rather than inventing costs after conversion.</p>
                        <button className="primary-button" onClick={() => setActiveQuoteTab("cost-build")}>
                          Build quote costs
                        </button>
                      </article>
                    </div>

                    <section className="ai-quote-review-panel">
                      <header>
                        <div>
                          <span><Sparkles size={15} /> Verrova AI review</span>
                          <h2>Questions before this quote goes out</h2>
                        </div>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => showNotice("AI review refreshed against the latest quote costs.")}
                        >
                          Ask again
                        </button>
                      </header>
                      <div className="ai-review-summary">
                        <strong>{selectedQuoteReviewQuestions.filter((question) => !checkedQuoteReviewQuestions[question.id]).length}</strong>
                        <span>open questions from {selectedQuoteCostCentres.length} cost centres</span>
                      </div>
                      {selectedQuoteReviewQuestions.length > 0 ? (
                        <div className="ai-review-question-list">
                          {selectedQuoteReviewQuestions.map((question) => {
                            const checked = checkedQuoteReviewQuestions[question.id];
                            return (
                              <article className={checked ? "ai-review-question checked" : "ai-review-question"} key={question.id}>
                                <div className={`ai-review-severity ${question.severity}`}>{question.severity}</div>
                                <div>
                                  <strong>{question.title}</strong>
                                  <p>{question.detail}</p>
                                </div>
                                <div className="ai-review-actions">
                                  {question.action !== "none" ? (
                                    <button className="secondary-button" type="button" onClick={() => actOnQuoteReviewQuestion(question)}>
                                      {question.action === "open-centre" ? "Open cost centre" : "Review costs"}
                                    </button>
                                  ) : null}
                                  <button className="primary-button" type="button" onClick={() => markQuoteReviewQuestionChecked(question.id)}>
                                    <Check size={14} />
                                    Checked
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="ai-review-empty">
                          <Check size={18} />
                          <span>No obvious quote gaps found from the current cost centres.</span>
                        </div>
                      )}
                    </section>

                    <section className="simpro-summary-panel quote-combined-summary">
                      <h2>Quote commercial summary</h2>
                      <div className="hubflo-total-strip">
                        <div>
                          <span>Cost to us</span>
                          <strong>{currency(selectedQuoteTotals.cost)}</strong>
                        </div>
                        <div>
                          <span>Charge to client</span>
                          <strong>{currency(selectedQuoteTotals.sell)}</strong>
                        </div>
                        <div className={selectedQuoteTotals.profit >= 0 ? "profit-positive" : "profit-negative"}>
                          <span>Potential profit</span>
                          <strong>{currency(selectedQuoteTotals.profit)}</strong>
                        </div>
                        <div>
                          <span>Margin</span>
                          <strong>{selectedQuoteTotals.margin}%</strong>
                        </div>
                      </div>

                      <h3>Cost centre breakdown</h3>
                      <div className="simpro-summary-table quote-centre-summary-table">
                        <div className="table-head">
                          <span>Cost centre</span>
                          <span>Cost</span>
                          <span>Charge</span>
                          <span>Profit</span>
                        </div>
                        {selectedQuoteCostCentres.map((centre) => {
                          const totals = quoteCostCentreTotals(centre);
                          return (
                            <button
                              className="table-row clickable"
                              key={centre.id}
                              type="button"
                              onClick={() => openQuoteCostCentreRecord(centre.id)}
                            >
                              <span>
                                <strong>{centre.name}</strong>
                                <small>{centre.templateName ?? "Uncategorised"}</small>
                              </span>
                              <span>{currency(totals.totalCost)}</span>
                              <span>{currency(totals.totalSell)}</span>
                              <strong className={totals.profit >= 0 ? "profit-positive" : "profit-negative"}>{currency(totals.profit)}</strong>
                            </button>
                          );
                        })}
                      </div>

                      <h3>Combined breakdown</h3>
                      <div className="simpro-breakdown-table quote-combined-breakdown">
                        {(() => {
                          const totals = selectedQuoteCostCentres.reduce(
                            (acc, centre) => {
                              const centreTotals = quoteCostCentreTotals(centre);
                              return {
                                materialCost: acc.materialCost + centreTotals.materialCost,
                                materialSell: acc.materialSell + centreTotals.materialSell,
                                labourCost: acc.labourCost + centreTotals.labourCost,
                                labourSell: acc.labourSell + centreTotals.labourSell,
                              };
                            },
                            { materialCost: 0, materialSell: 0, labourCost: 0, labourSell: 0 },
                          );
                          return (
                            <>
                              <div><span>Materials Cost</span><strong>{currency(totals.materialCost)}</strong></div>
                              <div><span>Resources Cost</span><strong>{currency(totals.labourCost)}</strong></div>
                              <div className="nested"><span>Labour</span><strong>{currency(totals.labourCost)}</strong></div>
                              <div><span>Materials Markup</span><strong>{currency(totals.materialSell - totals.materialCost)}</strong></div>
                              <div><span>Resources Markup</span><strong>{currency(totals.labourSell - totals.labourCost)}</strong></div>
                              <div className="total"><span>Sub Total</span><strong>{currency(selectedQuoteTotals.sell)}</strong></div>
                              <div><span>VAT</span><strong>{currency(selectedQuoteTotals.sell * 0.2)}</strong></div>
                              <div className={selectedQuoteTotals.profit >= 0 ? "profit-positive total" : "profit-negative total"}>
                                <span>Potential Profit</span>
                                <strong>{currency(selectedQuoteTotals.profit)} · {selectedQuoteTotals.margin}%</strong>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </section>
                  </section>
                ) : null}

                {activeQuoteTab === "cost-build" ? (
                  <section className="simpro-estimate-page">
                    <div className="simpro-sub-tabs" role="tablist" aria-label="Quote cost centre categories">
                      <button className="active" type="button">Base scope <span>{selectedQuoteCostCentres.length}</span></button>
                      <button type="button">Options</button>
                    </div>

                    <h2 className="simpro-page-title">Base Scope Cost Centres</h2>

                    <div className="simpro-filter-band">
                      <label>
                        Filter By Name/ID
                        <input aria-label="Filter quote cost centres by name or ID" />
                      </label>
                    </div>

                    <div className="simpro-section-heading">
                      <h3>Sections</h3>
                      <button className="simpro-grey-button" type="button">SECTIONS <ChevronDown size={14} /></button>
                    </div>

                    <div className="simpro-section-create">
                      <label>
                        Name
                        <input />
                      </label>
                      <label>
                        Description <span>(Optional)</span>
                        <input placeholder="Enter a description..." />
                      </label>
                      <button className="simpro-blue-button" type="button">ADD</button>
                    </div>

                    <section className="simpro-section-card">
                      <header>
                        <span className="simpro-drag-handle" aria-hidden="true" />
                        <strong>{selectedQuote.description || "Bathroom refurbishment"}</strong>
                        <button className="simpro-options-button" type="button" onClick={() => showNotice("Section options are next to wire up.")}>
                          Options <ChevronDown size={13} />
                        </button>
                      </header>

                      <div className="simpro-cost-centre-add">
                        <label>
                          Default category
                          <select
                            value={quoteCostCentreTemplateDraft}
                            onChange={(event) => setQuoteCostCentreTemplateDraft(event.target.value)}
                          >
                            {costCentreTemplates.map((template) => (
                              <option key={template} value={template}>{template}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Cost Centre Name <span>(Optional)</span>
                          <input
                            placeholder="Enter Name here..."
                            value={quoteCostCentreNameDraft}
                            onChange={(event) => setQuoteCostCentreNameDraft(event.target.value)}
                          />
                        </label>
                        <button className="simpro-blue-button" type="button" onClick={addQuoteCostCentre}>ADD</button>
                        <button className="simpro-grey-button align-right" type="button">WORK PACKAGES <ChevronDown size={14} /></button>
                      </div>

                      <div className="simpro-cost-centre-list">
                      {selectedQuoteCostCentres.map((centre) => {
                        const centreCost = centre.lines.reduce((total, line) => total + quoteLineCost(line), 0);
                        const centreSell = centre.lines.reduce((total, line) => total + quoteLineSell(line), 0);
                        return (
                          <div
                            className="simpro-cost-centre-row quote"
                            key={centre.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openQuoteCostCentreRecord(centre.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openQuoteCostCentreRecord(centre.id);
                              }
                            }}
                          >
                            <span className="simpro-drag-handle" aria-hidden="true" />
                            <input aria-label={`Select ${centre.name}`} type="checkbox" onClick={(event) => event.stopPropagation()} />
                            <strong className="simpro-row-title">
                              {centre.name}
                              <small>{centre.templateName ?? "Uncategorised"}</small>
                              {(centre.surveyAssets?.length ?? 0) > 0 ? (
                                <small>{centre.surveyAssets?.length} survey records handed over</small>
                              ) : null}
                            </strong>
                            <span className="simpro-row-total">Total: {currency(centreSell)}</span>
                            <span className={centreSell - centreCost >= 0 ? "profit-positive simpro-row-profit" : "profit-negative simpro-row-profit"}>
                              {currency(centreSell - centreCost)}
                            </span>
                            <div className="simpro-row-actions">
                              <button
                                className="simpro-options-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCostCentreActionMenu((current) =>
                                    current?.scope === "quote" && current.id === centre.id ? null : { scope: "quote", id: centre.id },
                                  );
                                }}
                              >
                              Options <ChevronDown size={13} />
                              </button>
                              {costCentreActionMenu?.scope === "quote" && costCentreActionMenu.id === centre.id ? (
                                <div className="cost-centre-options-menu" onClick={(event) => event.stopPropagation()}>
                                  <button type="button" onClick={() => startRenameCostCentre("quote", centre)}>Rename display name</button>
                                  <button type="button" onClick={() => openQuoteCostCentreRecord(centre.id)}>Open cost centre</button>
                                </div>
                              ) : null}
                            </div>
                            <button className="simpro-kebab-button" type="button" onClick={(event) => { event.stopPropagation(); showNotice("More cost centre actions are next."); }}>
                              <MoreHorizontal size={16} />
                            </button>
                            {renamingCostCentre?.scope === "quote" && renamingCostCentre.id === centre.id ? (
                              <div className="cost-centre-rename-row" onClick={(event) => event.stopPropagation()}>
                                <label>
                                  Display name
                                  <input value={renameCostCentreDraft} onChange={(event) => setRenameCostCentreDraft(event.target.value)} />
                                </label>
                                <button className="simpro-blue-button" type="button" onClick={saveRenameCostCentre}>Save</button>
                                <button className="simpro-grey-button" type="button" onClick={cancelRenameCostCentre}>Cancel</button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      </div>
                    </section>
                  </section>
                ) : null}

                {activeQuoteTab === "documents" ? renderDocumentWorkspace("quote", selectedQuote.ref) : null}

                {activeQuoteTab === "preview" ? (
                  <section className="quote-send-workspace">
                    {selectedQuoteEmailDraft ? (
                      <>
                        <section className="document-layout-panel">
                          <div className="document-layout-header">
                            <div>
                              <span className="permission-heading">Forms and layouts</span>
                              <h2>Choose the document layout</h2>
                            </div>
                            <button className="secondary-button" type="button" onClick={() => showNotice("Template editor is next to wire up.")}>
                              Manage templates
                            </button>
                          </div>
                          <div className="document-layout-grid">
                            {documentLayouts.map((layout) => (
                              <button
                                className={selectedQuoteEmailDraft.layout === layout.key ? "document-layout-card active" : "document-layout-card"}
                                key={layout.key}
                                type="button"
                                onClick={() => updateSelectedQuoteEmailDraft({ layout: layout.key })}
                              >
                                <strong>{layout.label}</strong>
                                <span>{layout.detail}</span>
                              </button>
                            ))}
                          </div>
                        </section>

                        <section className="quote-send-grid">
                          <article className="quote-document-preview">
                            {(() => {
                              const surveyPack = quoteSurveyPackSummary(selectedQuoteCostCentres);
                              return (
                                <>
                                  <header>
                                    <div>
                                      <span>{documentLayouts.find((layout) => layout.key === selectedQuoteEmailDraft.layout)?.label ?? "Quote"} preview</span>
                                      <h2>{selectedQuote.ref}</h2>
                                    </div>
                                    <strong>{currency(selectedQuoteTotals.sell)}</strong>
                                  </header>
                                  <div className="quote-document-meta">
                                    <span>{selectedQuoteClient?.name ?? selectedQuote.customer}</span>
                                    <span>{selectedQuoteSite?.name ?? "Site to confirm"}</span>
                                    <span>Prepared by {selectedQuote.owner}</span>
                                  </div>
                                  <h3>{selectedQuote.description}</h3>
                                  <div className="quote-document-sections">
                                    {selectedQuoteCostCentres.map((centre) => {
                                      const totals = quoteCostCentreTotals(centre);
                                      return (
                                        <div className="quote-document-section" key={centre.id}>
                                          <div>
                                            <strong>{centre.name}</strong>
                                            <span>{centre.clientDescription || "Scope description to be confirmed before issue."}</span>
                                          </div>
                                          <strong>{currency(totals.totalSell)}</strong>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="quote-survey-pack-preview">
                                    <div>
                                      <span>Survey pack</span>
                                      <strong>{surveyPack.clientVisible.length} client-visible item(s)</strong>
                                    </div>
                                    <div className="quote-survey-pack-stats">
                                      <span>{surveyPack.scans.length} scan(s)</span>
                                      <span>{surveyPack.photos.length} photo(s)</span>
                                      <span>{surveyPack.concepts.length} concept(s)</span>
                                    </div>
                                    {surveyPack.clientVisible.length ? (
                                      <div className="quote-survey-pack-list">
                                        {surveyPack.clientVisible.map((asset) => (
                                          <span key={asset.id}>{asset.kind}: {asset.title}</span>
                                        ))}
                                      </div>
                                    ) : (
                                      <small>No survey records are currently marked client-visible.</small>
                                    )}
                                  </div>
                                  <footer>
                                    <span>Subtotal {currency(selectedQuoteTotals.sell)}</span>
                                    <span>VAT {currency(selectedQuoteTotals.sell * 0.2)}</span>
                                    <strong>Total {currency(selectedQuoteTotals.sell * 1.2)}</strong>
                                  </footer>
                                </>
                              );
                            })()}
                          </article>

                          <aside className="quote-email-panel">
                            <div className="outlook-status-card">
                              <span>Outlook connection</span>
                              <strong>Ready for Microsoft 365 link</strong>
                              <p>Email will be sent through Outlook and captured back to the quote/job timeline once Graph auth is connected.</p>
                            </div>
                            <label>
                              To
                              <input
                                value={selectedQuoteEmailDraft.to}
                                onChange={(event) => updateSelectedQuoteEmailDraft({ to: event.target.value })}
                              />
                            </label>
                            <label>
                              Cc
                              <input
                                placeholder="Optional"
                                value={selectedQuoteEmailDraft.cc}
                                onChange={(event) => updateSelectedQuoteEmailDraft({ cc: event.target.value })}
                              />
                            </label>
                            <label>
                              Subject
                              <input
                                value={selectedQuoteEmailDraft.subject}
                                onChange={(event) => updateSelectedQuoteEmailDraft({ subject: event.target.value })}
                              />
                            </label>
                            <label>
                              Message
                              <textarea
                                value={selectedQuoteEmailDraft.body}
                                onChange={(event) => updateSelectedQuoteEmailDraft({ body: event.target.value })}
                              />
                            </label>
                            <label className="quote-email-checkbox">
                              <input
                                checked={selectedQuoteEmailDraft.attachPdf}
                                type="checkbox"
                                onChange={(event) => updateSelectedQuoteEmailDraft({ attachPdf: event.target.checked })}
                              />
                              Attach generated PDF
                            </label>
                            <button className="primary-button" type="button" onClick={sendSelectedQuoteEmail}>
                              <Mail size={15} />
                              Send quote
                            </button>
                          </aside>
                        </section>

                        <section className="client-portal-panel">
                          <div>
                            <span className="permission-heading">Client portal tracking</span>
                            <h2>Online quote acceptance</h2>
                            <p>{quotePortalLink(selectedQuote)}</p>
                          </div>
                          <div className="portal-status-grid">
                            <div>
                              <span>Quote status</span>
                              <strong>{selectedQuote.status}</strong>
                            </div>
                            <div>
                              <span>Portal views</span>
                              <strong>{selectedQuoteAudit.filter((event) => event.action === "viewed" && event.source === "client portal").length}</strong>
                            </div>
                            <div>
                              <span>Online response</span>
                              <strong>{selectedQuote.status === "Accepted" || selectedQuote.status === "Declined" ? selectedQuote.status : "Waiting"}</strong>
                            </div>
                          </div>
                          <div className="portal-actions">
                            <button className="secondary-button" type="button" onClick={() => showNotice("Client portal link copied ready for the Outlook email.")}>
                              Copy portal link
                            </button>
                            <button className="secondary-button" type="button" onClick={logQuotePortalViewed}>
                              Simulate customer viewed
                            </button>
                            <button className="primary-button" type="button" onClick={() => respondToQuoteOnline("Accepted")}>
                              Accept online
                            </button>
                            <button className="secondary-button" type="button" onClick={() => respondToQuoteOnline("Declined")}>
                              Decline online
                            </button>
                          </div>
                        </section>

                      </>
                    ) : null}
                  </section>
                ) : null}

                {activeQuoteTab === "logs" ? (
                  <section className="quote-logs-panel">
                    <header>
                      <div>
                        <span className="permission-heading">Quote history</span>
                        <h2>Logs</h2>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => showNotice("Outlook sync will refresh quote emails here once connected.")}>
                        Refresh logs
                      </button>
                    </header>
                    <div className="quote-log-summary-grid">
                      <div>
                        <span>Portal views</span>
                        <strong>{selectedQuoteAudit.filter((event) => event.action === "viewed" && event.source === "client portal").length}</strong>
                      </div>
                      <div>
                        <span>Emails</span>
                        <strong>{selectedQuoteCommunications.filter((record) => record.channel === "Outlook").length}</strong>
                      </div>
                      <div>
                        <span>Response</span>
                        <strong>{selectedQuote.status === "Accepted" || selectedQuote.status === "Declined" ? selectedQuote.status : "Waiting"}</strong>
                      </div>
                    </div>
                    <section className="communication-capture-panel">
                      <div>
                        <span className="permission-heading">Outlook thread</span>
                        <h3>Capture client reply</h3>
                      </div>
                      <div className="communication-capture-grid">
                        <label>
                          From
                          <input
                            value={selectedQuoteCommunicationDraft.from}
                            onChange={(event) => updateCommunicationDraft("quote", selectedQuote.id, { from: event.target.value })}
                            placeholder={selectedQuoteClient?.email ?? selectedQuote.customer}
                          />
                        </label>
                        <label>
                          Subject
                          <input
                            value={selectedQuoteCommunicationDraft.subject}
                            onChange={(event) => updateCommunicationDraft("quote", selectedQuote.id, { subject: event.target.value })}
                            placeholder={`Re: ${selectedQuote.ref}`}
                          />
                        </label>
                        <label className="wide">
                          Message
                          <textarea
                            value={selectedQuoteCommunicationDraft.body}
                            onChange={(event) => updateCommunicationDraft("quote", selectedQuote.id, { body: event.target.value })}
                            placeholder="Paste or summarise the Outlook reply here."
                          />
                        </label>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          captureOutlookReply("quote", selectedQuote.id, selectedQuoteCommunicationDraft, {
                            defaultFrom: selectedQuoteClient?.email ?? selectedQuote.customer,
                            to: "office@errolwatsongroup.co.uk",
                            relatedJobId: selectedQuote.convertedJobId,
                            label: selectedQuote.ref,
                          })
                        }
                      >
                        Capture Outlook reply
                      </button>
                    </section>
                    <div className="communication-thread">
                      {renderCommunicationThread(selectedQuoteCommunications)}
                    </div>
                    <div className="quote-log-list">
                      {selectedQuoteAudit.length > 0 ? (
                        selectedQuoteAudit.map((event) => (
                          <article key={event.id}>
                            <span className={`quote-log-action ${event.importance}`}>{event.action}</span>
                            <div>
                              <strong>{event.summary}</strong>
                              <span>{event.actor} · {event.createdAt} · {event.source}</span>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p>No emails, portal views or quote events captured yet.</p>
                      )}
                    </div>
                  </section>
                ) : null}

              </section>
            ) : null
          ) : homeView === "quote-cost-centre-record" ? (
            selectedQuote && selectedQuoteCostCentre ? (
              <section className="simpro-record-shell">
                <div className="simpro-record-titlebar">
                  <div>
                    <span>Quotes /</span>
                    <strong>{selectedQuote.ref} - {selectedQuoteCostCentre.name}</strong>
                  </div>
                  <div className="simpro-title-actions">
                    <button className="simpro-grey-button" type="button" onClick={returnToQuoteRecord}>CANCEL</button>
                    <button className="simpro-save-button" type="button" onClick={() => showNotice("Cost centre saved locally in this prototype.")}>SAVE AND FINISH</button>
                  </div>
                </div>

                <div className="simpro-main-tabs" role="tablist" aria-label="Quote cost centre sections">
                  {quoteCostCentreTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeCostCentreTab === tab.key}
                      className={activeCostCentreTab === tab.key ? "simpro-tab active" : "simpro-tab"}
                      onClick={() => {
                        setActiveCostCentreTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeCostCentreTab === "summary" ? (
                  <section className="simpro-detail-grid">
                    <div className="simpro-summary-panel">
                      <h2>Summary</h2>
                      <div className="cost-centre-identity-card">
                        <div>
                          <span>Cost Centre Name</span>
                          <strong>{selectedQuoteCostCentre.name}</strong>
                        </div>
                        <div>
                          <span>Default category</span>
                          <strong>{selectedQuoteCostCentre.templateName ?? "Uncategorised"}</strong>
                        </div>
                      </div>
                      {(() => {
                        const totals = quoteCostCentreTotals(selectedQuoteCostCentre);
                        return (
                          <>
                            <div className="hubflo-total-strip">
                              <div>
                                <span>Cost to us</span>
                                <strong>{currency(totals.totalCost)}</strong>
                              </div>
                              <div>
                                <span>Charge to client</span>
                                <strong>{currency(totals.totalSell)}</strong>
                              </div>
                              <div className={totals.profit >= 0 ? "profit-positive" : "profit-negative"}>
                                <span>Potential profit</span>
                                <strong>{currency(totals.profit)}</strong>
                              </div>
                              <div>
                                <span>Margin</span>
                                <strong>{totals.margin}%</strong>
                              </div>
                            </div>

                            <h3>Parts & Labour</h3>
                            <div className="simpro-summary-table">
                              <div className="table-head">
                                <span>Description</span>
                                <span>Quantity</span>
                                <span>Item Sell</span>
                                <span>Total</span>
                              </div>
                              {selectedQuoteCostCentre.lines.map((line) => (
                                <div className="table-row" key={line.id}>
                                  <a>{line.description}</a>
                                  <span>{quoteLineCatalogType(line) === "Labour" ? `${line.quantity.toFixed(2)} hrs` : line.quantity.toFixed(2)}</span>
                                  <span>{currency(line.unitSell)}</span>
                                  <strong>{currency(quoteLineSell(line))}</strong>
                                </div>
                              ))}
                            </div>

                            <h3>Breakdown</h3>
                            <div className="simpro-breakdown-table">
                              <div><span>Materials Cost</span><strong>{currency(totals.materialCost)}</strong></div>
                              <div><span>Resources Cost</span><strong>{currency(totals.labourCost)}</strong></div>
                              <div className="nested"><span>Labour</span><strong>{currency(totals.labourCost)}</strong></div>
                              <div><span>Materials Markup</span><strong>{currency(totals.materialSell - totals.materialCost)}</strong></div>
                              <div><span>Resources Markup</span><strong>{currency(totals.labourSell - totals.labourCost)}</strong></div>
                              <div><span>Discount/Fee</span><strong>{currency(0)}</strong></div>
                              <div className="total"><span>Sub Total</span><strong>{currency(totals.totalSell)}</strong></div>
                              <div><span>VAT</span><strong>{currency(totals.totalSell * 0.2)}</strong></div>
                              <div className={totals.profit >= 0 ? "profit-positive total" : "profit-negative total"}>
                                <span>Potential Profit</span>
                                <strong>{currency(totals.profit)} · {totals.margin}%</strong>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <aside className="simpro-activity-panel">
                      <h2>Activity</h2>
                      <h3>Schedule</h3>
                      <p><AlertTriangle size={16} /> No one is scheduled or assigned to this quote cost centre.</p>
                      <h3>Timeline</h3>
                      <div className="simpro-timeline-card">
                        <strong>{activeEmployee?.name ?? "Verrova"} - Note</strong>
                        <span>{selectedQuoteCostCentre.name} estimate opened.</span>
                      </div>
                    </aside>
                  </section>
                ) : null}

                {activeCostCentreTab === "info" ? (
                  <section className="simpro-info-page">
                    <div className="simpro-editor-card">
                      <div className="simpro-editor-header">
                        <strong>Description</strong>
                        <select defaultValue="">
                          <option value="">Insert script</option>
                        </select>
                      </div>
                      <div className="simpro-editor-toolbar">
                        <b>B</b><i>I</i><u>U</u><span>10pt</span><span>A</span><span>☰</span><span>•</span><span>▦</span><MoreHorizontal size={16} />
                      </div>
                      <textarea
                        value={selectedQuoteCostCentre.clientDescription ?? ""}
                        onChange={(event) => updateQuoteCostCentre(selectedQuoteCostCentre.id, { clientDescription: event.target.value })}
                      />
                    </div>
                    <div className="simpro-editor-card notes">
                      <div className="simpro-editor-header">
                        <strong>Notes <span>These notes are private and are not visible to the customer.</span></strong>
                      </div>
                      <div className="simpro-editor-toolbar">
                        <b>B</b><i>I</i><u>U</u><span>10pt</span><span>A</span><span>☰</span><span>•</span><span>▦</span><MoreHorizontal size={16} />
                      </div>
                      <textarea
                        value={selectedQuoteCostCentre.engineerDescription ?? ""}
                        onChange={(event) => updateQuoteCostCentre(selectedQuoteCostCentre.id, { engineerDescription: event.target.value })}
                      />
                    </div>
                  </section>
                ) : null}

                {activeCostCentreTab === "parts-labour" ? (
                  <section className="simpro-parts-page">
                    <div className="simpro-sub-tabs" role="tablist" aria-label="Parts and labour sections">
                      {quoteBuildTabs.map((tab) => (
                        <button
                          className={activeQuoteBuildTab === tab.key ? "active" : ""}
                          key={tab.key}
                          type="button"
                          onClick={() => {
                            setActiveQuoteBuildTab(tab.key);
                            scrollWorkspaceToTop();
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    {activeQuoteBuildTab === "summary" ? (
                      <div className="quote-scope-summary">
                        {(() => {
                          const totals = quoteCostCentreTotals(selectedQuoteCostCentre);
                          const supplierLines = supplierRequestLinesForCentre(selectedQuoteCostCentre);
                          return (
                            <>
                              <div className="simpro-parts-header">
                                <div>
                                  <h2>Scope summary</h2>
                                  <h3>Pull-through from catalogue, one-off items, heat loss, labour and Takeoff handoff</h3>
                                  <span>Takeoff and survey capture now live in Verrova Takeoff. This cost centre consumes the reviewed output.</span>
                                </div>
                              </div>
                              <div className="quote-build-summary-grid">
                                <div>
                                  <span>Materials</span>
                                  <strong>{currency(totals.materialSell)}</strong>
                                  <small>{totals.materialLines.length} item(s)</small>
                                </div>
                                <div>
                                  <span>Labour</span>
                                  <strong>{currency(totals.labourSell)}</strong>
                                  <small>{totals.labourLines.reduce((sum, line) => sum + line.quantity, 0).toFixed(2)} hrs</small>
                                </div>
                                <div>
                                  <span>Items for supplier</span>
                                  <strong>{supplierLines.length}</strong>
                                  <small>{supplierQuoteDrafts[selectedQuoteCostCentre.id]?.fileName || "Request not sent yet"}</small>
                                </div>
                                <div>
                                  <span>Takeoff handoff</span>
                                  <strong>{(selectedQuoteCostCentre.takeoffDocuments ?? []).length}</strong>
                                  <small>{(selectedQuoteCostCentre.takeoffRows ?? []).length} draft row(s)</small>
                                </div>
                                <div className={totals.profit >= 0 ? "profit-positive" : "profit-negative"}>
                                  <span>Potential profit</span>
                                  <strong>{currency(totals.profit)}</strong>
                                  <small>{totals.margin}% margin</small>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    ) : null}

                    {activeQuoteBuildTab === "survey-tools" ? (
                      <div className="survey-tools-panel">
                        <div className="simpro-parts-header">
                          <div>
                            <h2>Survey tools</h2>
                            <h3>iPad room scans, survey photos, concept looks and takeoff outputs</h3>
                            <span>Capture the room once, then let Verrova feed the quote, heat loss, supplier request and client-facing visuals.</span>
                          </div>
                          <div className="simpro-parts-actions">
                            <button className="simpro-grey-button" type="button" onClick={() => addSurveyAssetToQuoteCentre(selectedQuoteCostCentre, "Room scan")}>
                              ROOM SCAN
                            </button>
                            <button className="simpro-grey-button" type="button" onClick={() => addSurveyAssetToQuoteCentre(selectedQuoteCostCentre, "Survey photo")}>
                              ADD PHOTO
                            </button>
                            <button className="simpro-blue-button" type="button" onClick={() => addSurveyAssetToQuoteCentre(selectedQuoteCostCentre, "Concept look")}>
                              CREATE CONCEPTS
                            </button>
                          </div>
                        </div>

                        <div className="survey-tool-grid">
                          <article className="survey-tool-card">
                            <span className="survey-tool-icon"><MapPin size={18} /></span>
                            <div>
                              <strong>Room scan</strong>
                              <p>Use iPad LiDAR/RoomPlan later to capture dimensions, openings, walls and ceiling heights against this cost centre.</p>
                            </div>
                            <small>{(selectedQuoteCostCentre.surveyAssets ?? []).filter((asset) => asset.kind === "Room scan").length} scan record(s)</small>
                          </article>
                          <article className="survey-tool-card">
                            <span className="survey-tool-icon"><FileText size={18} /></span>
                            <div>
                              <strong>Survey evidence</strong>
                              <p>Photos, drawings and notes can be marked client visible or internal only before the quote is issued.</p>
                            </div>
                            <small>{(selectedQuoteCostCentre.surveyAssets ?? []).filter((asset) => asset.kind === "Survey photo").length} photo/evidence record(s)</small>
                          </article>
                          <article className="survey-tool-card">
                            <span className="survey-tool-icon"><Sparkles size={18} /></span>
                            <div>
                              <strong>Concept looks</strong>
                              <p>Create option images for bathrooms, radiators, finishes or layouts so the customer can see the intended result.</p>
                            </div>
                            <small>{(selectedQuoteCostCentre.surveyAssets ?? []).filter((asset) => asset.kind === "Concept look").length} concept option(s)</small>
                          </article>
                          <article className="survey-tool-card">
                            <span className="survey-tool-icon"><ListChecks size={18} /></span>
                            <div>
                              <strong>Takeoff output</strong>
                              <p>Reviewed dimensions and BOQ rows pull through to the takeoff tab, scope summary and supplier request.</p>
                            </div>
                            <small>{(selectedQuoteCostCentre.takeoffRows ?? []).length} draft takeoff row(s)</small>
                          </article>
                        </div>

                        <div className="survey-flow-strip">
                          <div>
                            <span>Capture</span>
                            <strong>Scan room + add photos</strong>
                          </div>
                          <ChevronRight size={16} />
                          <div>
                            <span>Review</span>
                            <strong>Confirm dimensions and questions</strong>
                          </div>
                          <ChevronRight size={16} />
                          <div>
                            <span>Build</span>
                            <strong>Generate takeoff / heat loss rows</strong>
                          </div>
                          <ChevronRight size={16} />
                          <div>
                            <span>Quote</span>
                            <strong>Send selected visuals and priced scope</strong>
                          </div>
                        </div>

                        <div className="survey-asset-list">
                          <div className="survey-asset-head">
                            <strong>Survey records</strong>
                            <span>{(selectedQuoteCostCentre.surveyAssets ?? []).filter((asset) => asset.clientVisible).length} client-visible item(s)</span>
                          </div>
                          {(selectedQuoteCostCentre.surveyAssets ?? []).length ? (
                            (selectedQuoteCostCentre.surveyAssets ?? []).map((asset) => (
                              <article className="survey-asset-row" key={asset.id}>
                                <div>
                                  <span>{asset.kind}</span>
                                  <strong>{asset.title}</strong>
                                  <small>{asset.detail}</small>
                                </div>
                                <b>{asset.status}</b>
                                <label>
                                  <input
                                    checked={asset.clientVisible}
                                    type="checkbox"
                                    onChange={() => toggleSurveyAssetClientVisible(selectedQuoteCostCentre.id, asset.id)}
                                  />
                                  Client visible
                                </label>
                              </article>
                            ))
                          ) : (
                            <div className="survey-empty-state">
                              <strong>No survey records yet</strong>
                              <span>Add a room scan, survey photo or concept look to start building the survey pack for this cost centre.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {activeQuoteBuildTab === "takeoff" ? (
                      <div className="takeoff-review-panel">
                        <div className="simpro-parts-header">
                          <div>
                            <h2>Takeoff / BOQ import</h2>
                            <h3>Review imported rows before they pull into the scope summary</h3>
                            <span>Rows marked supplier-needed will also appear in the supplier request tab.</span>
                          </div>
                          <div className="simpro-parts-actions">
                            <button className="simpro-grey-button" type="button" onClick={() => importSampleTakeoffRows(selectedQuoteCostCentre)}>
                              IMPORT SAMPLE BOQ
                            </button>
                            <button className="simpro-blue-button" type="button" onClick={() => applyTakeoffRowsToQuote(selectedQuoteCostCentre)}>
                              APPLY TO SUMMARY
                            </button>
                          </div>
                        </div>
                        <div className="takeoff-upload-grid">
                          {(["Drawings", "Specification", "Contractor BOQ"] as TakeoffDocumentKind[]).map((kind) => (
                            <label className="takeoff-upload-card" key={kind}>
                              <span>{kind}</span>
                              <strong>
                                {kind === "Drawings"
                                  ? "Upload plans to scan pipe runs, rads and fittings"
                                  : kind === "Specification"
                                    ? "Upload specs to pull named products and exclusions"
                                    : "Upload BOQ to create draft rows and cost centres"}
                              </strong>
                              <small>
                                {kind === "Contractor BOQ"
                                  ? "CSV/TXT exports are parsed automatically into rows."
                                  : "Review generated rows and edit quantities / costs manually."}
                              </small>
                              <input
                                accept={kind === "Drawings" ? "application/pdf,image/*,.dwg,.dxf" : ".csv,.txt,.tsv,.pdf"}
                                type="file"
                                onChange={(event) => handleTakeoffDocumentUpload(selectedQuoteCostCentre, kind, event)}
                              />
                            </label>
                          ))}
                        </div>
                        {(selectedQuoteCostCentre.takeoffDocuments ?? []).length ? (
                          <div className="takeoff-document-list">
                            {(selectedQuoteCostCentre.takeoffDocuments ?? []).map((document) => (
                              <article className="takeoff-document-card" key={document.id}>
                                <div>
                                  <span>{document.kind}</span>
                                  <strong>{document.fileName}</strong>
                                  <small>{document.status} · {document.confidence} confidence · {document.extractedAt}</small>
                                </div>
                                <ul>
                                  {document.questions.map((question) => (
                                    <li key={question}>{question}</li>
                                  ))}
                                </ul>
                              </article>
                            ))}
                          </div>
                        ) : null}
                        <div className="takeoff-summary-strip">
                          <div>
                            <span>Rows imported</span>
                            <strong>{(selectedQuoteCostCentre.takeoffRows ?? []).length}</strong>
                          </div>
                          <div>
                            <span>Supplier-needed</span>
                            <strong>{(selectedQuoteCostCentre.takeoffRows ?? []).filter((row) => row.supplierRequired).length}</strong>
                          </div>
                          <div>
                            <span>Known cost</span>
                            <strong>{currency((selectedQuoteCostCentre.takeoffRows ?? []).reduce((total, row) => total + (row.supplierRequired ? 0 : row.unitCost * row.quantity), 0))}</strong>
                          </div>
                        </div>
                        <div className="takeoff-row-table">
                          <div className="takeoff-row table-head">
                            <span>Source</span>
                            <span>Section</span>
                            <span>Description</span>
                            <span>Qty</span>
                            <span>Unit</span>
                            <span>Cost</span>
                            <span>Markup</span>
                            <span>Supplier</span>
                          </div>
                          {(selectedQuoteCostCentre.takeoffRows ?? []).map((row) => (
                            <div className="takeoff-row" key={row.id}>
                              <select value={row.source} onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { source: event.target.value as TakeoffBoqRow["source"] })}>
                                <option>Takeoff</option>
                                <option>BOQ</option>
                              </select>
                              <input value={row.section} onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { section: event.target.value })} />
                              <input value={row.description} onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { description: event.target.value })} />
                              <input inputMode="decimal" value={row.quantity} onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { quantity: Number(event.target.value) || 0 })} />
                              <input value={row.unit} onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { unit: event.target.value })} />
                              <input inputMode="decimal" value={row.unitCost || ""} placeholder="TBC" onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { unitCost: Number(event.target.value) || 0 })} />
                              <input inputMode="decimal" value={row.markupPercent} onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { markupPercent: Number(event.target.value) || 0 })} />
                              <label className="takeoff-supplier-toggle">
                                <input checked={row.supplierRequired} type="checkbox" onChange={(event) => updateTakeoffRow(selectedQuoteCostCentre.id, row.id, { supplierRequired: event.target.checked })} />
                                <span>{row.supplierRequired ? "Yes" : "No"}</span>
                              </label>
                            </div>
                          ))}
                          {(selectedQuoteCostCentre.takeoffRows ?? []).length === 0 ? (
                            <div className="takeoff-empty-row">
                              <strong>No takeoff or BOQ rows imported yet</strong>
                              <span>Import the sample BOQ to see the review flow. Later this will receive rows from the estimating tool or uploaded BOQ files.</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {activeQuoteBuildTab === "catalogue" ? (
                      (() => {
                        const visibleCatalogItems = availableQuoteCatalog
                          .filter((item) => item.type !== "Labour" && inferCatalogFolder(item) === activeCatalogueFolder)
                          .filter((item) => item.name.toLowerCase().includes(catalogueSearch.trim().toLowerCase()))
                          .sort((first, second) => first.name.localeCompare(second.name));

                        return (
                          <div className="quote-catalogue-workspace">
                            <div className="quote-catalogue-toolbar">
                              <div>
                                <h2>Catalogue</h2>
                                <span>Open a group, add existing items, or create new catalogue items for reuse.</span>
                              </div>
                              <label className="quote-catalogue-search">
                                <Search size={15} />
                                <input
                                  aria-label="Search catalogue"
                                  placeholder="Search catalogue..."
                                  value={catalogueSearch}
                                  onChange={(event) => setCatalogueSearch(event.target.value)}
                                />
                              </label>
                              <button className="simpro-grey-button" type="button" onClick={() => showNotice("Catalogue group setup will live in Settings so every quote uses the same folders.")}>
                                CREATE GROUP
                              </button>
                              <button
                                className="simpro-blue-button"
                                type="button"
                                onClick={() => {
                                  openOneOffMaterialModal(selectedQuoteCostCentre.id);
                                  setActiveQuoteBuildTab("one-off");
                                  scrollWorkspaceToTop();
                                }}
                              >
                                CREATE ITEM
                              </button>
                            </div>

                            <div className="quote-catalogue-layout">
                              <div className="quote-catalogue-groups">
                                <div className="quote-catalogue-head">
                                  <strong>Groups</strong>
                                  <span>Group name</span>
                                </div>
                                {quoteCatalogFolders.map((folder) => {
                                  const folderCount = availableQuoteCatalog.filter((item) => item.type !== "Labour" && inferCatalogFolder(item) === folder).length;
                                  return (
                                    <button
                                      className={activeCatalogueFolder === folder ? "active" : ""}
                                      key={folder}
                                      type="button"
                                      onClick={() => {
                                        setActiveCatalogueFolder(folder);
                                        scrollWorkspaceToTop();
                                      }}
                                    >
                                      <span>{folder}</span>
                                      <small>{folderCount} item(s)</small>
                                      <MoreHorizontal size={15} />
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="quote-catalogue-items">
                                <div className="quote-catalogue-head">
                                  <strong>{activeCatalogueFolder} items</strong>
                                  <span>{visibleCatalogItems.length} matching item(s)</span>
                                </div>
                                {visibleCatalogItems.map((item) => (
                                  <div className="quote-catalogue-item-row" key={item.id}>
                                    <div>
                                      <strong>{item.name}</strong>
                                      <span>{item.type} · {item.unit} · Cost {currency(item.costRate)} · Sell {currency(item.sellRate)}</span>
                                    </div>
                                    <button className="simpro-options-button" type="button" onClick={() => addQuoteLine(selectedQuoteCostCentre.id, item.id)}>
                                      ADD
                                    </button>
                                  </div>
                                ))}
                                {!visibleCatalogItems.length ? (
                                  <div className="quote-catalogue-empty">
                                    <strong>No items in this group yet</strong>
                                    <span>Create an item or save selected one-off rows into this catalogue folder.</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : null}

                    {activeQuoteBuildTab === "one-off" ? (
                      <div className="simpro-parts-header">
                        <div>
                          <h2>One-off items</h2>
                          <h3>Add materials not in the catalogue or supplier quote</h3>
                          <span>Use this for skips, fittings, sundries or anything picked up manually.</span>
                        </div>
                        <div className="simpro-parts-actions">
                          <button className="simpro-blue-button" type="button" onClick={() => openOneOffMaterialModal(selectedQuoteCostCentre.id)}>
                            ONE-OFF MATERIAL
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {activeQuoteBuildTab === "heat-loss" ? (
                    <div className="heat-loss-panel">
                      <div className="heat-loss-panel-head">
                        <div>
                          <strong>Heat loss / radiator schedule</strong>
                          <span>Build the room schedule, confirm the suggested radiator, then add the radiator list to materials or supplier request.</span>
                        </div>
                        <div className="heat-loss-actions">
                          <button className="simpro-grey-button" type="button" onClick={() => addHeatLossRoomToQuoteCentre(selectedQuoteCostCentre.id)}>
                            Add room
                          </button>
                          <button className="simpro-grey-button" type="button" onClick={() => stageHeatLossSupplierRequest(selectedQuoteCostCentre)}>
                            Stage supplier list
                          </button>
                          <button className="simpro-blue-button" type="button" onClick={() => applyHeatLossRadiatorsToQuote(selectedQuoteCostCentre)}>
                            Add radiator list
                          </button>
                        </div>
                      </div>

                      {(selectedQuoteCostCentre.heatLossRooms ?? []).length === 0 ? (
                        <div className="heat-loss-empty">
                          <strong>No rooms added yet</strong>
                          <span>Add the first room to calculate required watts/BTU and select a radiator.</span>
                        </div>
                      ) : null}

                      <div className="heat-loss-room-list">
                        {(selectedQuoteCostCentre.heatLossRooms ?? []).map((room) => {
                          const heatLoss = calculateHeatLossRoom(room);
                          const recommendedOptions = recommendedRadiatorOptionsForRoom(room);
                          const recommendedRadiator = recommendRadiatorForRoom(room);
                          const selectedRadiator = recommendedRadiator;
                          const preferredCatalogue = room.preferredRange === "Any range"
                            ? radiatorCatalogue
                            : radiatorCatalogue.filter((radiator) => radiator.range === room.preferredRange);

                          return (
                            <article className="heat-loss-room" key={room.id}>
                              <div className="heat-loss-room-head">
                                <input
                                  aria-label="Room name"
                                  value={room.name}
                                  onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { name: event.target.value })}
                                />
                                <div>
                                  <strong>{heatLoss.watts}W</strong>
                                  <span>{heatLoss.btu} BTU</span>
                                </div>
                                <button className="simpro-options-button" type="button" onClick={() => removeHeatLossRoom(selectedQuoteCostCentre.id, room.id)}>
                                  Remove
                                </button>
                              </div>

                              <div className="heat-loss-grid">
                                <label>
                                  Room type
                                  <select value={room.roomType} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { roomType: event.target.value })}>
                                    {heatLossRoomTypes.map((option) => (
                                      <option key={option.id}>{option.id}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Length m
                                  <input
                                    inputMode="decimal"
                                    value={room.length}
                                    onChange={(event) => {
                                      if (isDecimalDraft(event.target.value)) {
                                        updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { length: event.target.value });
                                      }
                                    }}
                                  />
                                </label>
                                <label>
                                  Width m
                                  <input
                                    inputMode="decimal"
                                    value={room.width}
                                    onChange={(event) => {
                                      if (isDecimalDraft(event.target.value)) {
                                        updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { width: event.target.value });
                                      }
                                    }}
                                  />
                                </label>
                                <label>
                                  Height m
                                  <input
                                    inputMode="decimal"
                                    value={room.height}
                                    onChange={(event) => {
                                      if (isDecimalDraft(event.target.value)) {
                                        updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { height: event.target.value });
                                      }
                                    }}
                                  />
                                </label>
                                <label>
                                  External walls
                                  <select value={room.exteriorWalls ?? 2} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { exteriorWalls: Number(event.target.value) })}>
                                    <option value={0}>No Exterior Walls</option>
                                    {[1, 2, 3, 4].map((count) => (
                                      <option key={count} value={count}>{count} Exterior Wall{count === 1 ? "" : "s"}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Wall type
                                  <select value={room.wallType} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { wallType: event.target.value })}>
                                    {heatLossWallTypes.map((option) => (
                                      <option key={option.id}>{option.id}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Type of windows / doors
                                  <select value={room.glazingType} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { glazingType: event.target.value })}>
                                    {heatLossGlazingTypes.map((option) => (
                                      <option key={option.id}>{option.id}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Glazed area m2
                                  <input
                                    inputMode="decimal"
                                    value={room.glazingType === "No External Windows Or Doors" ? "0" : room.windowArea}
                                    disabled={room.glazingType === "No External Windows Or Doors"}
                                    onChange={(event) => {
                                      if (isDecimalDraft(event.target.value)) {
                                        updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { windowArea: event.target.value });
                                      }
                                    }}
                                  />
                                </label>
                                <label>
                                  Floor
                                  <select value={room.floorType} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { floorType: event.target.value })}>
                                    {heatLossFloorTypes.map((option) => (
                                      <option key={option.id}>{option.id}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Ceiling
                                  <select value={room.ceilingType} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { ceilingType: event.target.value })}>
                                    {heatLossCeilingTypes.map((option) => (
                                      <option key={option.id}>{option.id}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Heating system
                                  <select value={room.heatingSystemType ?? "Hydronic"} onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { heatingSystemType: event.target.value as HeatLossRoom["heatingSystemType"] })}>
                                    <option>Hydronic</option>
                                    <option>Electric</option>
                                  </select>
                                </label>
                                <label>
                                  Mean water temp C
                                  <input
                                    disabled={(room.heatingSystemType ?? "Hydronic") === "Electric"}
                                    inputMode="decimal"
                                    value={(room.heatingSystemType ?? "Hydronic") === "Electric" ? "N/A" : (room.meanWaterTemperature ?? "70")}
                                    onChange={(event) => {
                                      if (isDecimalDraft(event.target.value)) {
                                        updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { meanWaterTemperature: event.target.value });
                                      }
                                    }}
                                  />
                                </label>
                                <label>
                                  Preferred range
                                  <select
                                    value={room.preferredRange}
                                    onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { preferredRange: event.target.value, selectedRadiatorId: undefined })}
                                  >
                                    {radiatorRanges.map((range) => (
                                      <option key={range}>{range}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Recommended radiator
                                  <select
                                    value={selectedRadiator?.id ?? ""}
                                    onChange={(event) => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { selectedRadiatorId: event.target.value })}
                                  >
                                    {preferredCatalogue.map((radiator) => (
                                      <option key={radiator.id} value={radiator.id}>
                                        {radiator.range} {radiator.model} - {radiator.outputWatts}W
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div className="heat-loss-result-strip">
                                <div>
                                  <span>Suggested model</span>
                                  <strong>{selectedRadiator ? `${selectedRadiator.range} ${selectedRadiator.model}` : "No radiator found"}</strong>
                                </div>
                                <div>
                                  <span>Heat required</span>
                                  <strong>{heatLoss.watts}W / {heatLoss.btu} BTU</strong>
                                </div>
                                <div>
                                  <span>Radiator output needed</span>
                                  <strong>{heatLoss.radiatorOutputAtDeltaT50}W / {heatLoss.radiatorBtuAtDeltaT50} BTU</strong>
                                </div>
                                <div>
                                  <span>Delta-T / code</span>
                                  <strong>{(room.heatingSystemType ?? "Hydronic") === "Hydronic" ? `${Math.round(heatLoss.deltaT)}C` : "Electric"} · {selectedRadiator?.supplierSku ?? "-"}</strong>
                                </div>
                              </div>

                              <div className="radiator-options-strip">
                                <div className="radiator-options-head">
                                  <strong>Recommended radiator options</strong>
                                  <span>Pick the shape that fits the wall space.</span>
                                </div>
                                <div className="radiator-option-list">
                                  {recommendedOptions.map((radiator) => {
                                    const isSelected = selectedRadiator?.id === radiator.id;

                                    return (
                                      <button
                                        className={`radiator-option-card${isSelected ? " selected" : ""}`}
                                        key={radiator.id}
                                        type="button"
                                        onClick={() => updateHeatLossRoom(selectedQuoteCostCentre.id, room.id, { selectedRadiatorId: radiator.id })}
                                      >
                                        <span>{radiator.range}</span>
                                        <strong>{radiator.model}</strong>
                                        <small>{radiator.outputWatts}W · {radiator.orientation} · {radiator.supplierSku}</small>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                    ) : null}

                    {["summary", "catalogue", "one-off"].includes(activeQuoteBuildTab) ? (
                      (() => {
                        const materialLines = quoteCostCentreTotals(selectedQuoteCostCentre).materialLines;
                        const selectedIds = new Set(selectedQuoteMaterialLineIds[selectedQuoteCostCentre.id] ?? []);
                        const selectedCount = materialLines.filter((line) => selectedIds.has(line.id)).length;
                        const allSelected = materialLines.length > 0 && selectedCount === materialLines.length;

                        return (
                          <div className="simpro-billable-table">
                            <div className="simpro-billable-row table-head parts">
                              <span>Select</span>
                              <span>Description</span>
                              <span>Time (hrs)</span>
                              <span>Price</span>
                              <span>Markup</span>
                              <span>Sell Price</span>
                              <span>Qty</span>
                              <span>Total</span>
                              <span />
                            </div>
                            {materialLines.map((line) => (
                              <div className="simpro-billable-row parts" key={line.id}>
                                <input
                                  checked={selectedIds.has(line.id)}
                                  type="checkbox"
                                  aria-label={`Select ${line.description}`}
                                  onChange={(event) => toggleQuoteMaterialLineSelection(selectedQuoteCostCentre.id, line.id, event.target.checked)}
                                />
                                <textarea
                                  className="quote-line-description"
                                  value={line.description}
                                  onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { description: event.target.value })}
                                />
                                <input value={0} readOnly />
                                <input
                                  inputMode="decimal"
                                  placeholder="TBC"
                                  value={line.unitCost || ""}
                                  onChange={(event) => {
                                    const unitCost = Number(event.target.value) || 0;
                                    const markupPercent = quoteLineMarkupPercent(line) || 30;
                                    updateQuoteLine(selectedQuoteCostCentre.id, line.id, {
                                      unitCost,
                                      unitSell: lineSellFromMarkup(unitCost, markupPercent),
                                    });
                                  }}
                                />
                                <input
                                  inputMode="decimal"
                                  placeholder="TBC"
                                  value={line.unitCost > 0 ? quoteLineMarkupPercent(line) : ""}
                                  onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { unitSell: line.unitCost * (1 + ((Number(event.target.value) || 0) / 100)) })}
                                />
                                <input
                                  inputMode="decimal"
                                  placeholder="TBC"
                                  value={line.unitSell || ""}
                                  onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { unitSell: Number(event.target.value) || 0 })}
                                />
                                <input
                                  inputMode="decimal"
                                  value={line.quantity}
                                  onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { quantity: Number(event.target.value) || 0 })}
                                />
                                <strong>{line.unitSell > 0 ? currency(quoteLineSell(line)) : "Awaiting price"}</strong>
                                <div className="quote-line-actions">
                                  <button className="simpro-options-button" type="button" onClick={() => removeQuoteLine(selectedQuoteCostCentre.id, line.id)}>
                                    Remove <ChevronDown size={13} />
                                  </button>
                                </div>
                              </div>
                            ))}
                            {materialLines.length === 0 ? (
                              <div className="simpro-billable-row parts empty">
                                <span />
                                <strong>No material lines yet. Add a catalogue item, one-off material, or apply the radiator schedule above.</strong>
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                                <span />
                              </div>
                            ) : (
                              <div className="quote-bulk-action-bar">
                                <span>{selectedCount} selected</span>
                                <button className="simpro-options-button" type="button" onClick={() => toggleAllQuoteMaterialLineSelection(selectedQuoteCostCentre)}>
                                  {allSelected ? "Clear selection" : "Select all"}
                                </button>
                                <button className="simpro-options-button" type="button" disabled={selectedCount === 0} onClick={() => stageSelectedSupplierRequestLines(selectedQuoteCostCentre)}>
                                  Send to supplier request form
                                </button>
                                <button className="simpro-options-button" type="button" disabled={selectedCount === 0} onClick={() => openSelectedQuoteLinesCatalogFolderModal(selectedQuoteCostCentre)}>
                                  Add items to catalog
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : null}

                    {activeQuoteBuildTab === "summary" ? (
                    <div className="simpro-service-form">
                      <label>
                        Call out / Service Fee
                        <select defaultValue="none">
                          <option value="none">Not Selected</option>
                        </select>
                      </label>
                      <button className="simpro-blue-button" type="button">ADD</button>
                    </div>
                    ) : null}

                    {activeQuoteBuildTab === "supplier-request" ? (
                    <div className="supplier-quote-import">
                      <div className="supplier-quote-import-head">
                        <div>
                          <strong>Supplier quote / request</strong>
                          <span>Send the request, upload the returned PDF, review matched prices, then apply them to the quote summary.</span>
                        </div>
                        <FileText size={20} />
                      </div>
                      <div className="supplier-quote-controls">
                        <label>
                          Supplier
                          <input
                            placeholder="Select or enter supplier"
                            value={supplierQuoteDrafts[selectedQuoteCostCentre.id]?.supplier ?? ""}
                            onChange={(event) => updateSupplierQuoteDraft(selectedQuoteCostCentre.id, { supplier: event.target.value })}
                          />
                        </label>
                        <label>
                          Supplier email
                          <input
                            placeholder="quotes@supplier.co.uk"
                            value={supplierQuoteDrafts[selectedQuoteCostCentre.id]?.contactEmail ?? ""}
                            onChange={(event) => updateSupplierQuoteDraft(selectedQuoteCostCentre.id, { contactEmail: event.target.value })}
                          />
                        </label>
                        <button
                          className="simpro-grey-button"
                          type="button"
                          onClick={() => sendSupplierQuoteRequest(selectedQuoteCostCentre)}
                        >
                          SEND
                        </button>
                      </div>
                      <div className="supplier-email-panel">
                        <label>
                          Subject
                          <input
                            value={supplierQuoteDrafts[selectedQuoteCostCentre.id]?.subject ?? `${selectedQuote.ref} supplier quote request - ${selectedQuoteCostCentre.name}`}
                            onChange={(event) => updateSupplierQuoteDraft(selectedQuoteCostCentre.id, { subject: event.target.value })}
                          />
                        </label>
                        <label>
                          Message
                          <textarea
                            value={supplierQuoteDrafts[selectedQuoteCostCentre.id]?.message ?? `Please price the listed items for ${selectedQuoteCostCentre.name}. Quantities and notes are included below.`}
                            onChange={(event) => updateSupplierQuoteDraft(selectedQuoteCostCentre.id, { message: event.target.value })}
                          />
                        </label>
                      </div>
                      {(() => {
                        const supplierDraft = supplierQuoteDrafts[selectedQuoteCostCentre.id];
                        const requestLines = supplierRequestLinesForCentre(selectedQuoteCostCentre);
                        const requestTotal = requestLines.reduce((total, line) => total + quoteLineSell(line), 0);
                        const pricedCount = requestLines.filter((line) => line.unitCost > 0 && line.unitSell > 0).length;
                        const matchedCount = requestLines.filter((line) => supplierLineMatchState(selectedQuoteCostCentre, line) === "Matched").length;
                        if (!requestLines.length) {
                          return (
                            <div className="supplier-request-empty">
                              <strong>No supplier request items selected yet.</strong>
                              <span>Go to the Summary, Catalogue or One-off tab, tick the left-hand boxes for the items you want priced, then send them to the supplier request form.</span>
                            </div>
                          );
                        }

                        return (
                          <div className="supplier-request-pack">
                            <div className="supplier-document-preview">
                              <div>
                                <span>Supplier request preview</span>
                                <h3>{supplierDraft?.subject || `${selectedQuote.ref} supplier quote request - ${selectedQuoteCostCentre.name}`}</h3>
                                <p>{supplierDraft?.message || `Please price the listed items for ${selectedQuoteCostCentre.name}. Quantities and notes are included below.`}</p>
                              </div>
                              <div className="supplier-document-meta">
                                <span>To</span>
                                <strong>{supplierDraft?.supplier || "Supplier not selected"}</strong>
                                <span>Email</span>
                                <strong>{supplierDraft?.contactEmail || "Not entered"}</strong>
                                <span>Items</span>
                                <strong>{requestLines.length}</strong>
                              </div>
                            </div>

                            <div className="supplier-match-summary">
                              <div>
                                <span>Returned PDF</span>
                                <strong>{supplierDraft?.fileName || "Not uploaded yet"}</strong>
                              </div>
                              <div>
                                <span>Priced lines</span>
                                <strong>{pricedCount} / {requestLines.length}</strong>
                              </div>
                              <div>
                                <span>Matched lines</span>
                                <strong>{matchedCount}</strong>
                              </div>
                              <div>
                                <span>Supplier total</span>
                                <strong>{requestTotal > 0 ? currency(requestTotal) : "Awaiting price"}</strong>
                              </div>
                            </div>

                            <div className="supplier-quote-preview">
                              <div className="supplier-quote-preview-head">
                                <span>Requested item</span>
                                <span>Qty</span>
                                <span>Cost</span>
                                <span>Markup</span>
                                <strong>Sell</strong>
                                <span>Match</span>
                              </div>
                              {requestLines.map((line) => {
                                const matchState = supplierLineMatchState(selectedQuoteCostCentre, line);
                                return (
                                  <div className="supplier-quote-preview-row" key={line.id}>
                                    <span>{line.description}</span>
                                    <span>{line.quantity.toFixed(2)}</span>
                                    <span>{line.unitCost > 0 ? currency(line.unitCost) : "TBC"}</span>
                                    <span>{line.unitCost > 0 ? `${supplierDraft?.markupPercent ?? 30}%` : "TBC"}</span>
                                    <strong>{line.unitSell > 0 ? currency(line.unitSell) : "Awaiting price"}</strong>
                                    <span className={`supplier-match-pill ${matchState.toLowerCase().replaceAll(" ", "-")}`}>{matchState}</span>
                                  </div>
                                );
                              })}
                            </div>

                            <div className="supplier-document-trail">
                              <strong>Supplier document trail</strong>
                              <span>{supplierDraft?.sentAt ? `Request sent ${supplierDraft.sentAt.slice(0, 10)}` : "Request not sent yet"}</span>
                              <span>{supplierDraft?.fileName?.toLowerCase().endsWith(".pdf") ? `${supplierDraft.fileName} received and ready for review` : "Returned supplier PDF not uploaded yet"}</span>
                              <span>{pricedCount === requestLines.length && requestLines.length > 0 ? "Ready to apply into quote summary" : "Waiting for all supplier prices"}</span>
                            </div>

                            <div className="supplier-return-panel">
                              <div>
                                <strong>Returned supplier quote</strong>
                                <span>Upload the supplier PDF/CSV after they reply, then apply the matched cost prices into the quote.</span>
                              </div>
                              <label>
                                Supplier Quote
                                <input
                                  accept=".pdf,.csv,.txt,.tsv"
                                  type="file"
                                  onChange={(event) => handleSupplierQuoteUpload(selectedQuoteCostCentre, event)}
                                />
                              </label>
                              <label>
                                Markup %
                                <input
                                  inputMode="decimal"
                                  value={supplierQuoteDrafts[selectedQuoteCostCentre.id]?.markupPercent ?? 30}
                                  onChange={(event) => updateSupplierQuoteMarkup(selectedQuoteCostCentre.id, Number(event.target.value) || 0)}
                                />
                              </label>
                              <button
                                className="simpro-blue-button"
                                disabled={!supplierQuoteDrafts[selectedQuoteCostCentre.id]?.lines.length}
                                type="button"
                                onClick={() => applySupplierQuoteImport(selectedQuoteCostCentre.id)}
                              >
                                APPLY RETURNED QUOTE
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    ) : null}

                    {activeQuoteBuildTab === "labour" ? (
                    <>
                    <div className="simpro-labour-heading">
                      <div>
                        <h3>Labour</h3>
                        <span>Net rates before VAT</span>
                      </div>
                      <div>
                        <strong>Estimated Time: 0.00 hrs</strong>
                        <strong>Time Billed: {quoteCostCentreTotals(selectedQuoteCostCentre).labourLines.reduce((sum, line) => sum + line.quantity, 0).toFixed(2)} hrs</strong>
                      </div>
                    </div>
                    <div className="simpro-labour-add">
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          addQuoteLine(selectedQuoteCostCentre.id, event.target.value);
                          event.currentTarget.value = "";
                        }}
                      >
                        <option value="" disabled>0 Selected</option>
                        {availableQuoteCatalog.filter((item) => item.type === "Labour").map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <button className="primary-button" onClick={() => addQuoteLine(selectedQuoteCostCentre.id, "labour-engineer")}>
                        ADD
                      </button>
                    </div>
                    <div className="simpro-billable-table">
                      <div className="simpro-billable-row table-head labour">
                        <span />
                        <span>Labour Type</span>
                        <span>Cost Rate</span>
                        <span>Markup</span>
                        <span>Sell Price</span>
                        <span>Time (hrs)</span>
                        <span>Total</span>
                        <span />
                      </div>
                      {quoteCostCentreTotals(selectedQuoteCostCentre).labourLines.map((line) => (
                        <div className="simpro-billable-row labour" key={line.id}>
                          <input type="checkbox" aria-label={`Select ${line.description}`} />
                          <input
                            value={line.description}
                            onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { description: event.target.value })}
                          />
                          <input
                            inputMode="decimal"
                            value={line.unitCost}
                            onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { unitCost: Number(event.target.value) || 0 })}
                          />
                          <input
                            inputMode="decimal"
                            value={quoteLineMarkupPercent(line)}
                            onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { unitSell: line.unitCost * (1 + ((Number(event.target.value) || 0) / 100)) })}
                          />
                          <input
                            inputMode="decimal"
                            value={line.unitSell}
                            onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { unitSell: Number(event.target.value) || 0 })}
                          />
                          <input
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(event) => updateQuoteLine(selectedQuoteCostCentre.id, line.id, { quantity: Number(event.target.value) || 0 })}
                          />
                          <strong>{currency(quoteLineSell(line))}</strong>
                          <button className="simpro-options-button" onClick={() => removeQuoteLine(selectedQuoteCostCentre.id, line.id)}>
                            Options <ChevronDown size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    </>
                    ) : null}
                  </section>
                ) : null}

                {activeCostCentreTab === "options" ? (
                  <section className="simpro-empty-workspace">
                    <h2>Options</h2>
                    <p>Quote options will sit here so a customer can choose between alternatives such as boiler models before online acceptance creates the final cost centre.</p>
                  </section>
                ) : null}

                {activeCostCentreTab === "schedule" || activeCostCentreTab === "assets" ? (
                  <section className="simpro-empty-workspace">
                    <h2>{activeCostCentreTab === "schedule" ? "Schedule" : "Customer Assets"}</h2>
                    <p>{activeCostCentreTab === "schedule" ? "No visits are scheduled for this quote cost centre yet." : "No customer assets are linked to this quote cost centre yet."}</p>
                  </section>
                ) : null}
              </section>
            ) : null
          ) : homeView === "job-record" ? (
            selectedJob ? (
              <section className="quote-record-shell">
                <div className="quote-record-banner">
                  <div>
                    <span className="employee-record-eyebrow">Job record</span>
                    <h2>{selectedJob.ref}</h2>
                    <p>{selectedJob.description}</p>
                  </div>
                  <div className="quote-record-stats">
                    <div>
                      <strong>{currency(selectedJobCostSummary.totalCharge)}</strong>
                      <span>Charge</span>
                    </div>
                    <div>
                      <strong>{currency(selectedJobCostSummary.totalCost)}</strong>
                      <span>Expected cost</span>
                    </div>
                    <div className={selectedJobCostSummary.projectedProfit >= 0 ? "profit-positive" : "profit-negative"}>
                      <strong>{currency(selectedJobCostSummary.projectedProfit)}</strong>
                      <span>{selectedJobCostSummary.projectedMargin}% margin</span>
                    </div>
                  </div>
                </div>
                {renderWorkflowTracker(
                  buildWorkflowTrackerStages({
                    lead: selectedJobSourceQuote?.sourceLeadId
                      ? leads.find((lead) => lead.id === selectedJobSourceQuote.sourceLeadId) ?? null
                      : null,
                    quote: selectedJobSourceQuote,
                    job: selectedJob,
                    invoice: selectedInvoiceFromJob,
                  }),
                )}
                <div className="simpro-main-tabs" role="tablist" aria-label="Job record sections">
                  {jobDetailTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeJobTab === tab.key}
                      className={activeJobTab === tab.key ? "simpro-tab active" : "simpro-tab"}
                      onClick={() => {
                        setActiveJobTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeJobTab === "summary" ? (
                  <section className="quote-record-panel">
                    <div className="client-overview-grid">
                      <article className="client-info-card">
                        <span className="permission-heading">Job summary</span>
                        <dl>
                          <div>
                            <dt>Client</dt>
                            <dd>{selectedJobClient?.name ?? selectedJob.customer}</dd>
                          </div>
                          <div>
                            <dt>Site</dt>
                            <dd>{selectedJobSite?.name ?? selectedJob.site}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedJob.status}</dd>
                          </div>
                          <div>
                            <dt>Next action</dt>
                            <dd>{selectedJob.next}</dd>
                          </div>
                        </dl>
                      </article>
                      <article className="client-info-card">
                        <span className="permission-heading">Source quote</span>
                        {selectedJobSourceQuote ? (
                          <button className="drawer-link-card" type="button" onClick={() => openQuoteDrawer(selectedJobSourceQuote.id)}>
                            <FileText size={16} />
                            <span>
                              <strong>{selectedJobSourceQuote.ref}</strong>
                              <small>{selectedJobSourceQuote.status} · {currency(selectedJobSourceQuote.value)}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ) : (
                          <p>Manual job with no source quote.</p>
                        )}
                      </article>
                    </div>
                    <section className="quote-survey-pack-preview job-survey-pack-preview">
                      <div>
                        <span>Survey pack handover</span>
                        <strong>{selectedJobSurveyPack.assets.length} records from accepted scope</strong>
                      </div>
                      {selectedJobSurveyPack.assets.length > 0 ? (
                        <>
                          <div className="quote-survey-pack-stats">
                            <span>{selectedJobSurveyPack.scans.length} room scans</span>
                            <span>{selectedJobSurveyPack.photos.length} survey photos</span>
                            <span>{selectedJobSurveyPack.concepts.length} concept looks</span>
                            <span>{selectedJobSurveyPack.clientVisible.length} client visible</span>
                          </div>
                          <div className="quote-survey-pack-list">
                            {selectedJobSurveyPack.assets.slice(0, 6).map((asset) => (
                              <span key={`${asset.centreId}-${asset.id}`}>
                                {asset.title} · {asset.centreName} · {asset.clientVisible ? "public" : "private"}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <small>No survey records were handed over from the quote yet.</small>
                      )}
                    </section>
                    <section className="job-readiness-panel">
                      <header>
                        <div>
                          <span className="permission-heading">Ready to start</span>
                          <h2>Pre-start control checklist</h2>
                        </div>
                        <strong>
                          {selectedJobReadiness.completeCount}/{selectedJobReadiness.requiredCount}
                          <span> required</span>
                        </strong>
                      </header>
                      <div className="job-readiness-list">
                        {selectedJobReadiness.items.map((item) => (
                          <article
                            className={item.complete ? "job-readiness-item complete" : "job-readiness-item"}
                            key={item.label}
                          >
                            <span>{item.complete ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                            <div>
                              <strong>{item.label}</strong>
                              <small>{item.detail}</small>
                            </div>
                            {item.optional ? <em>Optional</em> : null}
                          </article>
                        ))}
                      </div>
                    </section>
                    <section className="job-scheduling-panel">
                      <header>
                        <div>
                          <span className="permission-heading">Scheduling</span>
                          <h2>Assign staff and move job forward</h2>
                        </div>
                        <span className={`status-pill ${selectedJob.status === "In progress" ? "green" : selectedJob.status === "Pending" ? "amber" : "blue"}`}>
                          {selectedJob.status}
                        </span>
                      </header>
                      {selectedJobScheduleDraft ? (
                        <div className="job-scheduling-grid">
                          <label>
                            Engineer / lead
                            <select
                              value={selectedJobScheduleDraft.manager}
                              onChange={(event) => updateSelectedJobScheduleDraft({ manager: event.target.value })}
                            >
                              {surveyorOptions.map((surveyor) => (
                                <option key={surveyor}>{surveyor}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Date
                            <input
                              type="date"
                              value={selectedJobScheduleDraft.scheduledDate}
                              onChange={(event) => updateSelectedJobScheduleDraft({ scheduledDate: event.target.value })}
                            />
                          </label>
                          <label>
                            Time
                            <input
                              type="time"
                              value={selectedJobScheduleDraft.scheduledTime}
                              onChange={(event) => updateSelectedJobScheduleDraft({ scheduledTime: event.target.value })}
                            />
                          </label>
                        </div>
                      ) : null}
                      <div className="job-scheduling-actions">
                        <button className="primary-button" type="button" onClick={scheduleSelectedJob}>
                          Schedule staff
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!selectedJob.scheduledDate || !selectedJob.scheduledTime}
                          onClick={requestSelectedJobAttendanceConfirmation}
                        >
                          Request confirmation
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!selectedJob.scheduledDate || !selectedJob.scheduledTime}
                          onClick={confirmSelectedJobAttendance}
                        >
                          Confirmed
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={selectedJob.status === "In progress"}
                          onClick={markSelectedJobArrived}
                        >
                          Arrived / start
                        </button>
                      </div>
                      <div className="attendance-status-panel">
                        <div>
                          <span>Attendance status</span>
                          <strong>{selectedJobAttendanceStatus}</strong>
                        </div>
                        <p>
                          {selectedJob.scheduledDate && selectedJob.scheduledTime
                            ? `${selectedJob.manager} · ${selectedJob.scheduledDate} at ${selectedJob.scheduledTime}`
                            : "Schedule this job before requesting engineer confirmation."}
                        </p>
                      </div>
                    </section>
                    <section className="job-review-panel">
                      <header>
                        <div>
                          <span className="permission-heading">Completion review</span>
                          <h2>Pass around before invoicing</h2>
                        </div>
                        <strong>{jobReviewChecks.filter((check) => selectedJobReviewState[check.key]).length}/{jobReviewChecks.length}</strong>
                      </header>
                      <div className="job-review-checklist">
                        {jobReviewChecks.map((check) => (
                          <button
                            className={selectedJobReviewState[check.key] ? "job-review-check checked" : "job-review-check"}
                            key={check.key}
                            type="button"
                            onClick={() => toggleSelectedJobReview(check.key)}
                          >
                            <span>{selectedJobReviewState[check.key] ? <Check size={15} /> : null}</span>
                            <strong>{check.label}</strong>
                            <small>{check.detail}</small>
                          </button>
                        ))}
                      </div>
                      <div className="job-scheduling-actions">
                        <button className="secondary-button" type="button" onClick={completeSelectedJob}>
                          Mark complete
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={!selectedJobReviewComplete}
                          onClick={approveSelectedJobForInvoice}
                        >
                          Approve for invoice
                        </button>
                      </div>
                    </section>
                    <section className="job-delivery-panel">
                      <header>
                        <div>
                          <span className="permission-heading">Project management</span>
                          <h2>WhatsApp, timesheets, POs and variations</h2>
                        </div>
                        <span className="status-pill blue">{selectedJobDeliveryEvents.length} events</span>
                      </header>

                      <div className="job-delivery-stats" aria-label="Job delivery totals">
                        <article>
                          <span>Site updates</span>
                          <strong>{selectedJobDeliveryEvents.filter((event) => event.kind === "whatsapp").length}</strong>
                        </article>
                        <article>
                          <span>Timesheets</span>
                          <strong>{selectedJobTimesheetHours.toFixed(1)}h</strong>
                        </article>
                        <article>
                          <span>PO requests</span>
                          <strong>{selectedJobPurchaseRequests.length}</strong>
                        </article>
                        <article>
                          <span>Variations</span>
                          <strong>{selectedJobVariations.length}</strong>
                        </article>
                      </div>

                      <div className="job-delivery-grid">
                        <article className="job-delivery-card">
                          <header>
                            <strong>Site update</strong>
                            <small>Captured from WhatsApp doorway</small>
                          </header>
                          <label>
                            Message
                            <textarea
                              value={selectedJobDeliveryDraft.whatsappNote}
                              onChange={(event) => updateSelectedJobDeliveryDraft({ whatsappNote: event.target.value })}
                              placeholder="Example: arrived on site, customer asked about moving radiator..."
                            />
                          </label>
                          <button className="secondary-button" type="button" onClick={logSelectedJobWhatsappUpdate}>
                            Capture update
                          </button>
                        </article>

                        <article className="job-delivery-card">
                          <header>
                            <strong>Timesheet</strong>
                            <small>Engineer time against this job</small>
                          </header>
                          <div className="job-delivery-two-col">
                            <label>
                              Hours
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={selectedJobDeliveryDraft.timesheetHours}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ timesheetHours: event.target.value })}
                              />
                            </label>
                            <label>
                              Engineer
                              <input value={selectedJob.manager} readOnly />
                            </label>
                          </div>
                          <label>
                            Notes
                            <textarea
                              value={selectedJobDeliveryDraft.timesheetNote}
                              onChange={(event) => updateSelectedJobDeliveryDraft({ timesheetNote: event.target.value })}
                              placeholder="What was done during these hours?"
                            />
                          </label>
                          <button className="secondary-button" type="button" onClick={submitSelectedJobTimesheet}>
                            Submit timesheet
                          </button>
                        </article>

                        <article className="job-delivery-card wide">
                          <header>
                            <strong>Variation</strong>
                            <small>Creates an office review draft before client approval</small>
                          </header>
                          <label>
                            Work description
                            <textarea
                              value={selectedJobDeliveryDraft.variationDescription}
                              onChange={(event) => updateSelectedJobDeliveryDraft({ variationDescription: event.target.value })}
                              placeholder="Describe the extra works and why they are needed."
                            />
                          </label>
                          <div className="job-delivery-four-col">
                            <label>
                              Labour hrs
                              <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={selectedJobDeliveryDraft.variationHours}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ variationHours: event.target.value })}
                              />
                            </label>
                            <label>
                              Materials
                              <input
                                value={selectedJobDeliveryDraft.variationMaterials}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ variationMaterials: event.target.value })}
                                placeholder="Pipe, fittings, valves"
                              />
                            </label>
                            <label>
                              Cost
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={selectedJobDeliveryDraft.variationCost}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ variationCost: event.target.value })}
                              />
                            </label>
                            <label>
                              Sell
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={selectedJobDeliveryDraft.variationSell}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ variationSell: event.target.value })}
                              />
                            </label>
                          </div>
                          <button className="primary-button" type="button" onClick={raiseSelectedJobVariation}>
                            Raise variation
                          </button>
                        </article>

                        <article className="job-delivery-card wide">
                          <header>
                            <strong>Purchase order</strong>
                            <small>Request materials for this job</small>
                          </header>
                          <div className="job-delivery-four-col">
                            <label>
                              Supplier
                              <input
                                value={selectedJobDeliveryDraft.poSupplier}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ poSupplier: event.target.value })}
                                placeholder="City Plumbing"
                              />
                            </label>
                            <label>
                              Item
                              <input
                                value={selectedJobDeliveryDraft.poItem}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ poItem: event.target.value })}
                                placeholder="Radiators, valves, copper..."
                              />
                            </label>
                            <label>
                              Estimated cost
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={selectedJobDeliveryDraft.poEstimatedCost}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ poEstimatedCost: event.target.value })}
                              />
                            </label>
                            <label>
                              Reason
                              <input
                                value={selectedJobDeliveryDraft.poReason}
                                onChange={(event) => updateSelectedJobDeliveryDraft({ poReason: event.target.value })}
                                placeholder="Needed for first fix"
                              />
                            </label>
                          </div>
                          <button className="secondary-button" type="button" onClick={requestSelectedJobPurchaseOrder}>
                            Request PO
                          </button>
                        </article>
                      </div>

                      <div className="job-delivery-list">
                        <strong>Latest job activity</strong>
                        {selectedJobDeliveryEvents.length === 0 ? (
                          <p>No site updates, timesheets, variations or PO requests captured yet.</p>
                        ) : (
                          selectedJobDeliveryEvents.slice(0, 5).map((event) => (
                            <article key={event.id} className="job-delivery-event">
                              <span className={`delivery-kind ${event.kind}`}>{event.kind}</span>
                              <div>
                                <strong>{event.summary}</strong>
                                <small>
                                  {event.actor} · {event.source} · {event.createdAt}
                                  {event.status ? ` · ${event.status}` : ""}
                                </small>
                              </div>
                              {event.kind === "timesheet" ? <b>{(event.hours ?? 0).toFixed(1)}h</b> : null}
                              {event.kind === "po" || event.kind === "variation" ? <b>{currency(event.sellValue ?? event.costValue ?? 0)}</b> : null}
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  </section>
                ) : null}

                {activeJobTab === "cost-centres" ? (
                  <section className="simpro-estimate-page">
                    <div className="simpro-sub-tabs" role="tablist" aria-label="Cost centre categories">
                      <button className="active" type="button">Base scope <span>{selectedJobEstimateCostCentres.length}</span></button>
                      <button type="button">Options</button>
                    </div>

                    <h2 className="simpro-page-title">Base Scope Cost Centres</h2>

                    <div className="simpro-filter-band">
                      <label>
                        Filter By Name/ID
                        <input aria-label="Filter cost centres by name or ID" />
                      </label>
                    </div>

                    <div className="simpro-section-heading">
                      <h3>Sections</h3>
                      <button className="simpro-grey-button" type="button">SECTIONS <ChevronDown size={14} /></button>
                    </div>

                    <div className="simpro-section-create">
                      <label>
                        Name
                        <input />
                      </label>
                      <label>
                        Description <span>(Optional)</span>
                        <input placeholder="Enter a description..." />
                      </label>
                      <button className="simpro-blue-button" type="button">ADD</button>
                    </div>

                    <section className="simpro-section-card">
                      <header>
                        <span className="simpro-drag-handle" aria-hidden="true" />
                        <strong>Bathroom refurbishment</strong>
                        <button className="simpro-options-button" type="button" onClick={() => showNotice("Section options are next to wire up.")}>
                          Options <ChevronDown size={13} />
                        </button>
                      </header>

                      <div className="simpro-cost-centre-add">
                        <label>
                          Default category
                          <select
                            value={jobCostCentreTemplateDraft}
                            onChange={(event) => setJobCostCentreTemplateDraft(event.target.value)}
                          >
                            {costCentreTemplates.map((template) => (
                              <option key={template} value={template}>{template}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Cost Centre Name <span>(Optional)</span>
                          <input
                            placeholder="Enter Name here..."
                            value={jobCostCentreNameDraft}
                            onChange={(event) => setJobCostCentreNameDraft(event.target.value)}
                          />
                        </label>
                        <button className="simpro-blue-button" type="button" onClick={addJobCostCentre}>ADD</button>
                        <button className="simpro-grey-button align-right" type="button">WORK PACKAGES <ChevronDown size={14} /></button>
                      </div>

                      <div className="simpro-cost-centre-list">
                      {selectedJobEstimateCostCentres.map((centre) => {
                        const totals = estimateCostCentreTotals(centre);
                        return (
                          <div
                            className="simpro-cost-centre-row"
                            key={centre.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openCostCentreRecord(centre.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openCostCentreRecord(centre.id);
                              }
                            }}
                          >
                            <span className="simpro-drag-handle" aria-hidden="true" />
                            <input aria-label={`Select ${centre.name}`} type="checkbox" onClick={(event) => event.stopPropagation()} />
                            <strong className="simpro-row-title">
                              {centre.name}
                              <small>{centre.templateName ?? "Uncategorised"}</small>
                              {(centre.surveyAssets?.length ?? 0) > 0 ? (
                                <small>{centre.surveyAssets?.length} survey records handed over</small>
                              ) : null}
                            </strong>
                            <span className="simpro-row-total">Total: {currency(totals.totalSell)}</span>
                            <div className="simpro-row-actions">
                              <button
                                className="simpro-options-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCostCentreActionMenu((current) =>
                                    current?.scope === "job" && current.id === centre.id ? null : { scope: "job", id: centre.id },
                                  );
                                }}
                              >
                                Options <ChevronDown size={13} />
                              </button>
                              {costCentreActionMenu?.scope === "job" && costCentreActionMenu.id === centre.id ? (
                                <div className="cost-centre-options-menu" onClick={(event) => event.stopPropagation()}>
                                  <button type="button" onClick={() => startRenameCostCentre("job", centre)}>Rename display name</button>
                                  <button type="button" onClick={() => openCostCentreRecord(centre.id)}>Open cost centre</button>
                                </div>
                              ) : null}
                            </div>
                            <button className="simpro-kebab-button" type="button" onClick={(event) => { event.stopPropagation(); showNotice("More cost centre actions are next to wire up."); }}>
                              <MoreHorizontal size={16} />
                            </button>
                            {renamingCostCentre?.scope === "job" && renamingCostCentre.id === centre.id ? (
                              <div className="cost-centre-rename-row" onClick={(event) => event.stopPropagation()}>
                                <label>
                                  Display name
                                  <input value={renameCostCentreDraft} onChange={(event) => setRenameCostCentreDraft(event.target.value)} />
                                </label>
                                <button className="simpro-blue-button" type="button" onClick={saveRenameCostCentre}>Save</button>
                                <button className="simpro-grey-button" type="button" onClick={cancelRenameCostCentre}>Cancel</button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                      </div>
                    </section>
                  </section>
                ) : null}

                {activeJobTab === "engineer-flow" ? renderEngineerFlowWorkspace(selectedJob) : null}

                {activeJobTab === "documents" ? renderDocumentWorkspace("job", selectedJob.ref) : null}

                {activeJobTab === "variations" ? (
                  <section className="quote-record-panel">
                    <div className="variation-list">
                      {selectedJobVariations.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No variations logged</strong>
                          <span>Priced and approved variations will appear here.</span>
                        </div>
                      ) : null}
                      {selectedJobVariations.map((variation) => (
                        <article className="variation-card" key={variation.id}>
                          <header>
                            <div>
                              <strong>{variation.reference}</strong>
                              <span>{variation.title}</span>
                            </div>
                            <span className="status-pill amber">{variation.status}</span>
                          </header>
                          <p className="variation-description">{variation.description}</p>
                          <div className="variation-detail-grid">
                            <div>
                              <span>Raised by</span>
                              <strong>{variation.engineerName ?? "Engineer"}</strong>
                            </div>
                            <div>
                              <span>Reason</span>
                              <strong>{variation.reason ?? "Not recorded"}</strong>
                            </div>
                            <div>
                              <span>Hours</span>
                              <strong>{variation.labourHours ? `${variation.labourHours} hrs` : "TBC"}</strong>
                            </div>
                            <div>
                              <span>Client approval</span>
                              <strong>{variation.requiresClientApproval ? variation.clientApprovalStatus ?? "Not sent" : "Not required"}</strong>
                            </div>
                          </div>
                          <div className="variation-materials">
                            <span>Materials / engineer note</span>
                            <strong>{variation.materialsUsed ?? "No materials recorded yet."}</strong>
                          </div>
                          <div className="variation-money">
                            <div>
                              <span>Cost</span>
                              <strong>{currency(variation.costValue)}</strong>
                            </div>
                            <div>
                              <span>Charge</span>
                              <strong>{currency(variation.sellValue)}</strong>
                            </div>
                            <div>
                              <span>Profit</span>
                              <strong>{currency(variation.sellValue - variation.costValue)}</strong>
                            </div>
                          </div>
                          <div className="variation-approval-panel">
                            <div>
                              <span>Variation quote</span>
                              <strong>{variation.reference} · {currency(variation.sellValue)}</strong>
                              <small>
                                {variation.requiresClientApproval
                                  ? "Send to client for online approval before works proceed."
                                  : "Captured after works; office can approve for billing."}
                              </small>
                            </div>
                            <div className="variation-actions">
                              <button
                                className="simpro-grey-button"
                                type="button"
                                onClick={() => showNotice(`${variation.reference} variation quote preview opened.`)}
                              >
                                Preview
                              </button>
                              <button
                                className="simpro-blue-button"
                                type="button"
                                disabled={
                                  variation.source === "seed" ||
                                  variation.requiresClientApproval === false ||
                                  variation.status === "Client approved" ||
                                  variation.status === "Approved" ||
                                  variation.status === "Proceed"
                                }
                                onClick={() => sendSelectedJobVariationForApproval(variation.id)}
                              >
                                Send for approval
                              </button>
                              <button
                                className="simpro-grey-button"
                                type="button"
                                disabled={!variation.portalToken}
                                onClick={() => copySelectedJobVariationPortalLink(variation.id)}
                              >
                                Copy approval link
                              </button>
                              <button
                                className="simpro-save-button"
                                type="button"
                                disabled={
                                  variation.source === "seed" ||
                                  (variation.requiresClientApproval
                                    ? variation.status !== "Sent for approval"
                                    : variation.status === "Approved" || variation.status === "Client approved" || variation.status === "Proceed")
                                }
                                onClick={() => approveSelectedJobVariation(variation.id)}
                              >
                                Mark approved / proceed
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeJobTab === "logs" ? (
                  <section className="quote-logs-panel">
                    <header>
                      <div>
                        <span className="permission-heading">Job history</span>
                        <h2>Logs & communications</h2>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          refreshSelectedJobVariationPortalStatuses().catch(() => {});
                          showNotice("Variation portal and job logs refreshed locally.");
                        }}
                      >
                        Refresh logs
                      </button>
                    </header>
                    <div className="quote-log-summary-grid">
                      <div>
                        <span>Outlook messages</span>
                        <strong>{selectedJobCommunications.length}</strong>
                      </div>
                      <div>
                        <span>Site activity</span>
                        <strong>{selectedJobDeliveryEvents.length}</strong>
                      </div>
                      <div>
                        <span>Audit events</span>
                        <strong>{selectedJobAudit.length}</strong>
                      </div>
                    </div>
                    <section className="communication-capture-panel">
                      <div>
                        <span className="permission-heading">Outlook thread</span>
                        <h3>Capture job email</h3>
                      </div>
                      <div className="communication-capture-grid">
                        <label>
                          From
                          <input
                            value={selectedJobCommunicationDraft.from}
                            onChange={(event) => updateCommunicationDraft("job", selectedJob.id, { from: event.target.value })}
                            placeholder={selectedJobClient?.email ?? selectedJob.customer}
                          />
                        </label>
                        <label>
                          Subject
                          <input
                            value={selectedJobCommunicationDraft.subject}
                            onChange={(event) => updateCommunicationDraft("job", selectedJob.id, { subject: event.target.value })}
                            placeholder={`Re: ${selectedJob.ref}`}
                          />
                        </label>
                        <label className="wide">
                          Message
                          <textarea
                            value={selectedJobCommunicationDraft.body}
                            onChange={(event) => updateCommunicationDraft("job", selectedJob.id, { body: event.target.value })}
                            placeholder="Paste or summarise a job email here."
                          />
                        </label>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          captureOutlookReply("job", selectedJob.id, selectedJobCommunicationDraft, {
                            defaultFrom: selectedJobClient?.email ?? selectedJob.customer,
                            to: "office@errolwatsongroup.co.uk",
                            relatedJobId: selectedJob.id,
                            label: selectedJob.ref,
                          })
                        }
                      >
                        Capture Outlook email
                      </button>
                    </section>
                    <div className="communication-thread">
                      {renderCommunicationThread(selectedJobCommunications)}
                    </div>
                    <div className="job-delivery-list">
                      <strong>Site activity</strong>
                        {selectedJobDeliveryEvents.length === 0 ? (
                          <p>No WhatsApp, timesheet, PO or variation events captured yet.</p>
                        ) : (
                          selectedJobDeliveryEvents.map((event) => (
                            <article key={event.id} className="job-delivery-event">
                              <span className={`delivery-kind ${event.kind}`}>{event.kind}</span>
                              <div>
                                <strong>{event.summary}</strong>
                                <small>
                                  {event.actor} · {event.source} · {event.createdAt}
                                  {variationApprovalText(event) ? ` · ${variationApprovalText(event)}` : ""}
                                </small>
                              </div>
                              {event.status ? <b>{event.status}</b> : null}
                            </article>
                          ))
                        )}
                    </div>
                    <div className="quote-log-list">
                      {selectedJobAudit.length > 0 ? (
                        selectedJobAudit.map((event) => (
                          <article key={event.id}>
                            <span className={`quote-log-action ${event.importance}`}>{event.action}</span>
                            <div>
                              <strong>{event.summary}</strong>
                              <span>{event.actor} · {event.createdAt} · {event.source}</span>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p>No job audit events captured yet.</p>
                      )}
                    </div>
                  </section>
                ) : null}
              </section>
            ) : null
          ) : homeView === "cost-centre-record" ? (
            selectedJob && selectedCostCentre ? (
              <section className="simpro-record-shell">
                <div className="simpro-record-titlebar">
                  <div>
                    <span>Quotes /</span>
                    <strong>{selectedJob.sourceQuoteId ? selectedJobSourceQuote?.ref ?? selectedJob.ref : selectedJob.ref} - {selectedCostCentre.name}</strong>
                  </div>
                  <div className="simpro-title-actions">
                    <button className="simpro-grey-button" type="button" onClick={returnToJobRecord}>CANCEL</button>
                    <button className="simpro-save-button" type="button" onClick={() => showNotice("Estimate saved locally in this prototype.")}>SAVE AND FINISH</button>
                  </div>
                </div>

                <div className="simpro-main-tabs" role="tablist" aria-label="Cost centre sections">
                  {jobCostCentreTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeCostCentreTab === tab.key}
                      className={activeCostCentreTab === tab.key ? "simpro-tab active" : "simpro-tab"}
                      onClick={() => {
                        setActiveCostCentreTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeCostCentreTab === "summary" ? (
                  <section className="simpro-detail-grid">
                    <div className="simpro-summary-panel">
                      <h2>Summary</h2>
                      <div className="cost-centre-identity-card">
                        <div>
                          <span>Cost Centre Name</span>
                          <strong>{selectedCostCentre.name}</strong>
                        </div>
                        <div>
                          <span>Default category</span>
                          <strong>{selectedCostCentre.templateName ?? "Uncategorised"}</strong>
                        </div>
                      </div>
                      {(selectedCostCentre.surveyAssets?.length ?? 0) > 0 ? (
                        <div className="quote-survey-pack-preview cost-centre-survey-pack">
                          <div>
                            <span>Survey records</span>
                            <strong>{selectedCostCentre.surveyAssets?.length} attached to this cost centre</strong>
                          </div>
                          <div className="quote-survey-pack-list">
                            {selectedCostCentre.surveyAssets?.map((asset) => (
                              <span key={asset.id}>
                                {asset.kind}: {asset.title} · {asset.status} · {asset.clientVisible ? "public" : "private"}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {(() => {
                        const totals = estimateCostCentreTotals(selectedCostCentre);
                        return (
                          <>
                            <div className="hubflo-total-strip">
                              <div>
                                <span>Cost to us</span>
                                <strong>{currency(totals.totalCost)}</strong>
                              </div>
                              <div>
                                <span>Charge to client</span>
                                <strong>{currency(totals.totalSell)}</strong>
                              </div>
                              <div className={totals.profit >= 0 ? "profit-positive" : "profit-negative"}>
                                <span>Potential profit</span>
                                <strong>{currency(totals.profit)}</strong>
                              </div>
                              <div>
                                <span>Margin</span>
                                <strong>{totals.margin}%</strong>
                              </div>
                            </div>

                            <h3>Parts & Labour</h3>
                            <div className="simpro-summary-table">
                              <div className="table-head">
                                <span>Description</span>
                                <span>Quantity</span>
                                <span>Item Sell</span>
                                <span>Total</span>
                              </div>
                              {selectedCostCentre.materials.map((line) => (
                                <div className="table-row" key={line.id}>
                                  <a>{line.description}</a>
                                  <span>{line.quantity.toFixed(2)}</span>
                                  <span>{currency(lineSellFromMarkup(line.unitCost, line.markupPercent))}</span>
                                  <strong>{currency(estimateMaterialSell(line))}</strong>
                                </div>
                              ))}
                              {selectedCostCentre.labour.map((line) => (
                                <div className="table-row" key={line.id}>
                                  <span>{line.role}</span>
                                  <span>{line.hours.toFixed(2)} hrs</span>
                                  <span>{currency(lineSellFromMarkup(line.costRate, line.markupPercent))}</span>
                                  <strong>{currency(estimateLabourSell(line))}</strong>
                                </div>
                              ))}
                            </div>

                            <h3>Breakdown</h3>
                            <div className="simpro-breakdown-table">
                              <div><span>Materials Cost</span><strong>{currency(totals.materialCost)}</strong></div>
                              <div><span>Resources Cost</span><strong>{currency(totals.labourCost)}</strong></div>
                              <div className="nested"><span>Labour</span><strong>{currency(totals.labourCost)}</strong></div>
                              <div><span>Materials Markup</span><strong>{currency(totals.materialSell - totals.materialCost)}</strong></div>
                              <div><span>Resources Markup</span><strong>{currency(totals.labourSell - totals.labourCost)}</strong></div>
                              <div><span>Discount/Fee</span><strong>{currency(0)}</strong></div>
                              <div className="total"><span>Sub Total</span><strong>{currency(totals.totalSell)}</strong></div>
                              <div><span>VAT</span><strong>{currency(totals.totalSell * 0.2)}</strong></div>
                              <div className={totals.profit >= 0 ? "profit-positive total" : "profit-negative total"}>
                                <span>Potential Profit</span>
                                <strong>{currency(totals.profit)} · {totals.margin}%</strong>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <aside className="simpro-activity-panel">
                      <h2>Activity</h2>
                      <h3>Schedule</h3>
                      <p><AlertTriangle size={16} /> No one is scheduled or assigned to this cost centre.</p>
                      <h3>Timeline</h3>
                      <div className="simpro-timeline-card">
                        <strong>{activeEmployee?.name ?? "Verrova"} - Note</strong>
                        <span>{selectedCostCentre.name} estimate opened.</span>
                      </div>
                    </aside>
                  </section>
                ) : null}

                {activeCostCentreTab === "info" ? (
                  <section className="simpro-info-page">
                    <div className="simpro-editor-card">
                      <div className="simpro-editor-header">
                        <strong>Description</strong>
                        <select defaultValue="">
                          <option value="">Insert script</option>
                        </select>
                      </div>
                      <div className="simpro-editor-toolbar">
                        <b>B</b><i>I</i><u>U</u><span>10pt</span><span>A</span><span>☰</span><span>•</span><span>▦</span><MoreHorizontal size={16} />
                      </div>
                      <textarea
                        value={selectedCostCentre.clientDescription}
                        onChange={(event) => updateEstimateCostCentre(selectedCostCentre.id, { clientDescription: event.target.value })}
                      />
                    </div>
                    <div className="simpro-editor-card notes">
                      <div className="simpro-editor-header">
                        <strong>Notes <span>These notes are private and are not visible to the customer.</span></strong>
                      </div>
                      <div className="simpro-editor-toolbar">
                        <b>B</b><i>I</i><u>U</u><span>10pt</span><span>A</span><span>☰</span><span>•</span><span>▦</span><MoreHorizontal size={16} />
                      </div>
                      <textarea
                        value={selectedCostCentre.engineerDescription}
                        onChange={(event) => updateEstimateCostCentre(selectedCostCentre.id, { engineerDescription: event.target.value })}
                      />
                    </div>
                  </section>
                ) : null}

                {activeCostCentreTab === "parts-labour" ? (
                  <section className="simpro-parts-page">
                    <div className="simpro-sub-tabs" role="tablist" aria-label="Parts and labour sections">
                      <button className="active" type="button">Scope build</button>
                      <button type="button">Takeoff handoff</button>
                      <button type="button">Assemblies</button>
                      <button type="button">Catalogue</button>
                      <button type="button">Stock</button>
                      <button type="button">One-off items</button>
                    </div>
                    <div className="simpro-parts-header">
                      <div>
                        <h2>Scope build</h2>
                        <h3>Parts</h3>
                        <span>Net prices before VAT</span>
                      </div>
                      <select
                        aria-label="Add material item"
                        defaultValue=""
                        onChange={(event) => {
                          addEstimateMaterialLine(selectedCostCentre.id, event.target.value);
                          event.currentTarget.value = "";
                        }}
                      >
                        <option value="" disabled>Add from catalog</option>
                        {quoteCatalog.filter((item) => item.type !== "Labour").map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.type}: {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="simpro-billable-table">
                      <div className="simpro-billable-row table-head parts">
                        <span />
                        <span>Description</span>
                        <span>Time (hrs)</span>
                        <span>Price</span>
                        <span>Markup</span>
                        <span>Sell Price</span>
                        <span>Qty</span>
                        <span>Total</span>
                        <span />
                      </div>
                      {selectedCostCentre.materials.map((line) => {
                        const unitSell = lineSellFromMarkup(line.unitCost, line.markupPercent);
                        return (
                          <div className="simpro-billable-row parts" key={line.id}>
                            <input type="checkbox" aria-label={`Select ${line.description}`} />
                            <input
                              value={line.description}
                              onChange={(event) => updateEstimateMaterialLine(selectedCostCentre.id, line.id, { description: event.target.value })}
                            />
                            <input value={0} readOnly />
                            <input
                              inputMode="decimal"
                              value={line.unitCost}
                              onChange={(event) => updateEstimateMaterialLine(selectedCostCentre.id, line.id, { unitCost: Number(event.target.value) || 0 })}
                            />
                            <input
                              inputMode="decimal"
                              value={line.markupPercent}
                              onChange={(event) => updateEstimateMaterialLine(selectedCostCentre.id, line.id, { markupPercent: Number(event.target.value) || 0 })}
                            />
                            <input
                              inputMode="decimal"
                              value={Math.round(unitSell * 100) / 100}
                              onChange={(event) => {
                                const sell = Number(event.target.value) || 0;
                                const markup = line.unitCost > 0 ? ((sell - line.unitCost) / line.unitCost) * 100 : 0;
                                updateEstimateMaterialLine(selectedCostCentre.id, line.id, { markupPercent: Math.round(markup * 100) / 100 });
                              }}
                            />
                            <input
                              inputMode="decimal"
                              value={line.quantity}
                              onChange={(event) => updateEstimateMaterialLine(selectedCostCentre.id, line.id, { quantity: Number(event.target.value) || 0 })}
                            />
                            <strong>{currency(estimateMaterialSell(line))}</strong>
                            <button className="simpro-options-button" onClick={() => removeEstimateMaterialLine(selectedCostCentre.id, line.id)}>
                              Options <ChevronDown size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="simpro-service-form">
                      <label>
                        Call out / Service Fee
                        <select defaultValue="none">
                          <option value="none">Not Selected</option>
                        </select>
                      </label>
                      <button className="simpro-blue-button" type="button">ADD</button>
                      <label>
                        Supplier
                        <input placeholder="Select supplier" />
                      </label>
                      <label>
                        Supplier Quote
                        <select defaultValue="0">
                          <option value="0">0 Selected</option>
                        </select>
                      </label>
                      <button className="simpro-blue-button" type="button">APPLY</button>
                    </div>

                    <div className="simpro-labour-heading">
                      <div>
                        <h3>Labour</h3>
                        <span>Net rates before VAT</span>
                      </div>
                      <div>
                        <strong>Estimated Time: 0.00 hrs</strong>
                        <strong>Time Billed: {selectedCostCentre.labour.reduce((sum, line) => sum + line.hours, 0).toFixed(2)} hrs</strong>
                      </div>
                    </div>
                    <div className="simpro-labour-add">
                      <select defaultValue="0">
                        <option value="0">0 Selected</option>
                        <option value="plumber">Plumbing rate</option>
                        <option value="joiner">Joinery Labour</option>
                      </select>
                      <button className="primary-button" onClick={() => addEstimateLabourLine(selectedCostCentre.id)}>
                        ADD
                      </button>
                    </div>
                    <div className="simpro-billable-table">
                      <div className="simpro-billable-row table-head labour">
                        <span />
                        <span>Labour Type</span>
                        <span>Cost Rate</span>
                        <span>Markup</span>
                        <span>Sell Price</span>
                        <span>Time (hrs)</span>
                        <span>Total</span>
                        <span />
                      </div>
                      {selectedCostCentre.labour.map((line) => {
                        const sellRate = lineSellFromMarkup(line.costRate, line.markupPercent);
                        return (
                          <div className="simpro-billable-row labour" key={line.id}>
                            <input type="checkbox" aria-label={`Select ${line.role}`} />
                            <input
                              value={line.role}
                              onChange={(event) => updateEstimateLabourLine(selectedCostCentre.id, line.id, { role: event.target.value })}
                            />
                            <input
                              inputMode="decimal"
                              value={line.costRate}
                              onChange={(event) => updateEstimateLabourLine(selectedCostCentre.id, line.id, { costRate: Number(event.target.value) || 0 })}
                            />
                            <input
                              inputMode="decimal"
                              value={line.markupPercent}
                              onChange={(event) => updateEstimateLabourLine(selectedCostCentre.id, line.id, { markupPercent: Number(event.target.value) || 0 })}
                            />
                            <input
                              inputMode="decimal"
                              value={Math.round(sellRate * 100) / 100}
                              onChange={(event) => {
                                const sell = Number(event.target.value) || 0;
                                const markup = line.costRate > 0 ? ((sell - line.costRate) / line.costRate) * 100 : 0;
                                updateEstimateLabourLine(selectedCostCentre.id, line.id, { markupPercent: Math.round(markup * 100) / 100 });
                              }}
                            />
                            <input
                              inputMode="decimal"
                              value={line.hours}
                              onChange={(event) => updateEstimateLabourLine(selectedCostCentre.id, line.id, { hours: Number(event.target.value) || 0 })}
                            />
                            <strong>{currency(estimateLabourSell(line))}</strong>
                            <button className="simpro-options-button" onClick={() => removeEstimateLabourLine(selectedCostCentre.id, line.id)}>
                              Options <ChevronDown size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {activeCostCentreTab === "variations" ? (
                  <section className="quote-record-panel">
                    <div className="variation-list">
                      {selectedJobVariations.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No variations logged</strong>
                          <span>Variations raised while this job is in progress will appear here for office review and client approval.</span>
                        </div>
                      ) : null}
                      {selectedJobVariations.map((variation) => (
                        <article className="variation-card" key={variation.id}>
                          <header>
                            <div>
                              <strong>{variation.reference}</strong>
                              <span>{variation.title}</span>
                            </div>
                            <span className="status-pill amber">{variation.status}</span>
                          </header>
                          <p className="variation-description">{variation.description}</p>
                          <div className="variation-detail-grid">
                            <div>
                              <span>Raised by</span>
                              <strong>{variation.engineerName ?? "Engineer"}</strong>
                            </div>
                            <div>
                              <span>Hours</span>
                              <strong>{variation.labourHours ? `${variation.labourHours} hrs` : "TBC"}</strong>
                            </div>
                            <div>
                              <span>Materials</span>
                              <strong>{variation.materialsUsed ?? "No materials recorded yet."}</strong>
                            </div>
                            <div>
                              <span>Client approval</span>
                              <strong>{variation.requiresClientApproval ? variation.clientApprovalStatus ?? "Not sent" : "Not required"}</strong>
                            </div>
                          </div>
                          <div className="variation-money">
                            <div>
                              <span>Cost</span>
                              <strong>{currency(variation.costValue)}</strong>
                            </div>
                            <div>
                              <span>Charge</span>
                              <strong>{currency(variation.sellValue)}</strong>
                            </div>
                            <div>
                              <span>Profit</span>
                              <strong>{currency(variation.sellValue - variation.costValue)}</strong>
                            </div>
                          </div>
                          <div className="variation-approval-panel">
                            <div>
                              <span>Variation quote</span>
                              <strong>{variation.reference} · {currency(variation.sellValue)}</strong>
                              <small>
                                {variation.requiresClientApproval
                                  ? "Send to client for online approval before works proceed."
                                  : "Captured after works; office can approve for billing."}
                              </small>
                            </div>
                            <div className="variation-actions">
                              <button className="simpro-grey-button" type="button" onClick={() => showNotice(`${variation.reference} variation quote preview opened.`)}>
                                Preview
                              </button>
                              <button
                                className="simpro-blue-button"
                                type="button"
                                disabled={
                                  variation.source === "seed" ||
                                  variation.requiresClientApproval === false ||
                                  variation.status === "Client approved" ||
                                  variation.status === "Approved" ||
                                  variation.status === "Proceed"
                                }
                                onClick={() => sendSelectedJobVariationForApproval(variation.id)}
                              >
                                Send for approval
                              </button>
                              <button className="simpro-grey-button" type="button" disabled={!variation.portalToken} onClick={() => copySelectedJobVariationPortalLink(variation.id)}>
                                Copy approval link
                              </button>
                              <button
                                className="simpro-save-button"
                                type="button"
                                disabled={
                                  variation.source === "seed" ||
                                  (variation.requiresClientApproval
                                    ? variation.status !== "Sent for approval"
                                    : variation.status === "Approved" || variation.status === "Client approved" || variation.status === "Proceed")
                                }
                                onClick={() => approveSelectedJobVariation(variation.id)}
                              >
                                Mark approved / proceed
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeCostCentreTab === "schedule" || activeCostCentreTab === "assets" ? (
                  <section className="simpro-empty-workspace">
                    <h2>{activeCostCentreTab === "schedule" ? "Schedule" : "Customer Assets"}</h2>
                    <p>{activeCostCentreTab === "schedule" ? "No visits are scheduled for this cost centre yet." : "No customer assets are linked to this cost centre yet."}</p>
                  </section>
                ) : null}
              </section>
                ) : null
          ) : homeView === "invoices" ? (
            <section className="quote-panel">
              <div className="panel-header">
                <div>
                  <h2>Invoices</h2>
                  <p>Draft, sent, paid and cancelled invoices with quick source linking.</p>
                </div>
                <label className="status-filter">
                  <select value={invoiceStatusFilter} onChange={(event) => setInvoiceStatusFilter(event.target.value)} aria-label="Filter invoices by status">
                    <option>All invoices</option>
                    {invoiceStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="quote-row table-header">
                <span>Invoice / title</span>
                <span>Source</span>
                <span>Customer</span>
                <span>Status</span>
                <span>Amount</span>
                <span>Due</span>
              </div>
              {filteredInvoices.map((invoice) => {
                const source =
                  invoice.sourceType === "quote"
                    ? quotes.find((item) => item.id === invoice.sourceId)
                    : jobs.find((item) => item.id === invoice.sourceId);
                return (
                  <div
                    className="quote-row clickable"
                    key={invoice.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openInvoiceRecord(invoice.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openInvoiceRecord(invoice.id);
                      }
                    }}
                  >
                    <div className="job-identity">
                      <div>
                        <StatusDot tone={invoice.status === "Paid" ? "green" : invoice.status === "Partially paid" ? "amber" : invoice.status === "Cancelled" ? "red" : "blue"} />
                        <a href="#" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openInvoiceRecord(invoice.id); }}>
                          {invoice.ref}
                        </a>
                        <span>{invoice.title}</span>
                      </div>
                      <strong>{invoice.notes}</strong>
                    </div>
                    <span className="quote-site">{invoice.sourceName}</span>
                    <span className="manager">{invoice.customer}</span>
                    <span className={`status-pill ${invoice.status === "Cancelled" ? "red" : invoice.status === "Paid" ? "green" : "blue"}`}>
                      {invoice.status}
                    </span>
                    <strong className="value">{currency(invoice.chargeTotal)}</strong>
                    <span className="next-action quote-workflow-action">
                      <strong>Due {invoice.dueDate}</strong>
                      <small>{source ? (invoice.sourceType === "quote" ? source.next : source.next) : "No source activity"}</small>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (invoice.sourceType === "quote") {
                            const sourceQuote = source as Quote | undefined;
                            if (sourceQuote) openQuoteDrawer(sourceQuote.id);
                          } else {
                            const sourceJob = source as Job | undefined;
                            if (sourceJob) openJobDrawer(sourceJob.id);
                          }
                        }}
                      >
                        Open {invoice.sourceType}
                      </button>
                    </span>
                  </div>
                );
              })}
            </section>
          ) : homeView === "invoice-record" ? (
            selectedInvoice ? (
              <section className="quote-record-shell">
                <div className="quote-record-banner">
                  <div>
                    <span className="employee-record-eyebrow">Invoice</span>
                    <h2>{selectedInvoice.ref}</h2>
                    <p>{selectedInvoice.title}</p>
                  </div>
                  <div className="quote-record-stats">
                    <div>
                      <strong>{currency(selectedInvoice.chargeTotal)}</strong>
                      <span>Charge total</span>
                    </div>
                    <div>
                      <strong>{currency(selectedInvoice.costTotal)}</strong>
                      <span>Cost total</span>
                    </div>
                    <div className={selectedInvoiceFinancials.profit >= 0 ? "profit-positive" : "profit-negative"}>
                      <strong>{currency(selectedInvoiceFinancials.profit)}</strong>
                      <span>{selectedInvoiceFinancials.margin}% margin</span>
                    </div>
                    <div>
                      <strong>{currency(selectedInvoiceFinancials.grandTotal)}</strong>
                      <span>Grand total</span>
                    </div>
                  </div>
                </div>

                {renderWorkflowTracker(
                  buildWorkflowTrackerStages({
                    quote: selectedInvoiceSourceQuote,
                    job: selectedInvoiceSourceJob,
                    invoice: selectedInvoice,
                  }),
                )}

                <div className="simpro-main-tabs" role="tablist" aria-label="Invoice sections">
                  {invoiceTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeInvoiceTab === tab.key}
                      className={activeInvoiceTab === tab.key ? "simpro-tab active" : "simpro-tab"}
                      onClick={() => setActiveInvoiceTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeInvoiceTab === "summary" ? (
                  <section className="quote-record-panel">
                    <div className="client-overview-grid">
                      <article className="client-info-card">
                        <span className="permission-heading">Invoice details</span>
                        <dl>
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedInvoice.status}</dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{selectedInvoice.sourceName}</dd>
                          </div>
                          <div>
                            <dt>Issued</dt>
                            <dd>{selectedInvoice.issuedDate}</dd>
                          </div>
                          <div>
                            <dt>Due</dt>
                            <dd>{selectedInvoice.dueDate}</dd>
                          </div>
                        </dl>
                      </article>
                      <article className="client-info-card">
                        <span className="permission-heading">Source record</span>
                        {selectedInvoiceSourceQuote ? (
                          <button className="drawer-link-card" type="button" onClick={() => openQuoteDrawer(selectedInvoiceSourceQuote.id)}>
                            <FileText size={16} />
                            <span>
                              <strong>{selectedInvoiceSourceQuote.ref}</strong>
                              <small>{selectedInvoiceSourceQuote.status} · {currency(selectedInvoiceSourceQuote.value)}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ) : selectedInvoiceSourceJob ? (
                          <button className="drawer-link-card" type="button" onClick={() => openJobDrawer(selectedInvoiceSourceJob.id)}>
                            <FileText size={16} />
                            <span>
                              <strong>{selectedInvoiceSourceJob.ref}</strong>
                              <small>{selectedInvoiceSourceJob.status} · {currency(selectedInvoiceSourceJob.value)}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ) : (
                          <p>No linked quote or job to open.</p>
                        )}
                      </article>
                    </div>

                    <section className="job-readiness-panel invoice-readiness-panel">
                      <header>
                        <div>
                          <span className="permission-heading">Ready to send</span>
                          <h2>Invoice send checklist</h2>
                        </div>
                        <strong>
                          {selectedInvoiceReadiness.completeCount}/{selectedInvoiceReadiness.requiredCount}
                          <span> required</span>
                        </strong>
                      </header>
                      <div className="job-readiness-list invoice-readiness-list">
                        {selectedInvoiceReadiness.items.map((item) => (
                          <article
                            className={item.complete ? "job-readiness-item complete" : "job-readiness-item"}
                            key={item.label}
                          >
                            <span>{item.complete ? <Check size={15} /> : <AlertTriangle size={15} />}</span>
                            <div>
                              <strong>{item.label}</strong>
                              <small>{item.detail}</small>
                            </div>
                            {item.optional ? <em>Optional</em> : null}
                          </article>
                        ))}
                      </div>
                    </section>

                    {selectedInvoiceEmailDraft ? (
                      <section className="invoice-email-panel">
                        <header>
                          <div>
                            <span className="permission-heading">Outlook invoice email</span>
                            <h2>Send final invoice</h2>
                          </div>
                          <span className={`status-pill ${selectedInvoice.status === "Sent" || selectedInvoice.status === "Paid" ? "green" : "blue"}`}>
                            {selectedInvoice.status}
                          </span>
                        </header>
                        <div className="invoice-email-grid">
                          <label>
                            To
                            <input
                              value={selectedInvoiceEmailDraft.to}
                              onChange={(event) => updateSelectedInvoiceEmailDraft({ to: event.target.value })}
                            />
                          </label>
                          <label>
                            Cc
                            <input
                              value={selectedInvoiceEmailDraft.cc}
                              onChange={(event) => updateSelectedInvoiceEmailDraft({ cc: event.target.value })}
                            />
                          </label>
                          <label className="full-field">
                            Subject
                            <input
                              value={selectedInvoiceEmailDraft.subject}
                              onChange={(event) => updateSelectedInvoiceEmailDraft({ subject: event.target.value })}
                            />
                          </label>
                          <label className="full-field">
                            Message
                            <textarea
                              value={selectedInvoiceEmailDraft.body}
                              onChange={(event) => updateSelectedInvoiceEmailDraft({ body: event.target.value })}
                            />
                          </label>
                          <label className="quote-email-checkbox full-field">
                            <input
                              checked={selectedInvoiceEmailDraft.attachPdf}
                              type="checkbox"
                              onChange={(event) => updateSelectedInvoiceEmailDraft({ attachPdf: event.target.checked })}
                            />
                            Attach generated invoice PDF
                          </label>
                        </div>
                        <div className="job-scheduling-actions">
                          <small>
                            {selectedInvoice.sentAt
                              ? `Last sent ${selectedInvoice.sentAt} to ${selectedInvoice.sentTo ?? "recipient"}`
                              : selectedInvoiceSourceJob
                                ? `Sending will mark ${selectedInvoiceSourceJob.ref} as Invoiced.`
                                : "Not sent yet"}
                          </small>
                          <button className="primary-button" type="button" onClick={sendSelectedInvoiceEmail}>
                            <Mail size={15} />
                            Email invoice
                          </button>
                        </div>
                      </section>
                    ) : null}

                    <section className="simpro-summary-page">
                      <h2 className="permission-heading">Category summary</h2>
                      <div className="hubflo-total-strip">
                        <div>
                          <span>Materials cost</span>
                          <strong>{currency(selectedInvoiceCategoryTotals.materialsCost)}</strong>
                        </div>
                        <div>
                          <span>Materials charge</span>
                          <strong>{currency(selectedInvoiceCategoryTotals.materialsCharge)}</strong>
                        </div>
                        <div>
                          <span>Labour cost</span>
                          <strong>{currency(selectedInvoiceCategoryTotals.labourCost)}</strong>
                        </div>
                        <div>
                          <span>Labour charge</span>
                          <strong>{currency(selectedInvoiceCategoryTotals.labourCharge)}</strong>
                        </div>
                        <div>
                          <span>Variations cost</span>
                          <strong>{currency(selectedInvoiceCategoryTotals.variationsCost)}</strong>
                        </div>
                        <div>
                          <span>Variations charge</span>
                          <strong>{currency(selectedInvoiceCategoryTotals.variationsCharge)}</strong>
                        </div>
                        <div>
                          <span>VAT</span>
                          <strong>{currency(selectedInvoiceFinancials.vatAmount)}</strong>
                        </div>
                      </div>
                    </section>
                  </section>
                ) : null}

                {activeInvoiceTab === "lines" ? (
                  <section className="simpro-summary-page">
                    <div className="simpro-summary-table">
                      <div className="table-head">
                        <span>Description</span>
                        <span>Category</span>
                        <span>Cost</span>
                        <span>Charge</span>
                        <span>Profit</span>
                      </div>
                      {selectedInvoice.lines.map((line) => (
                        <div className="table-row" key={line.id}>
                          <a>{line.description}</a>
                          <span>{line.category}</span>
                          <span>{currency(line.costToUs)}</span>
                          <span>{currency(line.chargeToClient)}</span>
                          <strong>{currency(line.chargeToClient - line.costToUs)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeInvoiceTab === "documents" ? <div className="simpro-empty-workspace">{renderDocumentWorkspace("invoice", selectedInvoice.ref)}</div> : null}

                {activeInvoiceTab === "logs" ? (
                  <section className="client-record-panel">
                    <section className="communication-capture-panel">
                      <div>
                        <span className="permission-heading">Outlook thread</span>
                        <h3>Invoice replies</h3>
                      </div>
                      <div className="communication-capture-grid">
                        <label>
                          From
                          <input
                            value={selectedInvoiceCommunicationDraft.from}
                            onChange={(event) => updateCommunicationDraft("invoice", selectedInvoice.id, { from: event.target.value })}
                            placeholder={selectedInvoiceClient?.email ?? selectedInvoice.customer}
                          />
                        </label>
                        <label>
                          Subject
                          <input
                            value={selectedInvoiceCommunicationDraft.subject}
                            onChange={(event) => updateCommunicationDraft("invoice", selectedInvoice.id, { subject: event.target.value })}
                            placeholder={`Re: ${selectedInvoice.ref}`}
                          />
                        </label>
                        <label className="wide">
                          Message
                          <textarea
                            value={selectedInvoiceCommunicationDraft.body}
                            onChange={(event) => updateCommunicationDraft("invoice", selectedInvoice.id, { body: event.target.value })}
                            placeholder="Paste remittance, payment query or invoice reply here."
                          />
                        </label>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          captureOutlookReply("invoice", selectedInvoice.id, selectedInvoiceCommunicationDraft, {
                            defaultFrom: selectedInvoiceClient?.email ?? selectedInvoice.customer,
                            to: "accounts@errolwatsongroup.co.uk",
                            relatedJobId: selectedInvoice.sourceType === "job" ? selectedInvoice.sourceId : undefined,
                            label: selectedInvoice.ref,
                          })
                        }
                      >
                        Capture Outlook reply
                      </button>
                    </section>
                    <div className="communication-thread">
                      {renderCommunicationThread(selectedInvoiceCommunications)}
                    </div>
                    {selectedInvoiceAudit.length === 0 ? (
                      <div className="employee-empty-panel">
                        <strong>No audit log</strong>
                        <span>Invoice actions and updates will appear here.</span>
                      </div>
                    ) : null}
                    <div className="client-history-list">
                      {selectedInvoiceAudit.map((event) => (
                        <article className="client-history-item" key={event.id}>
                          <div className="client-history-head">
                            <strong>{event.summary}</strong>
                            <span className={`status-pill ${event.importance === "high" ? "amber" : "blue"}`}>
                              {event.action}
                            </span>
                          </div>
                          <p>
                            {event.actor} · {event.createdAt} · {event.source}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </section>
            ) : null
          ) : homeView === "lead-record" ? (
            selectedLead ? (
              <section className="lead-record-shell">
                <div className="client-record-banner">
                  <div>
                    <span className="employee-record-eyebrow">Lead enquiry</span>
                    <h2>{selectedLead.ref}</h2>
                    <p>{selectedLead.customerName} · {selectedLead.source}</p>
                  </div>
                  <div className="client-record-stats">
                    <div>
                      <strong>{selectedLead.status}</strong>
                      <span>Status</span>
                    </div>
                    <div>
                      <strong>{selectedLead.surveyor}</strong>
                      <span>Assigned surveyor</span>
                    </div>
                    <div>
                      <strong>{selectedLead.surveyTime || "TBC"}</strong>
                      <span>{selectedLead.surveyDate || "Date to confirm"}</span>
                    </div>
                  </div>
                </div>

                {renderWorkflowTracker(
                  buildWorkflowTrackerStages({
                    lead: selectedLead,
                    quote: getLeadQuote(selectedLead),
                  }),
                )}

                <div className="employee-tab-strip" role="tablist" aria-label="Lead record sections">
                  {leadTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeLeadTab === tab.key}
                      className={activeLeadTab === tab.key ? "employee-tab active" : "employee-tab"}
                      onClick={() => {
                        setActiveLeadTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <section className="client-record-panel">
                  {activeLeadTab === "details" ? (
                    <div className="client-overview-grid">
                      <article className="client-info-card">
                        <span className="permission-heading">Customer enquiry</span>
                        <dl>
                          <div>
                            <dt>Name</dt>
                            <dd>{selectedLead.customerName}</dd>
                          </div>
                          <div>
                            <dt>Phone</dt>
                            <dd>{selectedLead.phone || "No phone"}</dd>
                          </div>
                          <div>
                            <dt>Email</dt>
                            <dd>{selectedLead.email || "No email"}</dd>
                          </div>
                          <div>
                            <dt>Address</dt>
                            <dd>{selectedLead.address}</dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{selectedLead.source}</dd>
                          </div>
                          <div>
                            <dt>Created by</dt>
                            <dd>{selectedLead.createdBy} · {selectedLead.createdAt}</dd>
                          </div>
                        </dl>
                      </article>

                      <article className="client-info-card">
                        <span className="permission-heading">Description of work</span>
                        <p>{selectedLead.description}</p>
                        <button className="primary-button" onClick={() => markLeadQuoted(selectedLead)}>
                          Create quote
                        </button>
                      </article>
                    </div>
                  ) : null}

                  {activeLeadTab === "survey" ? (
                    <div className="client-overview-grid">
                      <article className="client-info-card">
                        <span className="permission-heading">Survey appointment</span>
                        <div className="lead-survey-form">
                          <label>
                            Assigned to
                            <select value={selectedLead.surveyor} onChange={(event) => updateLeadSurvey(selectedLead.id, { surveyor: event.target.value })}>
                              {surveyorOptions.map((surveyor) => (
                                <option key={surveyor}>{surveyor}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Date
                            <input type="date" value={selectedLead.surveyDate} onChange={(event) => updateLeadSurvey(selectedLead.id, { surveyDate: event.target.value })} />
                          </label>
                          <label>
                            Time
                            <input type="time" value={selectedLead.surveyTime} onChange={(event) => updateLeadSurvey(selectedLead.id, { surveyTime: event.target.value })} />
                          </label>
                          <p>{selectedLead.next}</p>
                        </div>
                        {selectedLeadScheduleWarning ? (
                          <div className="lead-clash-alert">
                            <AlertTriangle size={16} />
                            <span>{selectedLeadScheduleWarning}</span>
                          </div>
                        ) : null}
                        <button className="primary-button" disabled={Boolean(selectedLeadScheduleWarning)} onClick={() => markLeadSurveyBooked(selectedLead)}>
                          Mark survey booked
                        </button>
                      </article>
                      <article className="client-info-card">
                        <span className="permission-heading">Availability on {selectedLead.surveyDate || "selected date"}</span>
                        <div className="lead-record-availability">
                          {surveyorOptions.map((surveyor) => {
                            const leadBookingCount = leadSurveyBookings.filter(
                              (booking) => booking.surveyor === surveyor && booking.date === selectedLead.surveyDate && booking.id !== selectedLead.id,
                            ).length;
                            const jobBookingCount = jobScheduleBookings.filter(
                              (booking) => booking.manager === surveyor && booking.date === selectedLead.surveyDate,
                            ).length;
                            const bookedCount = leadBookingCount + jobBookingCount;
                            return (
                              <button
                                type="button"
                                key={surveyor}
                                className={selectedLead.surveyor === surveyor ? "active" : ""}
                                onClick={() => updateLeadSurvey(selectedLead.id, { surveyor })}
                              >
                                <strong>{surveyor}</strong>
                                <span>{availabilityLabel(surveyor, selectedLead.surveyDate)}</span>
                                <small>{bookedCount} booked</small>
                              </button>
                            );
                          })}
                        </div>
                        <p>When the appointment is booked, Verrova logs it and notifies the assigned surveyor with the customer, address, source and description.</p>
                        <button
                          className="secondary-button"
                          disabled={selectedLead.status !== "Survey booked"}
                          onClick={() => {
                            logAuditEvent({
                              actor: "Verrova",
                              action: "notified",
                              recordType: "lead",
                              recordId: selectedLead.id,
                              summary: `${selectedLead.surveyor} notified for ${selectedLead.ref}.`,
                              source: "lead scheduler",
                              importance: "high",
                            });
                            showNotice(`${selectedLead.surveyor} notified for ${selectedLead.ref}.`);
                          }}
                        >
                          Send notification again
                        </button>
                      </article>
                    </div>
                  ) : null}

                  {activeLeadTab === "documents" ? renderDocumentWorkspace("lead", selectedLead.ref) : null}

                  {activeLeadTab === "logs" ? (
                    <div className="client-history-list">
                      {selectedLeadAudit.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No logs yet</strong>
                          <span>Lead creation, survey booking, notifications and quote conversion will appear here.</span>
                        </div>
                      ) : null}
                      {selectedLeadAudit.map((event) => (
                        <article className="client-history-item" key={event.id}>
                          <div className="client-history-head">
                            <strong>{event.summary}</strong>
                            <span className={`status-pill ${event.importance === "high" ? "amber" : "blue"}`}>
                              {event.action}
                            </span>
                          </div>
                          <p>
                            {event.actor} · {event.createdAt} · {event.source}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              </section>
            ) : null
          ) : homeView === "schedule" ? (
            <section className="scheduler-shell">
              <div className="panel-header">
                <div>
                  <h2>Survey scheduler</h2>
                  <p>Lead and job bookings are shown against each engineer&apos;s availability.</p>
                </div>
                <div className="scheduler-date-tabs" role="tablist" aria-label="Scheduler dates">
                  {schedulerDays.map((day) => (
                    <button
                      key={day.date}
                      type="button"
                      className={scheduleDate === day.date ? "active" : ""}
                      onClick={() => setScheduleDate(day.date)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scheduler-grid">
                {surveyorOptions.map((surveyor) => {
                  const availability = availabilityForDate(surveyor, scheduleDate);
                  const bookings = bookingsForSelectedDate
                    .filter((booking) => booking.surveyor === surveyor)
                    .sort((first, second) => first.time.localeCompare(second.time));

                  return (
                    <section className="scheduler-column" key={surveyor}>
                      <header>
                        <div>
                          <h3>{surveyor}</h3>
                          <span className={availability.active ? "scheduler-available" : "scheduler-unavailable"}>
                            {availabilityLabel(surveyor, scheduleDate)}
                          </span>
                        </div>
                        <strong>{bookings.length}</strong>
                      </header>

                      <div className="scheduler-lane">
                        {availability.active ? (
                          <div className="scheduler-availability-window">
                            Available {availability.from} to {availability.to}
                          </div>
                        ) : (
                          <div className="scheduler-closed-window">Unavailable</div>
                        )}

                        {bookings.map((booking) => (
                          <button
                            className="scheduler-booking"
                            key={booking.id}
                            type="button"
                            onClick={() =>
                              "type" in booking && booking.type === "Job" ? openJobDrawer(booking.id) : openLeadRecord(booking.id)
                            }
                          >
                            <time>{booking.time}</time>
                            <strong>{booking.ref} · {booking.customerName}</strong>
                            <span>{booking.address}</span>
                            <small>{booking.description}</small>
                          </button>
                        ))}

                        {bookings.length === 0 ? (
                          <div className="scheduler-empty-slot">
                            <strong>No bookings for this timeslot</strong>
                            <span>{availability.active ? "Available for new quote visits." : "Choose another day or person."}</span>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          ) : homeView === "settings" ? (
            <section className="setup-workspace">
              <div className="panel-header">
                <div>
                  <h2>Verrova setup</h2>
                  <p>Default folders, visibility and engineer stop/go flows that records inherit across leads, quotes and jobs.</p>
                </div>
              </div>

              <section className="setup-panel setup-readiness">
                <div className="documents-toolbar">
                  <div>
                    <span className="permission-heading">Live readiness</span>
                    <h2>Core systems</h2>
                  </div>
                  <span className="setup-status-label">Build status: on track</span>
                </div>
                <div className="setup-readiness-grid">
                  <article>
                    <span>Data persistence</span>
                    <strong>Quotes, jobs, leads and POs persist to workspace</strong>
                    <small>Stored in .hubflo-runtime files for repeatable sessions.</small>
                  </article>
                  <article>
                    <span>Audit trail</span>
                    <strong>History retained across app restarts</strong>
                    <small>Create, linked and status-change events are preserved.</small>
                  </article>
                  <article>
                    <span>Engineer path</span>
                    <strong>Routes and job actions remain active</strong>
                    <small>WhatsApp capture is ready for test profile, then production keys.</small>
                  </article>
                  <article>
                    <span>Client registry</span>
                    <strong>New customers and sites can be reused across leads and quotes</strong>
                    <small>No duplicate creation for repeated enquiries from the same contact.</small>
                  </article>
                </div>
              </section>

              <section className="setup-panel">
                <div className="documents-toolbar">
                  <div>
                    <span className="permission-heading">Documents</span>
                    <h2>Default folder template</h2>
                  </div>
                  <div className="setup-add-folder">
                    <input
                      aria-label="New folder name"
                      placeholder="Add folder name"
                      value={newDocumentFolderName}
                      onChange={(event) => setNewDocumentFolderName(event.target.value)}
                    />
                    <button className="primary-button" type="button" onClick={addDocumentFolderTemplate}>
                      <Plus size={15} />
                      Add folder
                    </button>
                  </div>
                </div>

                <div className="setup-folder-list">
                  {documentFolderTemplates.map((folder) => (
                    <article className="setup-folder-row" key={folder.id}>
                      <label>
                        Folder name
                        <input value={folder.name} onChange={(event) => updateDocumentFolder(folder.id, { name: event.target.value })} />
                      </label>
                      <label>
                        Default visibility
                        <select
                          value={folder.defaultVisibility}
                          onChange={(event) =>
                            updateDocumentFolder(folder.id, { defaultVisibility: event.target.value as DocumentVisibility })
                          }
                        >
                          <option>Private</option>
                          <option>Engineer</option>
                          <option>Client</option>
                        </select>
                      </label>
                      <label>
                        Description
                        <input value={folder.description} onChange={(event) => updateDocumentFolder(folder.id, { description: event.target.value })} />
                      </label>
                      <div className="setup-record-scope" aria-label={`${folder.name} record types`}>
                        {(["lead", "quote", "job", "invoice"] as RecordDocumentScope[]).map((recordType) => (
                          <label key={recordType}>
                            <input
                              type="checkbox"
                              checked={folder.recordTypes.includes(recordType)}
                              onChange={(event) => {
                                const recordTypes = event.target.checked
                                  ? Array.from(new Set([...folder.recordTypes, recordType]))
                                  : folder.recordTypes.filter((type) => type !== recordType);
                                updateDocumentFolder(folder.id, { recordTypes });
                              }}
                            />
                            {recordType}
                          </label>
                        ))}
                      </div>
                      <button className="secondary-button" type="button" onClick={() => removeDocumentFolderTemplate(folder.id)}>
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              <section className="setup-panel">
                <div className="documents-toolbar">
                  <div>
                    <span className="permission-heading">Engineer app</span>
                    <h2>Boiler stop/go flow</h2>
                  </div>
                  <span className="setup-flow-count">{engineerFlowTemplate.steps.filter((step) => step.required).length} required checks</span>
                </div>

                <div className="setup-template-card">
                  <label>
                    Template name
                    <input
                      value={engineerFlowTemplate.name}
                      onChange={(event) => setEngineerFlowTemplate((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <div>
                    <span className="permission-heading">Applies when cost centre category is</span>
                    <strong>{engineerFlowTemplate.appliesTo.join(", ")}</strong>
                    <p>Later, Setup can add more flow templates for bathrooms, servicing, drainage and reactive works.</p>
                  </div>
                </div>

                <div className="setup-flow-list">
                  {engineerFlowTemplate.steps.map((step) => (
                    <article className="setup-flow-row" key={step.id}>
                      <label>
                        Stage
                        <select
                          value={step.stage}
                          onChange={(event) => updateEngineerFlowStep(step.id, { stage: event.target.value as EngineerFlowStep["stage"] })}
                        >
                          <option>Existing Boiler</option>
                          <option>New Boiler</option>
                          <option>Commissioning</option>
                          <option>Handover</option>
                        </select>
                      </label>
                      <label>
                        Check required
                        <input value={step.label} onChange={(event) => updateEngineerFlowStep(step.id, { label: event.target.value })} />
                      </label>
                      <label>
                        Evidence
                        <select
                          value={step.evidence}
                          onChange={(event) => updateEngineerFlowStep(step.id, { evidence: event.target.value as EngineerFlowEvidence })}
                        >
                          <option>Photo</option>
                          <option>Text</option>
                          <option>Number</option>
                          <option>Signature</option>
                          <option>Checkbox</option>
                        </select>
                      </label>
                      <label className="setup-required-toggle">
                        <input
                          type="checkbox"
                          checked={step.required}
                          onChange={(event) => updateEngineerFlowStep(step.id, { required: event.target.checked })}
                        />
                        Required stop/go
                      </label>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          ) : homeView === "leads" ? (
            <section className="lead-workspace">
              <div className="panel-header">
                <div>
                  <h2>Lead intake</h2>
                  <p>Office enquiries from phone, Checkatrade, email and referrals before they become quotes.</p>
                </div>
                <div className="panel-controls">
                  <label className="status-filter">
                    <select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)} aria-label="Filter leads by status">
                      <option>All leads</option>
                      {leadStatuses.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button" onClick={createLead}>
                    <Plus size={16} />
                    New lead
                  </button>
                </div>
              </div>

              <div className="lead-summary-grid">
                <article>
                  <span>Open enquiries</span>
                  <strong>{leads.filter((lead) => !["Quoted", "Lost"].includes(lead.status)).length}</strong>
                  <small>Before quote stage</small>
                </article>
                <article>
                  <span>Surveys booked</span>
                  <strong>{leads.filter((lead) => lead.status === "Survey booked").length}</strong>
                  <small>Assigned to {surveyorOptions.join(", ")}</small>
                </article>
                <article>
                  <span>Need scheduling</span>
                  <strong>{leads.filter((lead) => lead.status === "Needs scheduling").length}</strong>
                  <small>Carol to check diary</small>
                </article>
              </div>

              <div className="lead-layout">
                <section className="lead-list-panel">
                  <div className="lead-row table-header">
                    <span>Lead / customer</span>
                    <span>Source</span>
                    <span>Survey</span>
                    <span>Status</span>
                    <span>Next action</span>
                  </div>
                  {filteredLeads.map((lead) => {
                    const linkedQuote = getLeadQuote(lead);
                    return (
                    <article
                      className="lead-row clickable"
                      key={lead.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openLeadRecord(lead.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openLeadRecord(lead.id);
                        }
                      }}
                    >
                      <div className="job-identity">
                        <div>
                          <StatusDot tone={lead.status === "Lost" ? "red" : lead.status === "Survey booked" ? "green" : "amber"} />
                          <a href="#" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openLeadRecord(lead.id); }}>
                            {lead.ref}
                          </a>
                          <span>{lead.customerName}</span>
                        </div>
                        <strong>{lead.description}</strong>
                        <small>{lead.address}</small>
                        <small>{lead.phone || "No phone"} · {lead.email || "No email"}</small>
                      </div>
                      <span className="lead-source">{lead.source}</span>
                      <div className="lead-survey-cell">
                        <strong>{lead.surveyor}</strong>
                        <small>{lead.surveyDate && lead.surveyTime ? `${lead.surveyDate} at ${lead.surveyTime}` : "Not booked"}</small>
                      </div>
                      <span className={`status-pill ${lead.status === "Lost" ? "red" : lead.status === "Survey booked" || lead.status === "Quoted" ? "green" : "amber"}`}>
                        {lead.status}
                      </span>
                      <div className="next-action">
                        <strong>{lead.next}</strong>
                        <small>Created by {lead.createdBy} · {lead.createdAt}</small>
                        {lead.status === "Survey booked" && !linkedQuote ? (
                          <button className="secondary-button" type="button" onClick={(event) => { event.stopPropagation(); markLeadQuoted(lead); }}>
                            Create quote
                          </button>
                        ) : null}
                        {linkedQuote ? (
                          <button className="secondary-button" type="button" onClick={(event) => { event.stopPropagation(); openQuoteDrawer(linkedQuote.id); }}>
                            View quote
                          </button>
                        ) : null}
                      </div>
                    </article>
                    );
                  })}
                  </section>

                <aside className="lead-schedule-panel">
                  <div className="panel-header compact">
                    <div>
                      <h2>Survey diary</h2>
                      <p>Booked quote visits from active leads</p>
                    </div>
                    <CalendarDays size={18} />
                  </div>
                  <div className="schedule-list">
                    {scheduledLeadVisits.length === 0 ? (
                      <p className="empty-copy">No lead surveys booked yet.</p>
                    ) : null}
                    {scheduledLeadVisits.map((visit) => (
                      <div className="visit" key={`${visit.time}-${visit.detail}`}>
                        <time>{visit.time}</time>
                        <span className={`visit-line ${visit.tone}`} />
                        <div>
                          <strong>{visit.title}</strong>
                          <small>{visit.detail}</small>
                        </div>
                        <Bell size={15} />
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            </section>
          ) : homeView === "clients" ? (
            <section className="client-directory-panel">
              <div className="panel-header">
                <div>
                  <h2>Clients</h2>
                  <p>Manage customer accounts, site locations, and commercial ownership.</p>
                </div>
                <button className="link-button" onClick={returnToDashboard}>
                  Back to dashboard
                </button>
              </div>

              <div className="client-directory-grid">
                {filteredClients.map((client) => {
                  const siteCount = clientSites.filter((site) => site.clientId === client.id).length;
                  return (
                    <article
                      className="client-directory-card"
                      key={client.id}
                      onClick={() => openClientRecordView(client.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openClientRecordView(client.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <header>
                        <div>
                          <h3>{client.name}</h3>
                          <small>{client.accountReference}</small>
                        </div>
                        <span className={`status-pill ${client.status === "Active" ? "green" : client.status === "Prospect" ? "blue" : "amber"}`}>
                          {client.status}
                        </span>
                      </header>
                      <p>{client.primaryContact}</p>
                      <p className="client-directory-meta">{client.email}</p>
                      <p className="client-directory-meta">{client.phone}</p>
                      <div className="client-directory-stats">
                        <span>{siteCount} sites</span>
                        <span>{client.commercialOwner}</span>
                      </div>
                      <button
                        className="primary-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openClientRecordView(client.id);
                        }}
                      >
                        Open client record
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : homeView === "client-record" ? (
            activeClient ? (
              <section className="client-record-shell">
                <div className="client-record-banner">
                  <div>
                    <span className="employee-record-eyebrow">Client account</span>
                    <h2>{activeClient.name}</h2>
                    <p>{activeClient.primaryContact} · {activeClient.commercialOwner}</p>
                  </div>
                  <div className="client-record-stats">
                    <div>
                      <strong>{activeClientSites.length}</strong>
                      <span>Live sites</span>
                    </div>
                    <div>
                      <strong>{activeClient.status}</strong>
                      <span>Status</span>
                    </div>
                    <div>
                      <strong>{activeClientAudit.length}</strong>
                      <span>History items</span>
                    </div>
                  </div>
                </div>

                <div className="employee-tab-strip" role="tablist" aria-label="Client record sections">
                  {clientTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeClientTab === tab.key}
                      className={activeClientTab === tab.key ? "employee-tab active" : "employee-tab"}
                      onClick={() => {
                        setActiveClientTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <section className="client-record-panel">
                  {activeClientTab === "overview" ? (
                    <div className="client-overview-grid">
                      <article className="client-info-card">
                        <span className="permission-heading">Account details</span>
                        <dl>
                          <div>
                            <dt>Account ref</dt>
                            <dd>{activeClient.accountReference}</dd>
                          </div>
                          <div>
                            <dt>Primary contact</dt>
                            <dd>{activeClient.primaryContact}</dd>
                          </div>
                          <div>
                            <dt>Email</dt>
                            <dd>{activeClient.email}</dd>
                          </div>
                          <div>
                            <dt>Phone</dt>
                            <dd>{activeClient.phone}</dd>
                          </div>
                          <div>
                            <dt>Billing address</dt>
                            <dd>{activeClient.billingAddress}</dd>
                          </div>
                          <div>
                            <dt>Commercial owner</dt>
                            <dd>{activeClient.commercialOwner}</dd>
                          </div>
                        </dl>
                      </article>

                      <article className="client-info-card">
                        <span className="permission-heading">Commercial notes</span>
                        <p>{activeClient.notes}</p>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            logAuditEvent({
                              actor: activeEmployee?.name ?? "Verrova user",
                              action: "updated",
                              recordType: "client",
                              recordId: activeClient.id,
                              summary: `Commercial review logged for ${activeClient.name}.`,
                              source: "web",
                              importance: "normal",
                            });
                            showNotice("Commercial review note logged to history.");
                          }}
                        >
                          Log commercial review
                        </button>
                      </article>
                    </div>
                  ) : null}

                  {activeClientTab === "sites" ? (
                    <div className="client-sites-list">
                      {activeClientSites.map((site) => (
                        <article className="client-site-card" key={site.id}>
                          <header>
                            <div>
                              <h3>{site.name}</h3>
                              <small>{site.serviceLine}</small>
                            </div>
                            <button
                              className="secondary-button"
                              onClick={() => {
                                logAuditEvent({
                                  actor: activeEmployee?.name ?? "Verrova user",
                                  action: "reviewed",
                                  recordType: "site",
                                  recordId: site.id,
                                  summary: `Site record reviewed for ${site.name}.`,
                                  source: "web",
                                  importance: "normal",
                                });
                                showNotice("Site history note added.");
                              }}
                            >
                              Log site check
                            </button>
                          </header>
                          <p>{site.address}</p>
                          <p className="client-directory-meta">Contact: {site.primaryContact}</p>
                          <p className="client-directory-meta">Next visit: {site.nextVisit}</p>
                          <p className="client-directory-meta">Access: {site.accessNotes}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}

                  {activeClientTab === "history" ? (
                    <div className="client-history-list">
                      {activeClientAudit.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No history yet</strong>
                          <span>Changes to this client and its sites will appear here.</span>
                        </div>
                      ) : null}
                      {activeClientAudit.map((event) => (
                        <article className="client-history-item" key={event.id}>
                          <div className="client-history-head">
                            <strong>{event.summary}</strong>
                            <span className={`status-pill ${event.importance === "high" ? "amber" : "blue"}`}>
                              {event.action}
                            </span>
                          </div>
                          <p>
                            {event.actor} · {event.createdAt} · {event.source}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              </section>
            ) : null
          ) : homeView === "employees" ? (
            <section className="employee-directory-panel">
              <div className="panel-header">
                <div>
                  <h2>Employee cards</h2>
                  <p>Select an employee to open their full employee card.</p>
                </div>
                <button className="link-button" onClick={returnToDashboard}>
                  Back to dashboard
                </button>
              </div>

              <div className="employee-directory-grid">
                {employees.map((employee) => (
                  <article
                    className="employee-directory-card"
                    key={employee.id}
                    onClick={() => openEmployeeCardView(employee.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openEmployeeCardView(employee.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <header>
                      <h3>{employee.name}</h3>
                      <small>{employee.role}</small>
                    </header>
                    <p>
                      {employee.profile?.email || "No email on file"}
                      <br />
                      {employee.profile?.phone || "No phone on file"}
                    </p>
                    <p className="employee-directory-meta">
                      Permissions: {Object.keys(employee.permissions ?? {}).length ? "Custom" : "Role defaults"}
                    </p>
                    <p className="employee-directory-meta">
                      Role title: {employee.profile?.roleLabel || "Not set"}
                    </p>
                    <button
                      className="primary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEmployeeCardView(employee.id);
                      }}
                    >
                      Open employee card
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : homeView === "employee-card" ? (
            activeEditingEmployee ? (
              <section className="employee-record-shell">
                <div className="employee-record-banner">
                  <div>
                    <span className="employee-record-eyebrow">Employee card</span>
                    <h2>{employeeProfileDraft.name || activeEditingEmployee.name}</h2>
                    <p>
                      {employeeProfileDraft.roleLabel || activeEditingEmployee.profile?.roleLabel || activeEditingEmployee.role}
                      {" · "}
                      {employeeRoleDraft}
                    </p>
                  </div>
                  <div className="employee-record-stats">
                    <div>
                      <strong>{employeeProfileDraft.documents.length}</strong>
                      <span>Stored files</span>
                    </div>
                    <div>
                      <strong>{employeeProfileDraft.licenses.length}</strong>
                      <span>Licences</span>
                    </div>
                    <div>
                      <strong>{employeeProfileDraft.emergencyContacts.length}</strong>
                      <span>Emergency contacts</span>
                    </div>
                  </div>
                </div>

                <div className="employee-tab-strip" role="tablist" aria-label="Employee record sections">
                  {employeeTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={activeEmployeeTab === tab.key}
                      className={activeEmployeeTab === tab.key ? "employee-tab active" : "employee-tab"}
                      onClick={() => {
                        setActiveEmployeeTab(tab.key);
                        scrollWorkspaceToTop();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <section className="employee-record-panel">
                  {activeEmployeeTab === "details" ? (
                    <div className="form-body employee-page-form two-column-form">
                      <label>
                        Employee name
                        <input
                          value={employeeProfileDraft.name}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, name: event.target.value }))}
                        />
                      </label>
                      <label>
                        Role
                        <select value={employeeRoleDraft} onChange={(event) => setEmployeeRoleDraft(event.target.value as HubRole)}>
                          {roleChoices.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Job title
                        <input
                          value={employeeProfileDraft.roleLabel}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, roleLabel: event.target.value }))}
                        />
                      </label>
                      <label>
                        Start date
                        <input
                          value={employeeProfileDraft.startDate}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, startDate: event.target.value }))}
                        />
                      </label>
                      <label>
                        Email
                        <input
                          value={employeeProfileDraft.email}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, email: event.target.value }))}
                        />
                      </label>
                      <label>
                        Phone
                        <input
                          value={employeeProfileDraft.phone}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, phone: event.target.value }))}
                        />
                      </label>
                      <label className="full-field">
                        Address
                        <input
                          value={employeeProfileDraft.address}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, address: event.target.value }))}
                        />
                      </label>
                      <label>
                        Bank sort code
                        <input
                          value={employeeProfileDraft.bankSortCode}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, bankSortCode: event.target.value }))}
                        />
                      </label>
                      <label>
                        Bank account number
                        <input
                          value={employeeProfileDraft.bankAccountNumber}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, bankAccountNumber: event.target.value }))}
                        />
                      </label>
                    </div>
                  ) : null}

                  {activeEmployeeTab === "licences" ? (
                    <div className="form-body employee-page-form">
                      <div className="employee-section-heading">
                        <span className="permission-heading">Licences and certifications</span>
                        <button className="secondary-button" type="button" onClick={addEmployeeLicense}>
                          Add licence
                        </button>
                      </div>

                      {employeeProfileDraft.licenses.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No licences added yet</strong>
                          <span>Store Gas Safe, IPAF, driving licences, and expiry dates here.</span>
                        </div>
                      ) : null}

                      {employeeProfileDraft.licenses.map((license) => (
                        <div className="employee-repeater full-field" key={license.id}>
                          <label>
                            Licence
                            <input
                              value={license.type}
                              onChange={(event) => updateEmployeeLicense(license.id, { type: event.target.value })}
                            />
                          </label>
                          <label>
                            Reference
                            <input
                              value={license.reference}
                              onChange={(event) => updateEmployeeLicense(license.id, { reference: event.target.value })}
                            />
                          </label>
                          <label>
                            Expires
                            <input
                              value={license.expiresOn}
                              onChange={(event) => updateEmployeeLicense(license.id, { expiresOn: event.target.value })}
                            />
                          </label>
                          <label>
                            Status
                            <input
                              value={license.status}
                              onChange={(event) => updateEmployeeLicense(license.id, { status: event.target.value })}
                            />
                          </label>
                          <div className="full-field employee-license-attachment-block">
                            <span className="permission-heading">Licence attachment</span>
                            {license.attachmentFileName ? (
                              <div className="employee-license-attachment-row">
                                <div className="employee-license-attachment-copy">
                                  <span className="employee-license-attachment-icon">
                                    <FileText size={15} />
                                  </span>
                                  <div>
                                    <strong>{license.attachmentFileName}</strong>
                                    <small>
                                      Attached to this licence
                                      {license.attachmentUploadedAt ? ` · ${license.attachmentUploadedAt}` : ""}
                                    </small>
                                  </div>
                                </div>
                                <div className="employee-license-attachment-actions">
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() =>
                                      showNotice(
                                        `${license.attachmentFileName} preview will open here once file storage is connected.`,
                                      )
                                    }
                                  >
                                    Preview
                                  </button>
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => removeEmployeeLicenseAttachment(license.id)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="employee-license-attachment-empty">
                                <strong>No file attached</strong>
                                <span>Keep the licence file beside this specific licence record.</span>
                              </div>
                            )}
                            <label className="employee-inline-upload">
                              {license.attachmentFileName ? "Replace attachment" : "Upload attachment"}
                              <input type="file" onChange={(event) => addEmployeeLicenseAttachment(license.id, event)} />
                            </label>
                          </div>
                          <button className="secondary-button" type="button" onClick={() => removeEmployeeLicense(license.id)}>
                            Remove licence
                          </button>
                        </div>
                      ))}

                      <div className="employee-section-heading">
                        <span className="permission-heading">Attachments and stored files</span>
                        <button className="secondary-button" type="button" onClick={addManualEmployeeDocument}>
                          Add file row
                        </button>
                      </div>

                      <div className="full-field employee-doc-controls">
                        <input type="file" multiple onChange={addEmployeeDocument} className="file-input" />
                      </div>

                      {employeeProfileDraft.documents.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No files stored yet</strong>
                          <span>Contracts, broader employee records, and general documents can live here.</span>
                        </div>
                      ) : null}

                      {employeeProfileDraft.documents.map((document) => (
                        <div className="employee-repeater full-field" key={document.id}>
                          <label>
                            Label
                            <input
                              value={document.label}
                              onChange={(event) => updateEmployeeDocument(document.id, { label: event.target.value })}
                            />
                          </label>
                          <label>
                            File
                            <input
                              value={document.fileName}
                              onChange={(event) => updateEmployeeDocument(document.id, { fileName: event.target.value })}
                            />
                          </label>
                          <label>
                            Uploaded
                            <input
                              value={document.uploadedAt}
                              onChange={(event) => updateEmployeeDocument(document.id, { uploadedAt: event.target.value })}
                            />
                          </label>
                          <button className="secondary-button" type="button" onClick={() => removeEmployeeDocument(document.id)}>
                            Remove file
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {activeEmployeeTab === "rates" ? (
                    <div className="form-body employee-page-form two-column-form">
                      <div className="full-field">
                        <span className="permission-heading">Payroll and employment cost inputs</span>
                      </div>
                      <label>
                        Hourly rate
                        <div className="money-input">
                          <span>£</span>
                          <input
                            inputMode="decimal"
                            value={employeeProfileDraft.hourlyRate}
                            onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, hourlyRate: event.target.value }))}
                          />
                        </div>
                      </label>
                      <label>
                        Overtime rate
                        <div className="money-input">
                          <span>£</span>
                          <input
                            inputMode="decimal"
                            value={employeeProfileDraft.overtimeRate}
                            onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, overtimeRate: event.target.value }))}
                          />
                        </div>
                      </label>
                      <label>
                        NI multiplier
                        <input
                          inputMode="decimal"
                          value={employeeProfileDraft.niMultiplier}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, niMultiplier: event.target.value }))}
                        />
                      </label>
                      <label>
                        Pension %
                        <input
                          inputMode="decimal"
                          value={employeeProfileDraft.pensionPercent}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, pensionPercent: event.target.value }))}
                        />
                      </label>
                      <label>
                        Daily tool allowance
                        <div className="money-input">
                          <span>£</span>
                          <input
                            inputMode="decimal"
                            value={employeeProfileDraft.dailyToolAllowance}
                            onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, dailyToolAllowance: event.target.value }))}
                          />
                        </div>
                      </label>
                      <label className="full-field">
                        Employment note
                        <input
                          value={employeeProfileDraft.employmentCostNote}
                          onChange={(event) => setEmployeeProfileDraft((current) => ({ ...current, employmentCostNote: event.target.value }))}
                        />
                      </label>
                    </div>
                  ) : null}

                  {activeEmployeeTab === "emergency" ? (
                    <div className="form-body employee-page-form">
                      <div className="employee-section-heading">
                        <span className="permission-heading">Emergency contacts</span>
                        <button className="secondary-button" type="button" onClick={addEmployeeContact}>
                          Add emergency contact
                        </button>
                      </div>

                      {employeeProfileDraft.emergencyContacts.length === 0 ? (
                        <div className="employee-empty-panel">
                          <strong>No emergency contacts added yet</strong>
                          <span>Add next of kin and emergency numbers here for quick access.</span>
                        </div>
                      ) : null}

                      {employeeProfileDraft.emergencyContacts.map((contact) => (
                        <div className="employee-repeater full-field" key={contact.id}>
                          <label>
                            Name
                            <input
                              value={contact.name}
                              onChange={(event) => updateEmployeeContact(contact.id, { name: event.target.value })}
                            />
                          </label>
                          <label>
                            Relationship
                            <input
                              value={contact.relationship}
                              onChange={(event) => updateEmployeeContact(contact.id, { relationship: event.target.value })}
                            />
                          </label>
                          <label>
                            Phone
                            <input
                              value={contact.phone}
                              onChange={(event) => updateEmployeeContact(contact.id, { phone: event.target.value })}
                            />
                          </label>
                          <button className="secondary-button" type="button" onClick={() => removeEmployeeContact(contact.id)}>
                            Remove contact
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {activeEmployeeTab === "availability" ? (
                    <div className="form-body employee-page-form">
                      <div className="employee-section-heading">
                        <span className="permission-heading">Weekly availability for scheduling</span>
                      </div>
                      <div className="full-field employee-availability-list">
                        {weekDays.map((day) => {
                          const schedule = employeeProfileDraft.availability[day];
                          return (
                            <label className="employee-availability-item" key={day}>
                              <span>{day}</span>
                              <input
                                type="checkbox"
                                checked={schedule.active}
                                onChange={(event) => updateEmployeeAvailability(day, { active: event.target.checked })}
                              />
                              <input
                                type="time"
                                value={schedule.from}
                                onChange={(event) => updateEmployeeAvailability(day, { from: event.target.value })}
                              />
                              <input
                                type="time"
                                value={schedule.to}
                                onChange={(event) => updateEmployeeAvailability(day, { to: event.target.value })}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {activeEmployeeTab === "permissions" ? (
                    <div className="form-body employee-page-form">
                      <div className="employee-section-heading">
                        <span className="permission-heading">Permission controls</span>
                        <span className="employee-access-note">
                          Configure what this employee can see and change inside Verrova.
                        </span>
                      </div>
                      <div className="employee-permissions-grid">
                        {permissionOptions.map((permission) => (
                          <label className="permission-row" key={permission.key}>
                            <input
                              type="checkbox"
                              checked={employeeAccessForEditor[permission.key]}
                              onChange={() => toggleEmployeePermission(permission.key)}
                            />
                            <span>{permission.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>

                <div className="form-footer employee-page-footer">
                  <button className="secondary-button" onClick={resetEmployeeDraft}>
                    Discard changes
                  </button>
                  <button className="secondary-button" onClick={returnToEmployeeDirectory}>
                    Back to employees
                  </button>
                  <button className="primary-button" onClick={saveEmployeeDetails}>
                    Save employee details
                  </button>
                </div>
              </section>
            ) : null
          ) : (
            <>
              <section className="metric-strip" aria-label="Business metrics">
                {metrics.map((metric) => (
                  <article className="metric" key={metric.label}>
                    <div className="metric-topline">
                      <span>{metric.label}</span>
                      <StatusDot tone={metric.tone} />
                    </div>
                    <strong>{metric.value}</strong>
                    <div className="metric-detail">
                      <span>{metric.detail}</span>
                      <b className={metric.tone}>{metric.trend}</b>
                    </div>
                  </article>
                ))}
              </section>

              <section className="workflow-board" aria-label="Workflow queues">
                <div className="panel-header">
                  <div>
                    <h2>Workflow queues</h2>
                    <p>One place for quotes, scheduling, delivery and finance status</p>
                  </div>
                  <button className="link-button" onClick={() => showNotice("Workflow filters will expand next.")}>
                    Clear filter
                  </button>
                </div>
                <div className="queue-grid">
                  {workflowBuckets.map((bucket) => (
                    <button key={bucket.key} className={`queue-card ${bucket.tone}`} onClick={() => showNotice(`${bucket.label} view is next to wire up.`)}>
                      <span className="queue-card-top">
                        <strong>{bucket.label}</strong>
                        <StatusDot tone={bucket.tone} />
                      </span>
                      <strong className="queue-count">{bucket.count}</strong>
                      <span>{bucket.detail}</span>
                    </button>
                  ))}
                </div>
              </section>

              {access.showQuotes ? (
                <section className="quote-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Quote pipeline</h2>
                      <p>Draft / sent / accepted and action-ready</p>
                    </div>
                    <label className="status-filter">
                      <select value={quoteStatusFilter} onChange={(event) => setQuoteStatusFilter(event.target.value)} aria-label="Filter quotes by status">
                        <option>All quotes</option>
                        {quoteStatuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="quote-row table-header">
                    <span>Quote / customer</span>
                    <span>Site</span>
                    <span>Owner</span>
                    <span>Status</span>
                    <span>Value</span>
                    <span>Workflow</span>
                  </div>
                  {filteredQuotes.map((quote) => {
                    const site = clientSites.find((item) => item.id === quote.siteId);
                    const linkedInvoice = invoiceSourceMap.byQuote.get(quote.id) ?? null;
                    const linkedJob = getQuoteJob(quote);
                    return (
                      <div
                        className="quote-row clickable"
                        key={quote.ref}
                        role="button"
                        tabIndex={0}
                        onClick={() => openQuoteDrawer(quote.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openQuoteDrawer(quote.id);
                          }
                        }}
                      >
                        <div className="job-identity">
                          <div>
                            <StatusDot tone={quote.status === "Accepted" || quote.status === "Converted" ? "green" : quote.status === "Declined" ? "red" : "blue"} />
                            <a href="#" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openQuoteDrawer(quote.id); }}>
                              {quote.ref}
                            </a>
                            <span>{quote.customer}</span>
                          </div>
                          <strong>{quote.description}</strong>
                        </div>
                        <span className="quote-site">{site?.name ?? "Site to confirm"}</span>
                        <span className="manager">{quote.owner}</span>
                        <span className={`status-pill ${quote.status === "Declined" ? "red" : quote.status === "Accepted" || quote.status === "Converted" ? "green" : "blue"}`}>
                          {quote.status}
                        </span>
                        <strong className="value">{currency(quote.value)}</strong>
                        <span className="next-action quote-workflow-action">
                          <strong>{quote.convertedJobRef ?? quote.next}</strong>
                          <small>{quote.convertedJobRef ? "Linked job" : quote.due}</small>
                          {linkedJob ? (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openJobDrawer(linkedJob.id);
                              }}
                            >
                              Open linked job
                            </button>
                          ) : null}
                          {linkedInvoice ? (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openInvoiceRecord(linkedInvoice.id);
                              }}
                            >
                              Open invoice
                            </button>
                          ) : quote.status === "Accepted" || quote.status === "Converted" ? (
                            <button
                              className="primary-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openInvoiceForQuote(quote);
                              }}
                            >
                              Create invoice
                            </button>
                          ) : null}
                          {quote.status === "Accepted" && !quote.convertedJobId && access.canCreateJob ? (
                            <button className="secondary-button" type="button" onClick={(event) => { event.stopPropagation(); convertQuoteToJob(quote); }}>
                              Convert to job
                            </button>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </section>
              ) : null}

              <div className="dashboard-grid">
                <section className="work-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Jobs requiring attention</h2>
                      <p>Prioritised by operational risk and due date</p>
                    </div>
                    <div className="panel-controls">
                      <label className="status-filter">
                        <SlidersHorizontal size={14} />
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter jobs by status">
                          <option>All statuses</option>
                          {jobStatuses.map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </label>
                      <button className="link-button" onClick={() => showNotice("Jobs list reflects the current search and status filter.")}>
                        {filteredJobs.length} jobs <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="job-table" role="table" aria-label="Jobs requiring attention">
                    <div className="job-row table-header" role="row">
                      <span>Job / customer</span>
                      <span>Manager</span>
                      <span>Status</span>
                      {access.showFinance ? <span>Value</span> : null}
                      <span>Next action</span>
                      <span />
                    </div>
                    {filteredJobs.map((job) => {
                      const linkedInvoice = invoiceSourceMap.byJob.get(job.id) ?? null;
                      return (
                      <div
                        className="job-row clickable"
                        role="row"
                        key={job.ref}
                        tabIndex={0}
                        onClick={() => openJobDrawer(job.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openJobDrawer(job.id);
                          }
                        }}
                      >
                        <div className="job-identity">
                          <div>
                            <StatusDot tone={job.health} />
                            <a href="#" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openJobDrawer(job.id); }}>
                              {job.ref}
                            </a>
                            <span>{job.customer}</span>
                          </div>
                          <strong>{job.description}</strong>
                          <small>{job.site}</small>
                        </div>
                        <span className="manager">{job.manager}</span>
                        <span className={`status-pill ${job.health}`}>{job.status}</span>
                        {access.showFinance ? <strong className="value">{currency(job.value)}</strong> : null}
                        <div className="next-action">
                          <strong>{job.next}</strong>
                          <small>{job.due}</small>
                          {linkedInvoice ? (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openInvoiceRecord(linkedInvoice.id);
                              }}
                            >
                              Open invoice
                            </button>
                          ) : null}
                        </div>
                        <button className="row-menu" aria-label={`Open ${job.ref}`} onClick={(event) => { event.stopPropagation(); openJobDrawer(job.id); }}>
                          <ChevronRight size={17} />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                </section>

                <aside className="right-column">
                  <section className="side-panel office-exceptions-panel">
                    <div className="panel-header compact">
                      <div>
                        <h2>Office exceptions</h2>
                        <p>{officeAlerts.length} alerts · {highPriorityOfficeAlerts} high priority</p>
                      </div>
                      <a className="calendar-button" aria-label="Open office alerts" href="/office/alerts">
                        <Bell size={17} />
                      </a>
                    </div>
                    <div className="office-exception-list">
                      {officeExceptionCards.map((item) => (
                        <a className={`office-exception-card ${item.tone}`} href={item.href} key={item.label}>
                          <span>{item.label}</span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </a>
                      ))}
                    </div>
                    <div className="office-exception-actions">
                      <a href="/office/alerts">Open alerts queue</a>
                      <a href="/engineer">Engineer view</a>
                    </div>
                  </section>

                  <section className="side-panel schedule-panel">
                    <div className="panel-header compact">
                      <div>
                        <h2>Today&apos;s schedule</h2>
                        <p>8 visits · 6 engineers</p>
                      </div>
                      <button className="calendar-button" aria-label="Open schedule" onClick={() => setHomeView("schedule")}>
                        <CalendarDays size={17} />
                      </button>
                    </div>
                    <div className="schedule-list">
                      {scheduleVisits.map((visit) => (
                        <div className="visit" key={`${visit.time}-${visit.title}`}>
                          <time>{visit.time}</time>
                          <span className={`visit-line ${visit.tone}`} />
                          <div>
                            <strong>{visit.title}</strong>
                            <small>{visit.detail}</small>
                          </div>
                          <ChevronRight size={15} />
                        </div>
                      ))}
                    </div>
                    <button className="full-width-link" onClick={() => setHomeView("schedule")}>
                      Open scheduler
                    </button>
                  </section>

                  {access.canApprovePurchase ? (
                    <section className="side-panel po-approvals">
                      <div className="panel-header compact">
                        <div>
                          <h2>PO approvals</h2>
                          <p>{pendingPORequests.length} waiting for office action</p>
                        </div>
                        <button className="calendar-button" aria-label="Refresh PO list" onClick={() => showNotice("PO queue refreshed.")}>
                          <ClipboardCheck size={17} />
                        </button>
                      </div>
                      <div className="po-list">
                        {pendingPORequests.map((request) => (
                          <div className="po-item" key={request.id}>
                            <div>
                              <strong>{request.jobRef}</strong>
                              <small>{request.supplier} · {request.createdAt}</small>
                              <span>{request.item}</span>
                            </div>
                            <div className="po-item-actions">
                              <span className="status-pill amber">{request.status}</span>
                              <div className="po-action-buttons">
                                <button className="secondary-button" onClick={() => markPurchaseRequestStatus(request.id, "Rejected")}>
                                  Reject
                                </button>
                                <button className="primary-button" onClick={() => markPurchaseRequestStatus(request.id, "Approved")}>
                                  Approve
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {pendingPORequests.length === 0 ? (
                          <div className="empty-state">
                            <CircleDollarSign size={20} />
                            <strong>No pending approvals</strong>
                            <span>PO requests are already being processed.</span>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {access.canEditInvoice ? (
                    <section className="side-panel gate-panel">
                      <div className="panel-header compact">
                        <div>
                          <h2>Invoice control</h2>
                          <p>J-1048 · Hopetoun Court</p>
                        </div>
                        <span className="blocked-badge">Blocked</span>
                      </div>
                      <div className="gate-progress">
                        <div>
                          <strong>{invoiceReadiness.completedChecks}</strong>
                          <span>of {invoiceReadiness.totalChecks} checks passed</span>
                        </div>
                        <div className="progress">
                          <span style={{ width: `${(invoiceReadiness.completedChecks / invoiceReadiness.totalChecks) * 100}%` }} />
                        </div>
                      </div>
                      <div className="gate-reasons">
                        {invoiceReadiness.reasons.slice(0, 3).map((reason) => (
                          <div key={reason.code}>
                            <AlertTriangle size={15} />
                            <span>
                              <strong>{reason.title}</strong>
                              <small>{reason.detail}</small>
                            </span>
                          </div>
                        ))}
                      </div>
                      <button className="full-width-link" onClick={() => showNotice("Invoice gate panel is in progress.")}>
                        Review invoice gate
                      </button>
                    </section>
                  ) : null}
                </aside>
              </div>

              <section className="activity-band">
                <div className="activity-heading">
                  <h2>Live activity</h2>
                  <span>Updated now</span>
                </div>
                <div className="activity-item">
                  <span className="activity-icon blue">
                    <Wrench size={15} />
                  </span>
                  <p>
                    <strong>Engineer arrived on site</strong>
                    <span>Scott M. started J-1052 at Queen&apos;s Road</span>
                  </p>
                  <time>14 min ago</time>
                </div>
                <div className="activity-item">
                  <span className="activity-icon green">
                    <Check size={15} />
                  </span>
                  <p>
                    <strong>Timesheet submitted</strong>
                    <span>7.5 hours posted against J-1041</span>
                  </p>
                  <time>26 min ago</time>
                </div>
                <div className="activity-item">
                  <span className="activity-icon amber">
                    <AlertTriangle size={15} />
                  </span>
                  <p>
                    <strong>Variation needs review</strong>
                    <span>Additional pipework recorded on J-1056</span>
                  </p>
                  <time>32 min ago</time>
                </div>
                <div className="activity-item">
                  <span className="activity-icon charcoal">
                    <Building2 size={15} />
                  </span>
                  <p>
                    <strong>Customer updated</strong>
                    <span>Northfield Properties notified of parts delay</span>
                  </p>
                  <time>48 min ago</time>
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      {oneOffMaterialCentreId ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal one-off-material-modal" role="dialog" aria-modal="true" aria-labelledby="one-off-material-title">
            <div className="form-header">
              <div>
                <span>One-off item</span>
                <h2 id="one-off-material-title">Create one-off material</h2>
              </div>
              <button
                aria-label="Close one-off material"
                onClick={() => {
                  setOneOffMaterialCentreId(null);
                  setOneOffMaterialDraft(blankOneOffMaterialDraft);
                }}
              >
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="one-off-material-body">
              <label className="one-off-material-description">
                Description
                <textarea
                  autoFocus
                  value={oneOffMaterialDraft.description}
                  onChange={(event) => setOneOffMaterialDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Describe the material, radiator, fitting, skip, sundry item or allowance clearly..."
                />
              </label>
              <div className="one-off-material-grid">
                <label>
                  Cost price
                  <input
                    inputMode="decimal"
                    placeholder="TBC"
                    value={oneOffMaterialDraft.unitCost}
                    onChange={(event) => {
                      const unitCost = event.target.value;
                      const markupPercent = Number(oneOffMaterialDraft.markupPercent) || 0;
                      setOneOffMaterialDraft((current) => ({
                        ...current,
                        unitCost,
                        unitSell: unitCost ? String(Math.round(lineSellFromMarkup(Number(unitCost) || 0, markupPercent) * 100) / 100) : current.unitSell,
                      }));
                    }}
                  />
                </label>
                <label>
                  Markup %
                  <input
                    inputMode="decimal"
                    value={oneOffMaterialDraft.markupPercent}
                    onChange={(event) => {
                      const markupPercent = event.target.value;
                      const unitCost = Number(oneOffMaterialDraft.unitCost) || 0;
                      setOneOffMaterialDraft((current) => ({
                        ...current,
                        markupPercent,
                        unitSell: unitCost > 0 ? String(Math.round(lineSellFromMarkup(unitCost, Number(markupPercent) || 0) * 100) / 100) : current.unitSell,
                      }));
                    }}
                  />
                </label>
                <label>
                  Sell price
                  <input
                    inputMode="decimal"
                    placeholder="TBC"
                    value={oneOffMaterialDraft.unitSell}
                    onChange={(event) => setOneOffMaterialDraft((current) => ({ ...current, unitSell: event.target.value }))}
                  />
                </label>
                <label>
                  Qty
                  <input
                    inputMode="decimal"
                    value={oneOffMaterialDraft.quantity}
                    onChange={(event) => setOneOffMaterialDraft((current) => ({ ...current, quantity: event.target.value }))}
                  />
                </label>
              </div>
            </div>
            <div className="form-footer">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setOneOffMaterialCentreId(null);
                  setOneOffMaterialDraft(blankOneOffMaterialDraft);
                }}
              >
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={saveOneOffMaterialModal}>
                Add item
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {catalogueFolderModalCentreId ? (
        (() => {
          const centre = selectedQuoteCostCentres.find((item) => item.id === catalogueFolderModalCentreId) ?? null;
          if (!centre) return null;
          const lines = selectedQuoteMaterialLinesForCentre(centre);

          return (
            <div className="modal-backdrop" role="presentation">
              <section className="modal catalog-folder-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-folder-title">
                <div className="form-header">
                  <div>
                    <span>Catalogue</span>
                    <h2 id="catalog-folder-title">Choose folders for selected items</h2>
                  </div>
                  <button aria-label="Close catalogue folder chooser" onClick={() => setCatalogueFolderModalCentreId(null)}>
                    <ChevronRight size={19} />
                  </button>
                </div>
                <div className="catalog-folder-modal-body">
                  <p>Each selected item must be saved into a catalogue group so the catalogue stays tidy.</p>
                  <div className="catalog-folder-assignment-head">
                    <span>Item</span>
                    <span>Catalogue folder</span>
                  </div>
                  {lines.map((line) => (
                    <div className="catalog-folder-assignment-row" key={line.id}>
                      <div>
                        <strong>{line.description || "Untitled item"}</strong>
                        <span>{line.quantity.toFixed(2)} item(s) · {line.unitCost > 0 ? currency(line.unitCost) : "Cost TBC"}</span>
                      </div>
                      <select
                        value={catalogueFolderDrafts[line.id] ?? inferCatalogFolder({ name: line.description, type: "Material", category: undefined })}
                        onChange={(event) =>
                          setCatalogueFolderDrafts((current) => ({
                            ...current,
                            [line.id]: event.target.value,
                          }))
                        }
                      >
                        {quoteCatalogFolders.map((folder) => (
                          <option key={folder} value={folder}>{folder}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="form-footer">
                  <button className="secondary-button" type="button" onClick={() => setCatalogueFolderModalCentreId(null)}>
                    Cancel
                  </button>
                  <button className="primary-button" type="button" onClick={() => saveSelectedQuoteLinesToCatalog(centre)}>
                    Save to catalogue
                  </button>
                </div>
              </section>
            </div>
          );
        })()
      ) : null}

      {showCreateLead ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal lead-modal" role="dialog" aria-modal="true" aria-labelledby="create-lead-title">
            <div className="form-header">
              <div>
                <span>Leads</span>
                <h2 id="create-lead-title">Create new lead</h2>
              </div>
              <button aria-label="Close create lead" onClick={() => setShowCreateLead(false)}>
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="form-body two-column-form">
              <div className="full-field lead-match-block">
                <label>
                  Customer name
                  <input
                    value={newLead.customerName}
                    onChange={(event) =>
                      setNewLead((current) => ({
                        ...current,
                        customerMode: "new",
                        clientId: undefined,
                        siteId: undefined,
                        customerName: event.target.value,
                      }))
                    }
                    placeholder="Start typing to search existing customers..."
                  />
                </label>
                {newLead.clientId ? (
                  <div className="lead-match-selected">
                    <Check size={15} />
                    <span>
                      Existing customer selected: <strong>{newLead.customerName}</strong>
                    </span>
                    <button type="button" onClick={clearLeadCustomerMatch}>
                      Clear
                    </button>
                  </div>
                ) : leadCustomerMatches.length > 0 ? (
                  <div className="lead-match-list" aria-label="Existing customer matches">
                    {leadCustomerMatches.map((match) => (
                      <button type="button" key={match.client.id} onClick={() => setLeadExistingClient(match.client.id)}>
                        <strong>{match.client.name}</strong>
                        <span>
                          {match.client.primaryContact} · {match.client.phone} · {match.client.billingAddress}
                        </span>
                        <small>{match.matchReason || "matched by customer details"}</small>
                      </button>
                    ))}
                  </div>
                ) : newLead.customerName.trim().length >= 2 ? (
                  <p className="lead-match-empty">No existing customer found. This will be saved as a new customer lead.</p>
                ) : null}
              </div>
              {newLead.clientId ? (
                <label className="full-field">
                  Existing site
                  <select value={newLead.siteId ?? ""} onChange={(event) => setLeadExistingSite(event.target.value)}>
                    {leadClientSites.length === 0 ? <option value="">No sites saved</option> : null}
                    {leadClientSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} - {site.address}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Source
                <select value={newLead.source} onChange={(event) => setNewLead((current) => ({ ...current, source: event.target.value as LeadSource }))}>
                  {leadSources.map((source) => (
                    <option key={source}>{source}</option>
                  ))}
                </select>
              </label>
              <label>
                Created by
                <input value={newLead.createdBy} onChange={(event) => setNewLead((current) => ({ ...current, createdBy: event.target.value }))} />
              </label>
              <label>
                Phone
                <input value={newLead.phone} onChange={(event) => setNewLead((current) => ({ ...current, phone: event.target.value }))} />
              </label>
              <label>
                Email
                <input value={newLead.email} onChange={(event) => setNewLead((current) => ({ ...current, email: event.target.value }))} />
              </label>
              <label>
                Status
                <select value={newLead.status} onChange={(event) => setNewLead((current) => ({ ...current, status: event.target.value as LeadStatus }))}>
                  {leadStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <div className="full-field lead-address-lookup">
                <label>
                  Postcode lookup
                  <input value={leadPostcodeSearch} onChange={(event) => setLeadPostcodeSearch(event.target.value)} placeholder="Type postcode, e.g. AB15 4EQ" />
                </label>
                {leadAddressMatches.length > 0 ? (
                  <div className="lead-address-results" aria-label="Address matches">
                    {leadAddressMatches.map((match) => (
                      <button type="button" key={match.address} onClick={() => selectLeadAddress(match.address, match.postcode)}>
                        {match.address}
                      </button>
                    ))}
                  </div>
                ) : leadPostcodeSearch.trim().length >= 3 ? (
                  <p className="lead-match-empty">No address match in the demo lookup. Type the address manually below.</p>
                ) : null}
              </div>
              <div className="full-field lead-address-map-grid">
                <label>
                  Address
                  <input
                    value={newLead.address}
                    onChange={(event) => setNewLead((current) => ({ ...current, address: event.target.value }))}
                  />
                </label>
                <div className="lead-map-preview" aria-label="Selected address map preview">
                  {newLead.address ? (
                    <>
                      <iframe
                        title="Lead map preview"
                        src={leadMapEmbedUrl(newLead.address)}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        allowFullScreen
                      />
                      <a
                        href={leadMapSearchUrl(newLead.address)}
                        target="_blank"
                        rel="noreferrer"
                        className="lead-map-link"
                      >
                        Open in maps
                      </a>
                    </>
                  ) : (
                    <>
                      <MapPin size={22} />
                      <strong>Select an address</strong>
                      <span>Postcode lookup will place the lead here</span>
                    </>
                  )}
                </div>
              </div>
              <label className="full-field">
                Description of work
                <textarea value={newLead.description} onChange={(event) => setNewLead((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                Survey date
                <input type="date" value={newLead.surveyDate} onChange={(event) => setNewLead((current) => ({ ...current, surveyDate: event.target.value }))} />
              </label>
              <label>
                Survey time
                <input type="time" value={newLead.surveyTime} onChange={(event) => setNewLead((current) => ({ ...current, surveyTime: event.target.value }))} />
              </label>
              <label className="full-field">
                Assign surveyor
                <select value={newLead.surveyor} onChange={(event) => setNewLead((current) => ({ ...current, surveyor: event.target.value }))}>
                  {surveyorOptions.map((surveyor) => (
                    <option key={surveyor}>{surveyor}</option>
                  ))}
                </select>
              </label>
              <div className="full-field lead-availability-panel">
                <span className="permission-heading">Availability on {newLead.surveyDate || "selected date"}</span>
                <div>
                  {surveyorOptions.map((surveyor) => {
                    const availability = availabilityForDate(surveyor, newLead.surveyDate);
                    const bookedCount = leadSurveyBookings.filter((booking) => booking.surveyor === surveyor && booking.date === newLead.surveyDate).length;
                    return (
                      <button
                        type="button"
                        key={surveyor}
                        className={newLead.surveyor === surveyor ? "active" : ""}
                        onClick={() => setNewLead((current) => ({ ...current, surveyor }))}
                      >
                        <strong>{surveyor}</strong>
                        <span>{availabilityLabel(surveyor, newLead.surveyDate)}</span>
                        <small>{bookedCount} booked</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              {newLeadScheduleWarning ? (
                <div className="full-field lead-clash-alert">
                  <AlertTriangle size={16} />
                  <span>{newLeadScheduleWarning}</span>
                </div>
              ) : null}
            </div>
            <div className="form-footer">
              <button className="secondary-button" onClick={() => setShowCreateLead(false)}>
                Cancel
              </button>
              <button className="primary-button" disabled={Boolean(newLeadScheduleWarning)} onClick={submitLead}>
                <Bell size={16} />
                Save lead and notify
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showCreateQuote ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-quote-title">
            <div className="form-header">
              <div>
                <span>Quotes</span>
                <h2 id="create-quote-title">Create new quote</h2>
              </div>
              <button aria-label="Close create quote" onClick={() => setShowCreateQuote(false)}>
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="form-body two-column-form">
              <div className="full-field lead-match-block">
                <label>
                  Customer
                  <input
                    value={newQuote.customer}
                    onChange={(event) =>
                      setNewQuote((current) => ({
                        ...current,
                        clientId: "",
                        siteId: "",
                        customer: event.target.value,
                      }))
                    }
                    placeholder="Start typing to search existing customers..."
                  />
                </label>
                {newQuote.clientId ? (
                  <div className="lead-match-selected">
                    <Check size={15} />
                    <span>
                      Existing customer selected: <strong>{newQuote.customer}</strong>
                    </span>
                    <button type="button" onClick={clearQuoteCustomerMatch}>
                      Clear
                    </button>
                  </div>
                ) : quoteCustomerMatches.length > 0 ? (
                  <div className="lead-match-list" aria-label="Existing customer matches for quote">
                    {quoteCustomerMatches.map((match) => (
                      <button type="button" key={match.client.id} onClick={() => setQuoteExistingClient(match.client.id)}>
                        <strong>{match.client.name}</strong>
                        <span>
                          {match.client.primaryContact} · {match.client.phone} · {match.client.billingAddress}
                        </span>
                        <small>{match.matchReason || "matched by customer details"}</small>
                      </button>
                    ))}
                  </div>
                ) : newQuote.customer.trim().length >= 2 ? (
                  <p className="lead-match-empty">No existing customer found. This quote can save a new customer record.</p>
                ) : null}
              </div>
              {!newQuote.clientId && newQuote.customer.trim().length >= 2 ? (
                <div className="full-field quick-customer-fields">
                  <span className="permission-heading">New customer details</span>
                  <label>
                    Phone
                    <input value={newQuote.phone} onChange={(event) => setNewQuote((current) => ({ ...current, phone: event.target.value }))} />
                  </label>
                  <label>
                    Email
                    <input value={newQuote.email} onChange={(event) => setNewQuote((current) => ({ ...current, email: event.target.value }))} />
                  </label>
                  <label className="full-field">
                    Site address
                    <input value={newQuote.address} onChange={(event) => setNewQuote((current) => ({ ...current, address: event.target.value }))} />
                  </label>
                </div>
              ) : null}
              {newQuote.clientId ? (
                <label className="full-field">
                  Site
                  <select value={newQuote.siteId} onChange={(event) => setQuoteExistingSite(event.target.value)}>
                    {quoteClientSites.length === 0 ? <option value="">No sites saved</option> : null}
                    {quoteClientSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} - {site.address}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Owner
                <select value={newQuote.owner} onChange={(event) => setNewQuote((current) => ({ ...current, owner: event.target.value }))}>
                  <option>Errol Watson</option>
                  <option>Kerry Watson</option>
                </select>
              </label>
              <label className="full-field">
                Description
                <input value={newQuote.description} onChange={(event) => setNewQuote((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                Status
                <select value={newQuote.status} onChange={(event) => setNewQuote((current) => ({ ...current, status: event.target.value as QuoteStatus }))}>
                  {quoteStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Quote value
                <div className="money-input">
                  <span>£</span>
                  <input value={newQuote.value} onChange={(event) => setNewQuote((current) => ({ ...current, value: event.target.value }))} />
                </div>
              </label>
              <label>
                Due
                <input value={newQuote.due} onChange={(event) => setNewQuote((current) => ({ ...current, due: event.target.value }))} />
              </label>
              <label className="full-field">
                Next action
                <input value={newQuote.next} onChange={(event) => setNewQuote((current) => ({ ...current, next: event.target.value }))} />
              </label>
            </div>
            <div className="form-footer">
              <button className="secondary-button" onClick={() => setShowCreateQuote(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={submitQuote}>
                <Plus size={16} />
                Create quote
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showCreateJob ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-job-title">
            <div className="form-header">
              <div>
                <span>Jobs</span>
                <h2 id="create-job-title">Create new job</h2>
              </div>
              <button aria-label="Close create job" onClick={() => setShowCreateJob(false)}>
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="form-body two-column-form">
              <div className="full-field lead-match-block">
                <label>
                  Customer
                  <input
                    value={newJob.customer}
                    onChange={(event) =>
                      setNewJob((current) => ({
                        ...current,
                        clientId: "",
                        siteId: "",
                        site: "",
                        customer: event.target.value,
                      }))
                    }
                    placeholder="Start typing to search existing customers..."
                  />
                </label>
                {newJob.clientId ? (
                  <div className="lead-match-selected">
                    <Check size={15} />
                    <span>
                      Existing customer selected: <strong>{newJob.customer}</strong>
                    </span>
                    <button type="button" onClick={clearJobCustomerMatch}>
                      Clear
                    </button>
                  </div>
                ) : jobCustomerMatches.length > 0 ? (
                  <div className="lead-match-list" aria-label="Existing customer matches for job">
                    {jobCustomerMatches.map((match) => (
                      <button type="button" key={match.client.id} onClick={() => setJobExistingClient(match.client.id)}>
                        <strong>{match.client.name}</strong>
                        <span>
                          {match.client.primaryContact} · {match.client.phone} · {match.client.billingAddress}
                        </span>
                        <small>{match.matchReason || "matched by customer details"}</small>
                      </button>
                    ))}
                  </div>
                ) : newJob.customer.trim().length >= 2 ? (
                  <p className="lead-match-empty">No existing customer found. This job can save a new customer record.</p>
                ) : null}
              </div>
              {!newJob.clientId && newJob.customer.trim().length >= 2 ? (
                <div className="full-field quick-customer-fields">
                  <span className="permission-heading">New customer details</span>
                  <label>
                    Phone
                    <input value={newJob.phone} onChange={(event) => setNewJob((current) => ({ ...current, phone: event.target.value }))} />
                  </label>
                  <label>
                    Email
                    <input value={newJob.email} onChange={(event) => setNewJob((current) => ({ ...current, email: event.target.value }))} />
                  </label>
                  <label className="full-field">
                    Site address
                    <input value={newJob.address} onChange={(event) => setNewJob((current) => ({ ...current, address: event.target.value }))} />
                  </label>
                </div>
              ) : null}
              {newJob.clientId ? (
                <label className="full-field">
                  Site
                  <select value={newJob.siteId} onChange={(event) => setJobExistingSite(event.target.value)}>
                    {jobClientSites.length === 0 ? <option value="">No sites saved</option> : null}
                    {jobClientSites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name} - {site.address}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="full-field">
                Description
                <input value={newJob.description} onChange={(event) => setNewJob((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <label>
                Manager
                <select value={newJob.manager} onChange={(event) => setNewJob((current) => ({ ...current, manager: event.target.value }))}>
                  {surveyorOptions.map((manager) => (
                    <option key={manager}>{manager}</option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={newJob.status} onChange={(event) => setNewJob((current) => ({ ...current, status: event.target.value }))}>
                  {jobStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Scheduled date
                <input
                  type="date"
                  value={newJob.scheduledDate}
                  onChange={(event) => setNewJob((current) => ({ ...current, scheduledDate: event.target.value }))}
                />
              </label>
              <label>
                Scheduled time
                <input
                  type="time"
                  value={newJob.scheduledTime}
                  onChange={(event) => setNewJob((current) => ({ ...current, scheduledTime: event.target.value }))}
                />
              </label>
              <label>
                Job value
                <div className="money-input">
                  <span>£</span>
                  <input value={newJob.value} onChange={(event) => setNewJob((current) => ({ ...current, value: event.target.value }))} />
                </div>
              </label>
              <label>
                Due
                <input value={newJob.due} onChange={(event) => setNewJob((current) => ({ ...current, due: event.target.value }))} />
              </label>
              <label className="full-field">
                Next action
                <input value={newJob.next} onChange={(event) => setNewJob((current) => ({ ...current, next: event.target.value }))} />
              </label>
            </div>
            {newJobScheduleWarning ? (
              <p className="warning-message">
                <AlertTriangle size={15} /> {newJobScheduleWarning}
              </p>
            ) : null}
            <div className="form-footer">
              <button className="secondary-button" onClick={() => setShowCreateJob(false)}>
                Cancel
              </button>
              <button className="primary-button" disabled={Boolean(newJobScheduleWarning)} onClick={createJob}>
                <Plus size={16} />
                Create job
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showPurchaseForm ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-po-title">
            <div className="form-header">
              <div>
                <span>Purchase orders</span>
                <h2 id="create-po-title">Request purchase order</h2>
              </div>
              <button aria-label="Close purchase request" onClick={() => setShowPurchaseForm(false)}>
                <ChevronRight size={19} />
              </button>
            </div>
            <div className="form-body two-column-form">
              <label>
                Supplier
                <input value={purchaseDraft.supplier} onChange={(event) => setPurchaseDraft((current) => ({ ...current, supplier: event.target.value }))} />
              </label>
              <label>
                Estimated cost
                <div className="money-input">
                  <span>£</span>
                  <input value={purchaseDraft.estimatedCost} onChange={(event) => setPurchaseDraft((current) => ({ ...current, estimatedCost: event.target.value }))} />
                </div>
              </label>
              <label className="full-field">
                Item
                <input value={purchaseDraft.item} onChange={(event) => setPurchaseDraft((current) => ({ ...current, item: event.target.value }))} />
              </label>
              <label className="full-field">
                Reason
                <input value={purchaseDraft.reason} onChange={(event) => setPurchaseDraft((current) => ({ ...current, reason: event.target.value }))} />
              </label>
            </div>
            <div className="form-footer">
              <button className="secondary-button" onClick={() => setShowPurchaseForm(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={createPurchaseRequest}>
                <Plus size={16} />
                Send request
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

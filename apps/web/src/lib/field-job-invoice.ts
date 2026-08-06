import { appendAuditEvent, getClients, getClientSites } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { numberedReference, type NumberingSettingsLike } from "@/lib/numbering";
import { getJobs } from "@/lib/workflow-data";

type HubInvoice = {
  id?: string;
  ref?: string;
  status?: string;
  sourceType?: string;
  sourceId?: string;
  chargeTotal?: number;
  claimType?: string;
  valuationLines?: Array<{ agreedThisPeriod?: number; requestedThisPeriod?: number }>;
};

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function numericSetting(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function billedAmountForJob(invoices: HubInvoice[], jobId: string) {
  return invoices
    .filter(
      (invoice) =>
        invoice.sourceType === "job" &&
        invoice.sourceId === jobId &&
        invoice.status !== "Cancelled" &&
        invoice.claimType !== "credit-note",
    )
    .reduce((total, invoice) => {
      const valuationLines = invoice.valuationLines ?? [];
      if (valuationLines.length) {
        return (
          total +
          valuationLines.reduce(
            (sum, line) => sum + (Number(line.agreedThisPeriod) || Number(line.requestedThisPeriod) || 0),
            0,
          )
        );
      }
      return total + (Number(invoice.chargeTotal) || 0);
    }, 0);
}

/**
 * When Field marks a job Complete, create a Draft invoice-in-full claim if none exists yet.
 * Office reviews and sends from Core — mirrors the manual "invoice in full" path.
 */
export function maybeCreateDraftInvoiceOnJobComplete(jobId: string, actor = "Field workflow") {
  const job = getJobs().find((item) => item.id === jobId);
  if (!job) return null;

  const hub = getHubDetailState();
  const invoices = Array.isArray(hub.invoices) ? (hub.invoices as HubInvoice[]) : [];

  const existingDraft = invoices.find(
    (invoice) =>
      invoice.sourceType === "job" &&
      invoice.sourceId === jobId &&
      invoice.status === "Draft" &&
      invoice.claimType !== "credit-note",
  );
  if (existingDraft) return existingDraft;

  const billed = billedAmountForJob(invoices, jobId);
  const remaining = Math.max(0, (Number(job.value) || 0) - billed);
  if (remaining <= 0 && billed > 0) return null;

  const chargeTotal = remaining > 0 ? remaining : Number(job.value) || 0;
  if (chargeTotal <= 0) return null;

  const settings =
    hub.financeSettings && typeof hub.financeSettings === "object"
      ? (hub.financeSettings as Record<string, unknown>)
      : {};
  const termsDays = Math.max(0, Math.round(numericSetting(settings.paymentTermsDays, 14)));
  const issuedDate = todayIso();
  const ref = numberedReference(
    "invoice",
    settings as NumberingSettingsLike,
    invoices.map((invoice) => String(invoice.ref ?? "")),
  );

  const clients = getClients();
  const client = job.clientId ? clients.find((item) => item.id === job.clientId) : null;
  const sites = getClientSites();
  const site = job.siteId ? sites.find((item) => item.id === job.siteId) : null;
  const vatRate = numericSetting(settings.vatRate, 20);

  const created = {
    id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    ref,
    status: "Draft",
    sourceType: "job",
    sourceId: jobId,
    sourceRef: job.ref,
    sourceName: `Job ${job.ref}`,
    customer: job.customer,
    clientId: job.clientId,
    siteId: job.siteId ?? site?.id,
    issuedDate,
    dueDate: shiftIsoDate(issuedDate, termsDays),
    title: `Invoice in full for ${job.ref}`,
    lines: [
      {
        id: `inv-line-${Date.now()}`,
        description: job.description?.trim() || `Work on ${job.ref}`,
        category: "Other",
        costToUs: Math.round(chargeTotal * 0.68 * 100) / 100,
        chargeToClient: chargeTotal,
        note: "Auto-created when engineer marked job complete on Field",
      },
    ],
    costTotal: Math.round(chargeTotal * 0.68 * 100) / 100,
    chargeTotal,
    vatRate,
    vatTreatment: client?.vatTreatment || site?.vatTreatment || "Standard 20%",
    vatNote: `Standard VAT ${vatRate}%.`,
    notes: `Draft invoice created when ${job.ref} was marked complete on Field. Review lines and send from Core.`,
    claimType: "full",
    accountsStatus: "Not sent",
    paymentStatus: "Unpaid",
    paidAmount: 0,
    valuationLines: [
      {
        id: `valuation-${jobId}-${Date.now()}`,
        description: job.description || job.ref,
        contractValue: Number(job.value) || chargeTotal,
        previousApplications: billed,
        requestedThisPeriod: chargeTotal,
        agreedThisPeriod: chargeTotal,
      },
    ],
  };

  saveHubDetailState({ ...hub, invoices: [created, ...invoices] });

  appendAuditEvent({
    actor,
    action: "invoice created",
    recordType: "invoice",
    recordId: String(created.id),
    summary: `${created.ref} draft claim created for ${job.ref} after Field complete.`,
    source: "Field workflow",
    importance: "normal",
  });

  return created;
}

/** Alias for chain-continuity callers. */
export function createDraftInvoiceClaimFromJob(jobId: string, actor = "Field workflow") {
  const invoice = maybeCreateDraftInvoiceOnJobComplete(jobId, actor);
  if (!invoice) {
    return { ok: false as const, error: "Could not create draft invoice claim." };
  }
  return { ok: true as const, skipped: false, invoice };
}

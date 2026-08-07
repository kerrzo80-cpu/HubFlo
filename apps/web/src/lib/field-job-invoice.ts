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

type CostCentreLike = {
  id?: string;
  name?: string;
  materials?: Array<{ unitCost?: number | string; unitSell?: number | string; qty?: number | string; quantity?: number | string }>;
  labour?: Array<{ unitCost?: number | string; unitSell?: number | string; qty?: number | string; quantity?: number | string; hours?: number | string }>;
  labor?: Array<{ unitCost?: number | string; unitSell?: number | string; qty?: number | string; quantity?: number | string; hours?: number | string }>;
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

function lineQty(row: { qty?: number | string; quantity?: number | string; hours?: number | string }) {
  const raw = row.qty ?? row.quantity ?? row.hours ?? 1;
  const parsed = Number.parseFloat(String(raw).replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function lineMoney(row: { unitCost?: number | string; unitSell?: number | string }, field: "unitCost" | "unitSell") {
  const parsed = Number.parseFloat(String(row[field] ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Build invoice lines from job cost centres when present; never invent a fake cost ratio. */
function buildLinesFromJobCentres(jobId: string, jobDescription: string, chargeTotal: number) {
  const hub = getHubDetailState();
  const centresRaw = hub.jobCostCentres && typeof hub.jobCostCentres === "object"
    ? (hub.jobCostCentres as Record<string, unknown>)[jobId]
    : null;
  const centres = Array.isArray(centresRaw) ? (centresRaw as CostCentreLike[]) : [];

  const lines: Array<{
    id: string;
    description: string;
    category: "Materials" | "Labour" | "Other";
    costToUs: number;
    chargeToClient: number;
    note: string;
  }> = [];

  for (const centre of centres) {
    const name = String(centre.name || "Cost centre").trim() || "Cost centre";
    const materials = Array.isArray(centre.materials) ? centre.materials : [];
    const labour = Array.isArray(centre.labour)
      ? centre.labour
      : Array.isArray(centre.labor)
        ? centre.labor
        : [];

    let materialCost = 0;
    let materialSell = 0;
    for (const row of materials) {
      const qty = lineQty(row);
      materialCost += lineMoney(row, "unitCost") * qty;
      materialSell += lineMoney(row, "unitSell") * qty;
    }
    let labourCost = 0;
    let labourSell = 0;
    for (const row of labour) {
      const qty = lineQty(row);
      labourCost += lineMoney(row, "unitCost") * qty;
      labourSell += lineMoney(row, "unitSell") * qty;
    }

    if (materialCost > 0 || materialSell > 0) {
      lines.push({
        id: `inv-line-${centre.id || name}-materials`,
        description: `${name} materials`,
        category: "Materials",
        costToUs: Math.round(materialCost * 100) / 100,
        chargeToClient: Math.round(materialSell * 100) / 100,
        note: "From job cost centre",
      });
    }
    if (labourCost > 0 || labourSell > 0) {
      lines.push({
        id: `inv-line-${centre.id || name}-labour`,
        description: `${name} labour`,
        category: "Labour",
        costToUs: Math.round(labourCost * 100) / 100,
        chargeToClient: Math.round(labourSell * 100) / 100,
        note: "From job cost centre",
      });
    }
  }

  if (lines.length) {
    const sellSum = lines.reduce((sum, line) => sum + line.chargeToClient, 0);
    // If centre sells don't cover the remaining claim, add a balancing Other line.
    const remainder = Math.round((chargeTotal - sellSum) * 100) / 100;
    if (Math.abs(remainder) >= 0.01) {
      lines.push({
        id: `inv-line-balance-${Date.now()}`,
        description: remainder > 0 ? "Balance of job value" : "Adjustment to job value",
        category: "Other",
        costToUs: 0,
        chargeToClient: remainder,
        note: "Auto-created when engineer marked job complete on Field",
      });
    }
    return lines;
  }

  return [
    {
      id: `inv-line-${Date.now()}`,
      description: jobDescription.trim() || "Work completed",
      category: "Other" as const,
      costToUs: 0,
      chargeToClient: chargeTotal,
      note: "Auto-created when engineer marked job complete on Field — review cost in Core",
    },
  ];
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
 * Office reviews and sends from Core after passaround — mirrors the manual "invoice in full" path.
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
  const lines = buildLinesFromJobCentres(jobId, job.description || `Work on ${job.ref}`, chargeTotal);
  const costTotal = Math.round(lines.reduce((sum, line) => sum + line.costToUs, 0) * 100) / 100;

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
    lines,
    costTotal,
    chargeTotal,
    vatRate,
    vatTreatment: client?.vatTreatment || site?.vatTreatment || "Standard 20%",
    vatNote: `Standard VAT ${vatRate}%.`,
    notes: `Draft invoice created when ${job.ref} was marked complete on Field. Complete office passaround, review lines, then send from Core.`,
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

import { getClientSites, getClients, type ClientRecord, type ClientSite, type VatTreatment } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { numberedReference, type NumberingSettingsLike } from "@/lib/numbering";
import {
  dueRecurringPlans,
  listRecurringPlans,
  markRecurringGenerated,
  type RecurringKind,
  type RecurringPlan,
} from "@/lib/recurring-data";
import { createJob, type Job } from "@/lib/workflow-data";

type GeneratedRecurringRecord = {
  planId: string;
  kind: RecurringKind;
  ref: string;
};

type RecurringGenerateError = {
  planId: string;
  kind?: RecurringKind;
  error: string;
};

export type RecurringGenerateResult = {
  generated: GeneratedRecurringRecord[];
  errors: RecurringGenerateError[];
};

type DraftInvoice = {
  id: string;
  ref: string;
  status: "Draft";
  sourceType: "job";
  sourceId: string;
  sourceRef: string;
  sourceName: string;
  customer: string;
  issuedDate: string;
  dueDate: string;
  clientId?: string;
  siteId?: string;
  title: string;
  lines: Array<{
    id: string;
    description: string;
    category: "Other";
    costToUs: number;
    chargeToClient: number;
    note?: string;
  }>;
  costTotal: number;
  chargeTotal: number;
  vatRate: number;
  vatTreatment?: VatTreatment;
  vatNote?: string;
  notes: string;
  claimType: "full";
  accountsStatus: "Not sent";
  paymentStatus: "Unpaid";
  paidAmount: number;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function numericSetting(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function financeSettings() {
  const settings = getHubDetailState().financeSettings;
  return settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
}

function invoiceDueDateFromSettings(settings: Record<string, unknown>, issuedDate: string) {
  const termsDays = Math.max(0, Math.round(numericSetting(settings.paymentTermsDays, 14)));
  return shiftIsoDate(issuedDate, termsDays);
}

function vatTreatmentRate(treatment: VatTreatment | undefined, override: string | undefined, fallbackRate: number) {
  if (treatment === "Zero rated") return 0;
  if (treatment === "Domestic reverse charge") return 0;
  if (treatment === "Custom") return numericSetting(override, fallbackRate);
  return numericSetting(override, fallbackRate);
}

function vatTreatmentNote(treatment: VatTreatment, rate: number) {
  if (treatment === "Domestic reverse charge") {
    return "Domestic reverse charge applies. Customer accounts for VAT.";
  }
  if (treatment === "Zero rated") return "Zero-rated VAT treatment.";
  if (treatment === "Custom") return `Custom VAT rate ${rate}%.`;
  return `Standard VAT ${rate}%.`;
}

function resolveVatProfile(settings: Record<string, unknown>, client?: ClientRecord | null, site?: ClientSite | null) {
  const defaultRate = numericSetting(settings.vatRate, 20);
  const treatment = site?.vatTreatment ?? client?.vatTreatment ?? "Standard 20%";
  const override = site?.vatRateOverride ?? client?.vatRateOverride ?? String(settings.vatRate ?? "");
  const rate = vatTreatmentRate(treatment, override, defaultRate);
  return {
    rate,
    treatment,
    note: vatTreatmentNote(treatment, rate),
  };
}

function findClientForPlan(plan: RecurringPlan) {
  const clients = getClients();
  if (plan.clientId) {
    const byId = clients.find((client) => client.id === plan.clientId);
    if (byId) return byId;
  }
  const customer = plan.customer.trim().toLowerCase();
  if (!customer) return null;
  return (
    clients.find((client) => client.name.toLowerCase() === customer) ??
    clients.find((client) => client.name.toLowerCase().includes(customer)) ??
    null
  );
}

function findSiteForPlan(plan: RecurringPlan, client: ClientRecord | null) {
  const sites = getClientSites();
  if (plan.siteId) {
    const byId = sites.find((site) => site.id === plan.siteId);
    if (byId) return byId;
  }
  const sitesForClient = client ? sites.filter((site) => site.clientId === client.id) : [];
  const siteNeedle = plan.site?.trim().toLowerCase();
  if (siteNeedle) {
    const byName = sitesForClient.find(
      (site) => site.name.toLowerCase().includes(siteNeedle) || site.address.toLowerCase().includes(siteNeedle),
    );
    if (byName) return byName;
  }
  return sitesForClient[0] ?? null;
}

function assertActive(plan: RecurringPlan) {
  if (!plan.active) {
    throw new Error(`Recurring plan ${plan.name} is paused.`);
  }
}

function generateRecurringJob(plan: RecurringPlan, actor: string): Job {
  const client = findClientForPlan(plan);
  const site = findSiteForPlan(plan, client);
  const isIsoDue = isoDatePattern.test(plan.nextDueDate || "");
  return createJob({
    clientId: client?.id ?? plan.clientId,
    siteId: site?.id ?? plan.siteId,
    customer: client?.name ?? plan.customer,
    site: site?.address ?? plan.site ?? "Site to be confirmed",
    description: plan.description.trim() || plan.name,
    manager: actor,
    status: "Needs scheduling",
    value: 0,
    next: `Generated from recurring plan ${plan.name}`,
    due: isIsoDue ? plan.nextDueDate : "This week",
    scheduledDate: isIsoDue ? plan.nextDueDate : undefined,
  });
}

function existingInvoices() {
  const invoices = getHubDetailState().invoices;
  return Array.isArray(invoices) ? invoices : [];
}

function generateRecurringInvoice(plan: RecurringPlan) {
  const amount = Number(plan.amount) || 0;
  if (amount <= 0) {
    throw new Error("Set an amount before generating a recurring invoice.");
  }

  const client = findClientForPlan(plan);
  const site = findSiteForPlan(plan, client);
  const settings = financeSettings();
  const vatProfile = resolveVatProfile(settings, client, site);
  const issuedDate = isoDatePattern.test(plan.nextDueDate || "") ? plan.nextDueDate : todayIso();
  const invoices = existingInvoices();
  const ref = numberedReference(
    "invoice",
    settings as NumberingSettingsLike,
    invoices.map((invoice) =>
      invoice && typeof invoice === "object" && "ref" in invoice ? String((invoice as { ref?: unknown }).ref ?? "") : "",
    ),
  );
  const created: DraftInvoice = {
    id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    ref,
    status: "Draft",
    sourceType: "job",
    sourceId: `recurring-${plan.name}`,
    sourceRef: plan.name,
    sourceName: `Recurring · ${plan.name}`,
    customer: client?.name || plan.customer,
    issuedDate,
    dueDate: invoiceDueDateFromSettings(settings, issuedDate),
    clientId: client?.id,
    siteId: site?.id,
    title: plan.name,
    lines: [
      {
        id: `inv-line-${Date.now()}`,
        description: plan.description || plan.name,
        category: "Other",
        costToUs: 0,
        chargeToClient: amount,
        note: "Recurring invoice plan",
      },
    ],
    costTotal: 0,
    chargeTotal: amount,
    vatRate: vatProfile.rate,
    vatTreatment: vatProfile.treatment,
    vatNote: vatProfile.note,
    notes: `Generated from recurring plan ${plan.name}. ${vatProfile.note}`,
    claimType: "full",
    accountsStatus: "Not sent",
    paymentStatus: "Unpaid",
    paidAmount: 0,
  };

  const hub = getHubDetailState();
  const currentInvoices = Array.isArray(hub.invoices) ? hub.invoices : [];
  saveHubDetailState({
    ...hub,
    invoices: [created, ...currentInvoices],
  });
  return created;
}

function generatePlan(plan: RecurringPlan, actor: string): GeneratedRecurringRecord {
  assertActive(plan);
  const ref = plan.kind === "Job" ? generateRecurringJob(plan, actor).ref : generateRecurringInvoice(plan).ref;
  markRecurringGenerated(plan.id, ref);
  return { planId: plan.id, kind: plan.kind, ref };
}

export function generateRecurringPlanById({ id, actor }: { id: string; actor?: string }) {
  const plan = listRecurringPlans(true).find((item) => item.id === id);
  if (!plan) {
    throw new Error("Recurring plan not found.");
  }
  return generatePlan(plan, actor?.trim() || "NeXa automation");
}

export function generateDueRecurringPlans({
  asOf,
  actor,
  limit,
}: {
  asOf?: string;
  actor?: string;
  limit?: number;
} = {}): RecurringGenerateResult {
  const max = Number.isFinite(limit) && limit !== undefined && limit > 0 ? Math.floor(limit) : undefined;
  const plans = dueRecurringPlans(asOf).slice(0, max);
  const result: RecurringGenerateResult = { generated: [], errors: [] };
  const generatorActor = actor?.trim() || "NeXa automation";

  for (const plan of plans) {
    try {
      result.generated.push(generatePlan(plan, generatorActor));
    } catch (error) {
      result.errors.push({
        planId: plan.id,
        kind: plan.kind,
        error: error instanceof Error ? error.message : "Unable to generate recurring plan.",
      });
    }
  }

  return result;
}

import { getClientSites, getClients, type ClientRecord, type ClientSite, type VatTreatment } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { numberedReference, type NumberingSettingsLike } from "@/lib/numbering";
import {
  convertQuoteToJob,
  updateJob,
  type Job,
  type Quote,
  type QuoteConversionResult,
} from "@/lib/workflow-data";

type QuoteCostLineRecord = {
  id?: string;
  catalogItemId?: string;
  description?: string;
  quantity?: number;
  unitCost?: number;
  unitSell?: number;
};

type QuoteCostCentreRecord = {
  id: string;
  name?: string;
  templateName?: string;
  clientDescription?: string;
  engineerDescription?: string;
  isOption?: boolean;
  optionStatus?: string;
  lines?: QuoteCostLineRecord[];
  surveyAssets?: Array<Record<string, unknown>>;
};

type EstimateMaterialLineRecord = {
  id: string;
  catalogItemId?: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
};

type EstimateLabourLineRecord = {
  id: string;
  catalogItemId?: string;
  role: string;
  hours: number;
  costRate: number;
  markupPercent: number;
};

export type EstimateCostCentreRecord = {
  id: string;
  name: string;
  sectionId?: string;
  templateName?: string;
  clientDescription: string;
  engineerDescription: string;
  materials: EstimateMaterialLineRecord[];
  labour: EstimateLabourLineRecord[];
  surveyAssets?: Array<Record<string, unknown>>;
};

export type QuoteConversionHandoffResult = {
  costCentresCopied: number;
  jobCostCentres: EstimateCostCentreRecord[];
  depositInvoice: Record<string, unknown> | null;
  jobValueUpdated: boolean;
  communicationLogged: boolean;
  firstVisitDraftCreated: boolean;
};

export type QuoteConversionServerResult = QuoteConversionResult & {
  handoff: QuoteConversionHandoffResult;
};

export type ConvertQuoteToJobServerOptions = {
  actor?: string;
  chargeValue?: number;
  source?: string;
  skipDeposit?: boolean;
  skipCommunication?: boolean;
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function lineSellFromMarkup(cost: number, markupPercent: number) {
  return cost * (1 + markupPercent / 100);
}

function quoteLineCost(line: QuoteCostLineRecord) {
  return (Number(line.quantity) || 0) * (Number(line.unitCost) || 0);
}

function quoteLineSell(line: QuoteCostLineRecord) {
  return (Number(line.quantity) || 0) * (Number(line.unitSell) || 0);
}

function quoteLineMarkupPercent(line: QuoteCostLineRecord) {
  const unitCost = Number(line.unitCost) || 0;
  const unitSell = Number(line.unitSell) || 0;
  return unitCost > 0 ? roundCurrency(((unitSell - unitCost) / unitCost) * 100) : 0;
}

function quoteLineCatalogType(line: QuoteCostLineRecord) {
  const catalogItemId = String(line.catalogItemId || "");
  if (catalogItemId.startsWith("labour-")) return "Labour";
  return "Material";
}

function quoteCostCentreTotals(centre: QuoteCostCentreRecord) {
  const lines = Array.isArray(centre.lines) ? centre.lines : [];
  const materialLines = lines.filter((line) => quoteLineCatalogType(line) !== "Labour");
  const labourLines = lines.filter((line) => quoteLineCatalogType(line) === "Labour");
  const materialCost = materialLines.reduce((total, line) => total + quoteLineCost(line), 0);
  const materialSell = materialLines.reduce((total, line) => total + quoteLineSell(line), 0);
  const labourCost = labourLines.reduce((total, line) => total + quoteLineCost(line), 0);
  const labourSell = labourLines.reduce((total, line) => total + quoteLineSell(line), 0);
  return {
    materialLines,
    labourLines,
    materialCost,
    materialSell,
    labourCost,
    labourSell,
    totalSell: materialSell + labourSell,
  };
}

function quoteValueFromCostCentres(centres: QuoteCostCentreRecord[]) {
  if (!centres.length) return null;
  return roundCurrency(
    centres
      .filter((centre) => !centre.isOption || centre.optionStatus === "Selected")
      .reduce((total, centre) => total + quoteCostCentreTotals(centre).totalSell, 0),
  );
}

function defaultJobSectionId(jobId: string) {
  return `${jobId}-section-main`;
}

export function estimateCostCentresFromQuote(job: Job, quoteCentres: QuoteCostCentreRecord[]): EstimateCostCentreRecord[] {
  if (!quoteCentres.length) return [];

  return quoteCentres.map((centre, centreIndex) => {
    const totals = quoteCostCentreTotals(centre);
    const materials = totals.materialLines.map((line, lineIndex): EstimateMaterialLineRecord => ({
      id: `${job.id}-${centre.id}-material-${lineIndex}`,
      catalogItemId: line.catalogItemId,
      description: String(line.description || ""),
      quantity: Number(line.quantity) || 0,
      unitCost: Number(line.unitCost) || 0,
      markupPercent: quoteLineMarkupPercent(line),
    }));
    const labour = totals.labourLines.map((line, lineIndex): EstimateLabourLineRecord => ({
      id: `${job.id}-${centre.id}-labour-${lineIndex}`,
      catalogItemId: line.catalogItemId,
      role: String(line.description || ""),
      hours: Number(line.quantity) || 0,
      costRate: Number(line.unitCost) || 0,
      markupPercent: quoteLineMarkupPercent(line),
    }));

    return {
      id: `${job.id}-from-${centre.id}-${centreIndex}`,
      name: String(centre.name || "Cost centre"),
      sectionId: defaultJobSectionId(job.id),
      templateName: centre.templateName,
      clientDescription: centre.clientDescription ?? "",
      engineerDescription: centre.engineerDescription ?? "",
      materials,
      labour,
      surveyAssets: centre.surveyAssets?.map((asset) => ({ ...asset })) ?? [],
    };
  });
}

function estimateMaterialCost(line: EstimateMaterialLineRecord) {
  return line.quantity * line.unitCost;
}

function estimateMaterialSell(line: EstimateMaterialLineRecord) {
  return line.quantity * lineSellFromMarkup(line.unitCost, line.markupPercent);
}

function estimateLabourCost(line: EstimateLabourLineRecord) {
  return line.hours * line.costRate;
}

function estimateLabourSell(line: EstimateLabourLineRecord) {
  return line.hours * lineSellFromMarkup(line.costRate, line.markupPercent);
}

function estimateCostCentreTotals(centre: EstimateCostCentreRecord) {
  const materialCost = centre.materials.reduce((total, line) => total + estimateMaterialCost(line), 0);
  const materialSell = centre.materials.reduce((total, line) => total + estimateMaterialSell(line), 0);
  const labourCost = centre.labour.reduce((total, line) => total + estimateLabourCost(line), 0);
  const labourSell = centre.labour.reduce((total, line) => total + estimateLabourSell(line), 0);
  return {
    materialCost,
    materialSell,
    labourCost,
    labourSell,
    totalCost: materialCost + labourCost,
    totalSell: materialSell + labourSell,
  };
}

function numericSetting(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function resolveVatProfile(
  settings: Record<string, unknown>,
  client?: ClientRecord | null,
  site?: ClientSite | null,
) {
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

function asQuoteCostCentres(hubState: ReturnType<typeof getHubDetailState>, quoteId: string) {
  const map = hubState.quoteCostCentres;
  if (!map || typeof map !== "object" || Array.isArray(map)) return [] as QuoteCostCentreRecord[];
  const centres = (map as Record<string, unknown>)[quoteId];
  return Array.isArray(centres) ? (centres as QuoteCostCentreRecord[]) : [];
}

/** Customer-facing quote portal summary (no costs — sell only). */
export function getQuotePortalLineSummary(quoteId: string) {
  const centres = asQuoteCostCentres(getHubDetailState(), quoteId).filter(
    (centre) => !centre.isOption || centre.optionStatus === "Selected",
  );
  return centres.map((centre) => {
    const totals = quoteCostCentreTotals(centre);
    return {
      id: centre.id,
      name: String(centre.name || "Package"),
      description: String(centre.clientDescription || "").trim(),
      sell: roundCurrency(totals.totalSell),
    };
  });
}

function isoDatePlusDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Unassigned first-visit draft so Schedules/Field chain starts without office rescue. */
export function maybeCreateFirstVisitDraft(job: Job, centres: EstimateCostCentreRecord[]) {
  const hubState = getHubDetailState();
  const plansByJob = {
    ...((hubState.jobSchedulePlans && typeof hubState.jobSchedulePlans === "object"
      ? hubState.jobSchedulePlans
      : {}) as Record<string, unknown>),
  };
  const existing = plansByJob[job.id];
  if (Array.isArray(existing) && existing.length > 0) return false;

  const centre = centres[0];
  const startDate = isoDatePlusDays(1);
  const assignment = {
    id: `${job.id}-plan-accept-${Date.now()}`,
    jobId: job.id,
    costCentreId: centre?.id || `${job.id}-section-main`,
    costCentreName: centre?.name || "First visit",
    employeeId: "",
    employeeName: "Office to assign",
    startDate,
    startTime: "09:00",
    endDate: startDate,
    endTime: "11:00",
    plannedHours: 2,
    notes: "Draft visit created when the customer accepted the quote online. Assign an engineer in Schedules.",
  };

  plansByJob[job.id] = [assignment];
  saveHubDetailState({
    ...hubState,
    jobSchedulePlans: plansByJob,
  });
  updateJob(job.id, {
    scheduledDate: startDate,
    next: `${job.next ? `${job.next} ` : ""}First visit draft ${startDate} — assign engineer in Schedules.`,
  });
  return true;
}

function asJobCostCentresMap(hubState: ReturnType<typeof getHubDetailState>) {
  const map = hubState.jobCostCentres;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {} as Record<string, EstimateCostCentreRecord[]>;
  return map as Record<string, EstimateCostCentreRecord[]>;
}

function asInvoices(hubState: ReturnType<typeof getHubDetailState>) {
  return Array.isArray(hubState.invoices) ? [...hubState.invoices] : [];
}

function findClient(job: Job) {
  const clients = getClients();
  if (job.clientId) {
    const match = clients.find((client) => client.id === job.clientId);
    if (match) return match;
  }
  return clients.find((client) => client.name.toLowerCase() === job.customer.toLowerCase()) ?? null;
}

function findSite(job: Job, client: ClientRecord | null) {
  const sites = getClientSites();
  if (job.siteId) {
    const match = sites.find((site) => site.id === job.siteId);
    if (match) return match;
  }
  if (client) {
    return sites.find((site) => site.clientId === client.id) ?? null;
  }
  return null;
}

function copyQuoteCostCentresToJob(job: Job, quoteId: string, hubState = getHubDetailState()) {
  const sourceCentres = asQuoteCostCentres(hubState, quoteId);
  if (!sourceCentres.length) {
    return { centres: [] as EstimateCostCentreRecord[], copied: 0, hubState };
  }

  const jobCostCentres = { ...asJobCostCentresMap(hubState) };
  const existing = jobCostCentres[job.id] ?? [];
  if (existing.length > 0) {
    return { centres: existing, copied: 0, hubState };
  }

  const imported = estimateCostCentresFromQuote(job, sourceCentres);
  jobCostCentres[job.id] = imported;
  const nextHub = {
    ...hubState,
    jobCostCentres,
  };
  saveHubDetailState(nextHub);
  return { centres: imported, copied: imported.length, hubState: nextHub };
}

function createDepositInvoiceForJob(
  job: Job,
  depositPercentInput: number,
  centres: EstimateCostCentreRecord[],
  hubState: ReturnType<typeof getHubDetailState>,
) {
  const depositPercent = Math.max(1, Math.min(100, Math.round(Number(depositPercentInput) || 0)));
  if (!Number.isFinite(depositPercent) || depositPercent <= 0) return null;

  const invoices = asInvoices(hubState);
  const existingDeposit = invoices.find(
    (invoice) =>
      invoice &&
      typeof invoice === "object" &&
      (invoice as { sourceType?: string }).sourceType === "job" &&
      (invoice as { sourceId?: string }).sourceId === job.id &&
      (invoice as { claimType?: string }).claimType === "deposit",
  );
  if (existingDeposit) return null;

  const settings =
    hubState.financeSettings && typeof hubState.financeSettings === "object"
      ? (hubState.financeSettings as Record<string, unknown>)
      : {};
  const client = findClient(job);
  const site = findSite(job, client);
  const vatProfile = resolveVatProfile(settings, client, site);
  const createdOn = new Date().toISOString().slice(0, 10);
  const dueDate = invoiceDueDateFromSettings(settings, createdOn);

  let valuationLines = centres.map((centre) => {
    const totals = estimateCostCentreTotals(centre);
    return {
      id: `valuation-${centre.id}-${Date.now()}`,
      costCentreId: centre.id,
      category: "contractual",
      description: centre.name,
      contractValue: totals.totalSell,
      previousApplications: 0,
      requestedThisPeriod: 0,
      agreedThisPeriod: 0,
    };
  });

  if (valuationLines.length === 0) {
    valuationLines = [
      {
        id: `valuation-${job.id}-${Date.now()}`,
        costCentreId: "contract",
        category: "contractual",
        description: job.description || job.ref,
        contractValue: job.value || 0,
        previousApplications: 0,
        requestedThisPeriod: 0,
        agreedThisPeriod: 0,
      },
    ];
  }

  valuationLines = valuationLines.map((line) => {
    const remaining = Math.max(0, line.contractValue - line.previousApplications);
    const target = line.contractValue * (depositPercent / 100);
    const requestedThisPeriod = Math.min(remaining, Math.max(0, target - line.previousApplications));
    return { ...line, requestedThisPeriod, agreedThisPeriod: requestedThisPeriod };
  });

  const grossClaim = valuationLines.reduce((sum, line) => sum + line.requestedThisPeriod, 0);
  if (grossClaim <= 0) return null;

  const contractTotal = valuationLines.reduce((sum, line) => sum + line.contractValue, 0) || job.value || grossClaim;
  const netClaim = grossClaim;
  const costRatio = contractTotal > 0 ? Math.min(1, grossClaim / contractTotal) : 0;
  const sourceCost = centres.reduce((sum, centre) => sum + estimateCostCentreTotals(centre).totalCost, 0);

  const lines = valuationLines
    .filter((line) => line.requestedThisPeriod > 0)
    .map((line) => ({
      id: `invoice-claim-${line.id}`,
      description: line.description,
      category: "Other",
      costToUs: sourceCost * (line.contractValue / Math.max(1, contractTotal)) * costRatio,
      chargeToClient: line.requestedThisPeriod,
      note: `${depositPercent}% deposit claim`,
    }));

  const ref = numberedReference(
    "invoice",
    settings as NumberingSettingsLike,
    invoices.map((invoice) =>
      invoice && typeof invoice === "object" && "ref" in invoice ? String((invoice as { ref?: unknown }).ref ?? "") : "",
    ),
  );

  const created: Record<string, unknown> = {
    id: `inv-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    ref,
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
    title: `${depositPercent}% deposit for ${job.ref}`,
    lines,
    costTotal: lines.reduce((sum, line) => sum + line.costToUs, 0),
    chargeTotal: netClaim,
    vatRate: vatProfile.rate,
    vatTreatment: vatProfile.treatment,
    vatNote: vatProfile.note,
    notes: `${depositPercent}% deposit created on quote acceptance for ${job.ref}. ${vatProfile.note}`,
    claimType: "deposit",
    claimPercent: depositPercent,
    retentionPercent: 0,
    accountsStatus: "Not sent",
    paymentStatus: "Unpaid",
    paidAmount: 0,
    valuationLines,
  };

  saveHubDetailState({
    ...hubState,
    invoices: [created, ...invoices],
  });
  return created;
}

function appendQuoteAcceptanceCommunication(quote: Quote, job: Job, actor: string, hubState: ReturnType<typeof getHubDetailState>) {
  const communications = Array.isArray(hubState.communications) ? [...hubState.communications] : [];
  communications.unshift({
    id: `comm-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    recordType: "quote",
    recordId: quote.id,
    relatedJobId: job.id,
    direction: "inbound",
    channel: "Client portal",
    subject: `${quote.ref} accepted online`,
    body: `${actor} accepted quote ${quote.ref} online. Job ${job.ref} created and linked.`,
    from: actor,
    to: "office@errolwatsongroup.co.uk",
    createdAt: new Date().toISOString(),
    status: "Received",
  });
  saveHubDetailState({
    ...hubState,
    communications,
  });
}

function maybeSyncJobValueFromCentres(job: Job, quote: Quote, centres: EstimateCostCentreRecord[]) {
  if (quote.simproQuoteId) return false;
  const fromCentres = quoteValueFromCostCentres(asQuoteCostCentres(getHubDetailState(), quote.id));
  const nextValue = fromCentres ?? centres.reduce((sum, centre) => sum + estimateCostCentreTotals(centre).totalSell, 0);
  if (!nextValue || nextValue <= 0 || Math.abs(job.value - nextValue) < 0.01) return false;
  updateJob(job.id, { value: nextValue });
  return true;
}

export function applyQuoteConversionHandoff(
  quote: Quote,
  job: Job,
  options: ConvertQuoteToJobServerOptions = {},
): QuoteConversionHandoffResult {
  const { copied, centres, hubState: hubAfterCentres } = copyQuoteCostCentresToJob(job, quote.id);
  const jobValueUpdated = maybeSyncJobValueFromCentres(job, quote, centres);

  let depositInvoice: Record<string, unknown> | null = null;
  if (!options.skipDeposit) {
    const workflowRules =
      hubAfterCentres.workflowRules && typeof hubAfterCentres.workflowRules === "object"
        ? (hubAfterCentres.workflowRules as Record<string, unknown>)
        : {};
    if (Boolean(workflowRules.autoCreateDepositOnAcceptance)) {
      const depositPercent = Math.max(1, Math.min(100, numericSetting(workflowRules.defaultDepositPercent, 30)));
      depositInvoice = createDepositInvoiceForJob(job, depositPercent, centres, getHubDetailState());
    }
  }

  let communicationLogged = false;
  if (!options.skipCommunication) {
    appendQuoteAcceptanceCommunication(quote, job, options.actor ?? quote.customer, getHubDetailState());
    communicationLogged = true;
  }

  const firstVisitDraftCreated = maybeCreateFirstVisitDraft(job, centres);

  return {
    costCentresCopied: copied,
    jobCostCentres: centres,
    depositInvoice,
    jobValueUpdated,
    communicationLogged,
    firstVisitDraftCreated,
  };
}

export function convertQuoteToJobServer(
  quoteId: string,
  options: ConvertQuoteToJobServerOptions = {},
): QuoteConversionServerResult | null {
  const conversion = convertQuoteToJob(quoteId, options.actor ?? "HubFlo user", options.chargeValue);
  if (!conversion) return null;

  const handoff = applyQuoteConversionHandoff(conversion.quote, conversion.job, options);
  return {
    ...conversion,
    handoff,
  };
}

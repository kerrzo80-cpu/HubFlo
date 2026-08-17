import { DOMESTIC_COST_CENTRE_CATALOGUE, displayNamesForDomesticStopGo } from "@/lib/domestic-stop-go/cost-centres";
import { seedDomesticCostCentresIdempotent } from "@/lib/domestic-stop-go/store";
import { getPublishedTemplate } from "@/lib/domestic-stop-go/templates";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { addClientRecord, addClientSiteRecord, getClients, getClientSites, updateClientRecord, updateClientSiteRecord } from "@/lib/people-data";
import { createJob, getJob, updateJob, type Job } from "@/lib/workflow-data";

export const GAS_SERVICE_TRIAL = {
  jobId: "job-dom-gas-service-trial",
  jobRef: "J-TRIAL-GS",
  scheduleId: "sched-dom-gas-service-trial",
  costCentreId: "job-dom-gas-service-trial-cc",
  costCentreName: "Gas Boiler Service",
  clientId: "client-dom-gas-service-trial",
  siteId: "site-dom-gas-service-trial",
  customer: "Hillside domestic gas service",
  siteName: "22 Beech Grove",
  siteAddress: "22 Beech Grove, Harrogate, HG1 5AA",
  engineerId: "eng-chris",
  engineerName: "Chris Lawson",
} as const;

function mergeCostCentreTypes(current: unknown): string[] {
  const existing = Array.isArray(current) ? current.map((item) => String(item)) : [];
  const next = [...existing];
  for (const name of displayNamesForDomesticStopGo()) {
    if (!next.some((item) => item.toLowerCase() === name.toLowerCase())) next.push(name);
  }
  return next;
}

function mergeFlowAssignments(current: unknown): Record<string, string> {
  const next = current && typeof current === "object" ? { ...(current as Record<string, string>) } : {};
  for (const centre of DOMESTIC_COST_CENTRE_CATALOGUE) {
    if (!next[centre.displayName]) next[centre.displayName] = `domestic-stop-go:${centre.stableCode}`;
  }
  return next;
}

export function seedDomesticStopGoHubTypes() {
  seedDomesticCostCentresIdempotent();
  const hub = getHubDetailState();
  const costCentreTypes = mergeCostCentreTypes(hub.costCentreTypes);
  const costCentreFlowAssignmentDrafts = mergeFlowAssignments(hub.costCentreFlowAssignmentDrafts);
  const changed =
    JSON.stringify(costCentreTypes) !== JSON.stringify(hub.costCentreTypes || [])
    || JSON.stringify(costCentreFlowAssignmentDrafts) !== JSON.stringify(hub.costCentreFlowAssignmentDrafts || {});
  if (changed) {
    saveHubDetailState({
      ...hub,
      costCentreTypes,
      costCentreFlowAssignmentDrafts,
    });
  }
  return { costCentreTypes, costCentreFlowAssignmentDrafts };
}

function ensureClientAndSite() {
  const existingClient = getClients().find((client) => client.id === GAS_SERVICE_TRIAL.clientId);
  if (!existingClient) {
    addClientRecord({
      id: GAS_SERVICE_TRIAL.clientId,
      name: GAS_SERVICE_TRIAL.customer,
      accountReference: "C-TRIAL-GS",
      status: "Active",
      primaryContact: "Chris Lawson",
      email: "office@trial.example",
      phone: "+44 1423 000001",
      billingAddress: GAS_SERVICE_TRIAL.siteAddress,
      commercialOwner: GAS_SERVICE_TRIAL.engineerName,
      notes: "Pilot domestic Gas Boiler Service stop/go trial.",
      vatTreatment: "Standard 20%",
      vatRateOverride: "",
    });
  } else {
    updateClientRecord(GAS_SERVICE_TRIAL.clientId, {
      name: GAS_SERVICE_TRIAL.customer,
      billingAddress: GAS_SERVICE_TRIAL.siteAddress,
    });
  }
  const existingSite = getClientSites().find((site) => site.id === GAS_SERVICE_TRIAL.siteId);
  if (!existingSite) {
    addClientSiteRecord({
      id: GAS_SERVICE_TRIAL.siteId,
      clientId: GAS_SERVICE_TRIAL.clientId,
      name: GAS_SERVICE_TRIAL.siteName,
      address: GAS_SERVICE_TRIAL.siteAddress,
      accessNotes: "Pilot Gas Boiler Service stop/go. Chris Lawson is competent.",
      primaryContact: "Occupier",
      serviceLine: "Gas Boiler Service",
      nextVisit: "Today",
      vatTreatment: "Standard 20%",
      vatRateOverride: "",
    });
  } else {
    updateClientSiteRecord(GAS_SERVICE_TRIAL.siteId, {
      clientId: GAS_SERVICE_TRIAL.clientId,
      address: GAS_SERVICE_TRIAL.siteAddress,
      serviceLine: "Gas Boiler Service",
    });
  }
}

function ensureJob(): Job {
  const existing = getJob(GAS_SERVICE_TRIAL.jobId);
  if (existing) {
    return (
      updateJob(GAS_SERVICE_TRIAL.jobId, {
        clientId: GAS_SERVICE_TRIAL.clientId,
        siteId: GAS_SERVICE_TRIAL.siteId,
        customer: GAS_SERVICE_TRIAL.customer,
        site: GAS_SERVICE_TRIAL.siteAddress,
        description: "Domestic Gas Boiler Service — complete the Field stop/go gates. NeXa populates the branded record.",
        manager: GAS_SERVICE_TRIAL.engineerName,
        status: existing.status === "Completed" || existing.status === "Invoiced" ? existing.status : "In progress",
        next: "Open Field as Chris Lawson → Gas Boiler Service checklist",
        due: "Today",
      }) ?? existing
    );
  }
  return createJob({
    id: GAS_SERVICE_TRIAL.jobId,
    ref: GAS_SERVICE_TRIAL.jobRef,
    clientId: GAS_SERVICE_TRIAL.clientId,
    siteId: GAS_SERVICE_TRIAL.siteId,
    customer: GAS_SERVICE_TRIAL.customer,
    site: GAS_SERVICE_TRIAL.siteAddress,
    description: "Domestic Gas Boiler Service — complete the Field stop/go gates. NeXa populates the branded record.",
    manager: GAS_SERVICE_TRIAL.engineerName,
    status: "In progress",
    health: "blue",
    value: 180,
    next: "Open Field as Chris Lawson → Gas Boiler Service checklist",
    due: "Today",
  });
}

function ensureHubJob() {
  const hub = getHubDetailState();
  const centresByJob = { ...((hub.jobCostCentres ?? {}) as Record<string, unknown[]>) };
  const plansByJob = { ...((hub.jobSchedulePlans ?? {}) as Record<string, unknown[]>) };
  const centres = Array.isArray(centresByJob[GAS_SERVICE_TRIAL.jobId])
    ? [...(centresByJob[GAS_SERVICE_TRIAL.jobId] as Array<Record<string, unknown>>)]
    : [];
  if (!centres.some((item) => item.id === GAS_SERVICE_TRIAL.costCentreId)) {
    centres.push({
      id: GAS_SERVICE_TRIAL.costCentreId,
      name: GAS_SERVICE_TRIAL.costCentreName,
      templateName: GAS_SERVICE_TRIAL.costCentreName,
      clientDescription: "Annual domestic gas boiler service.",
      engineerDescription: "Complete the mandatory Gas Boiler Service stop/go. Answers populate the NeXa work record.",
      materials: [],
      labour: [],
    });
  } else {
    centres.forEach((item) => {
      if (item.id === GAS_SERVICE_TRIAL.costCentreId) {
        item.templateName = GAS_SERVICE_TRIAL.costCentreName;
        item.name = GAS_SERVICE_TRIAL.costCentreName;
      }
    });
  }
  centresByJob[GAS_SERVICE_TRIAL.jobId] = centres;
  const plans = Array.isArray(plansByJob[GAS_SERVICE_TRIAL.jobId])
    ? [...(plansByJob[GAS_SERVICE_TRIAL.jobId] as Array<Record<string, unknown>>)]
    : [];
  if (!plans.some((item) => item.id === GAS_SERVICE_TRIAL.scheduleId)) {
    const today = new Date().toISOString().slice(0, 10);
    plans.push({
      id: GAS_SERVICE_TRIAL.scheduleId,
      costCentreId: GAS_SERVICE_TRIAL.costCentreId,
      costCentreName: GAS_SERVICE_TRIAL.costCentreName,
      employeeId: GAS_SERVICE_TRIAL.engineerId,
      employeeName: GAS_SERVICE_TRIAL.engineerName,
      startDate: today,
      endDate: today,
      startTime: "13:00",
      endTime: "15:00",
      notes: "Pilot Gas Boiler Service stop/go.",
    });
  }
  plansByJob[GAS_SERVICE_TRIAL.jobId] = plans;
  saveHubDetailState({
    ...hub,
    jobCostCentres: centresByJob,
    jobSchedulePlans: plansByJob,
  });
}

let ensured = false;

export function ensureDomesticStopGoSeed() {
  seedDomesticStopGoHubTypes();
  if (ensured) return getJob(GAS_SERVICE_TRIAL.jobId) ?? null;
  ensureClientAndSite();
  const job = ensureJob();
  ensureHubJob();
  ensured = true;
  return job;
}

export function publishedTemplatesHealth() {
  return DOMESTIC_COST_CENTRE_CATALOGUE.map((centre) => ({
    code: centre.stableCode,
    displayName: centre.displayName,
    templateId: getPublishedTemplate(centre.stableCode)?.id || null,
  }));
}

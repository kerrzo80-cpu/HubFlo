import { addClientRecord, addClientSiteRecord, getClients, getClientSites } from "@/lib/people-data";
import {
  boilerServiceFlowTemplate,
  flowEvidenceKey,
  hasCapturedFlowEvidence,
  purgeEmptyFlowStepCompletions,
  validateFlowStepEvidence,
  type EngineerFlowStepEvidenceValue,
} from "@/lib/engineer-flow";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { createJob, getJob, updateJob, type Job } from "@/lib/workflow-data";

export const GAS_CERT_TRIAL = {
  jobId: "job-gas-cert-trial",
  jobRef: "J-TRIAL-GAS",
  scheduleId: "sched-gas-cert-trial",
  costCentreId: "job-gas-cert-trial-boiler-service",
  costCentreName: "Boiler servicing",
  clientId: "client-aberbuild",
  siteId: "site-hillside-harrogate",
  customer: "Aberbuild (Gas cert trial)",
  siteName: "14 Hillside Avenue",
  siteAddress: "14 Hillside Avenue, Harrogate, HG2 7PL",
  engineerName: "Brian Kerr",
} as const;

const SAMPLE_EVIDENCE: Record<string, EngineerFlowStepEvidenceValue> = {
  "service-boiler-photo": { photoName: "boiler-surroundings-trial.jpg", capturedAt: new Date().toISOString() },
  "service-location": { text: "Kitchen cupboard", capturedAt: new Date().toISOString() },
  "service-make-model": { text: "Worcester Greenstar 30i", capturedAt: new Date().toISOString() },
  "service-serial": { text: "WS30i-TRIAL-001", capturedAt: new Date().toISOString() },
  "service-visual": { text: "Visual condition satisfactory", capturedAt: new Date().toISOString() },
  "service-flue": { text: "Flue and ventilation checks complete", capturedAt: new Date().toISOString() },
  "service-safety-devices": { text: "Safety devices working correctly", capturedAt: new Date().toISOString() },
  "service-operating-pressure": { text: "20 mbar", capturedAt: new Date().toISOString() },
  "service-co-reading": { numberValue: "18", capturedAt: new Date().toISOString() },
  "service-ratio": { numberValue: "0.004", capturedAt: new Date().toISOString() },
  "service-safe-to-use": { text: "Appliance safe to use", capturedAt: new Date().toISOString() },
  "service-defects": { text: "None", capturedAt: new Date().toISOString() },
  "service-next-due": { text: "2027-07-31", capturedAt: new Date().toISOString() },
  "service-gas-safe-id": { text: "123456789012", capturedAt: new Date().toISOString() },
  "service-customer-signoff": { text: "Site contact", capturedAt: new Date().toISOString() },
};

export function gasCertTrialCostCentres() {
  return [
    {
      id: GAS_CERT_TRIAL.costCentreId,
      name: GAS_CERT_TRIAL.costCentreName,
      templateName: "Boiler servicing",
      clientDescription: "Annual boiler service and gas safety checks for the Aberbuild trial site.",
      engineerDescription:
        "Complete boiler servicing stop/go on the Field app. Readings and photos populate the Core gas service record and certificate preview.",
      materials: [
        {
          id: `${GAS_CERT_TRIAL.costCentreId}-service-kit`,
          catalogItemId: "material-consumables",
          description: "Service consumables allowance",
          quantity: 1,
          unitCost: 35,
          markupPercent: 25,
        },
      ],
      labour: [
        {
          id: `${GAS_CERT_TRIAL.costCentreId}-engineer`,
          role: "Gas engineer labour",
          hours: 2,
          costRate: 45,
          markupPercent: 30,
        },
      ],
    },
  ];
}

function ensureClientAndSite() {
  if (!getClients().some((client) => client.id === GAS_CERT_TRIAL.clientId)) {
    addClientRecord({
      id: GAS_CERT_TRIAL.clientId,
      name: GAS_CERT_TRIAL.customer,
      accountReference: "C-TRIAL-GAS",
      status: "Active",
      primaryContact: "Site contact",
      email: "trial@aberbuild.example",
      phone: "+44 1224 000000",
      billingAddress: GAS_CERT_TRIAL.siteAddress,
      commercialOwner: GAS_CERT_TRIAL.engineerName,
      notes: "Always-on gas certification trial client. Linked to Field job J-TRIAL-GAS.",
      vatTreatment: "Standard 20%",
      vatRateOverride: "",
    });
  }

  if (!getClientSites().some((site) => site.id === GAS_CERT_TRIAL.siteId)) {
    addClientSiteRecord({
      id: GAS_CERT_TRIAL.siteId,
      clientId: GAS_CERT_TRIAL.clientId,
      name: GAS_CERT_TRIAL.siteName,
      address: GAS_CERT_TRIAL.siteAddress,
      accessNotes: "Trial site for gas certification stop/go. Safe to complete.",
      primaryContact: "Site contact",
      serviceLine: "Boiler servicing / gas certificate",
      nextVisit: "Today",
      vatTreatment: "Standard 20%",
      vatRateOverride: "",
    });
  }
}

function ensureCoreJob(): Job {
  const existing = getJob(GAS_CERT_TRIAL.jobId);
  if (existing) {
    const patched = updateJob(GAS_CERT_TRIAL.jobId, {
      clientId: GAS_CERT_TRIAL.clientId,
      siteId: GAS_CERT_TRIAL.siteId,
      customer: GAS_CERT_TRIAL.customer,
      site: GAS_CERT_TRIAL.siteAddress,
      description: "Trial boiler service — Field stop/go populates the Core gas service record and certificate preview.",
      manager: GAS_CERT_TRIAL.engineerName,
      status: existing.status === "Completed" || existing.status === "Invoiced" ? existing.status : "In progress",
      next: "Open cost centre → Engineer Flow to review gas record / certificate",
      due: "Today",
    });
    return patched ?? existing;
  }

  return createJob({
    id: GAS_CERT_TRIAL.jobId,
    ref: GAS_CERT_TRIAL.jobRef,
    clientId: GAS_CERT_TRIAL.clientId,
    siteId: GAS_CERT_TRIAL.siteId,
    customer: GAS_CERT_TRIAL.customer,
    site: GAS_CERT_TRIAL.siteAddress,
    description: "Trial boiler service — Field stop/go populates the Core gas service record and certificate preview.",
    manager: GAS_CERT_TRIAL.engineerName,
    status: "In progress",
    health: "blue",
    value: 240,
    next: "Open cost centre → Engineer Flow to review gas record / certificate",
    due: "Today",
  });
}

function ensureHubCostCentresAndSampleEvidence() {
  purgeEmptyFlowStepCompletions({
    jobId: GAS_CERT_TRIAL.jobId,
    costCentreId: GAS_CERT_TRIAL.costCentreId,
    templateName: "Boiler servicing",
    costCentreName: GAS_CERT_TRIAL.costCentreName,
  });
  const hubState = getHubDetailState();
  const centresByJob = { ...((hubState.jobCostCentres ?? {}) as Record<string, unknown[]>) };
  const existingCentres = Array.isArray(centresByJob[GAS_CERT_TRIAL.jobId])
    ? (centresByJob[GAS_CERT_TRIAL.jobId] as Array<Record<string, unknown>>)
    : [];
  const hasMatchingCentre = existingCentres.some((centre) => centre.id === GAS_CERT_TRIAL.costCentreId);
  let changed = false;

  if (!hasMatchingCentre) {
    centresByJob[GAS_CERT_TRIAL.jobId] = gasCertTrialCostCentres();
    changed = true;
  }

  const evidenceStore = {
    ...((hubState.flowStepEvidence ?? {}) as Record<string, EngineerFlowStepEvidenceValue>),
  };
  const completionStore = {
    ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>),
  };

  // Seed / top-up trial LGSR fields so Core certificate preview stays complete.
  // Do not overwrite real engineer-captured values.
  for (const step of boilerServiceFlowTemplate.steps) {
    const key = flowEvidenceKey(GAS_CERT_TRIAL.jobId, GAS_CERT_TRIAL.costCentreId, step.id);
    const sample = SAMPLE_EVIDENCE[step.id] || { text: "Complete", capturedAt: new Date().toISOString() };
    const current = evidenceStore[key];
    const needsSample =
      step.evidence === "Checkbox"
        ? !completionStore[key]
        : !hasCapturedFlowEvidence(step.evidence, current);
    const invalidSample =
      Boolean(current) &&
      Boolean(
        validateFlowStepEvidence({
          label: step.label,
          evidence: step.evidence,
          validation: step.validation,
          value: current,
        }),
      );
    if (needsSample || invalidSample) {
      evidenceStore[key] = sample;
      completionStore[key] = true;
      changed = true;
    }
  }

  if (changed) {
    saveHubDetailState({
      ...hubState,
      jobCostCentres: centresByJob,
      flowStepEvidence: evidenceStore,
      flowStepCompletion: completionStore,
    });
  }
}

let ensured = false;

/** Idempotent: create Core client/site/job + boiler-service cost centre linked to Field J-TRIAL-GAS. */
export function ensureGasCertTrialInCore() {
  if (ensured) return getJob(GAS_CERT_TRIAL.jobId) ?? null;
  ensureClientAndSite();
  const job = ensureCoreJob();
  ensureHubCostCentresAndSampleEvidence();
  ensured = true;
  return job;
}

export function gasCertTrialCoreDeepLink() {
  return `/?job=${encodeURIComponent(GAS_CERT_TRIAL.jobId)}&centre=${encodeURIComponent(GAS_CERT_TRIAL.costCentreId)}&tab=engineer-flow`;
}

import { addClientRecord, addClientSiteRecord, getClients, getClientSites, updateClientRecord, updateClientSiteRecord } from "@/lib/people-data";
import {
  boilerServiceFlowTemplate,
  ensureDayworkVariationCostCentre,
  flowEvidenceKey,
  purgeEmptyFlowStepCompletions,
  type EngineerFlowStepEvidenceValue,
} from "@/lib/engineer-flow";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { createJob, getJob, updateJob, type Job } from "@/lib/workflow-data";

/** Bump to force-clear Field/Core evidence + engineer workflow for this trial. */
export const GAS_CERT_TRIAL_RESET_TOKEN = "chris-lawson-boiler-v1";

export const GAS_CERT_TRIAL = {
  jobId: "job-gas-cert-trial",
  jobRef: "J-TRIAL-GAS",
  scheduleId: "sched-gas-cert-trial",
  costCentreId: "job-gas-cert-trial-boiler-service",
  costCentreName: "Boiler servicing",
  clientId: "client-chris-lawson-boiler",
  siteId: "site-hillside-harrogate",
  /** Display name for the trial job / customer in Core + Field. */
  customer: "Chris Lawson Boiler service",
  siteName: "14 Hillside Avenue",
  siteAddress: "14 Hillside Avenue, Harrogate, HG2 7PL",
  engineerId: "eng-chris",
  engineerName: "Chris Lawson",
  description:
    "Chris Lawson Boiler service — Field stop/go answers populate the Core Landlord Gas Safety Record (CP12/LGSR).",
} as const;

export function gasCertTrialCostCentres() {
  return [
    {
      id: GAS_CERT_TRIAL.costCentreId,
      name: GAS_CERT_TRIAL.costCentreName,
      templateName: "Boiler servicing",
      clientDescription: "Annual boiler service and gas safety checks for Chris Lawson Boiler service.",
      engineerDescription:
        "Complete boiler servicing stop/go on the Field app. Readings and photos populate the Core Landlord Gas Safety Record.",
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
  const existingClient = getClients().find((client) => client.id === GAS_CERT_TRIAL.clientId);
  if (!existingClient) {
    addClientRecord({
      id: GAS_CERT_TRIAL.clientId,
      name: GAS_CERT_TRIAL.customer,
      accountReference: "C-TRIAL-GAS",
      status: "Active",
      primaryContact: "Chris Lawson",
      email: "chris.lawson@trial.example",
      phone: "+44 1423 000000",
      billingAddress: GAS_CERT_TRIAL.siteAddress,
      commercialOwner: GAS_CERT_TRIAL.engineerName,
      notes: "Chris Lawson Boiler service trial. Linked to Field job J-TRIAL-GAS.",
      vatTreatment: "Standard 20%",
      vatRateOverride: "",
    });
  } else {
    updateClientRecord(GAS_CERT_TRIAL.clientId, {
      name: GAS_CERT_TRIAL.customer,
      primaryContact: "Chris Lawson",
      commercialOwner: GAS_CERT_TRIAL.engineerName,
      billingAddress: GAS_CERT_TRIAL.siteAddress,
      notes: "Chris Lawson Boiler service trial. Linked to Field job J-TRIAL-GAS.",
    });
  }

  // Migrate / keep Hillside site on the Chris Lawson trial client.
  const existingSite = getClientSites().find((site) => site.id === GAS_CERT_TRIAL.siteId);
  if (!existingSite) {
    addClientSiteRecord({
      id: GAS_CERT_TRIAL.siteId,
      clientId: GAS_CERT_TRIAL.clientId,
      name: GAS_CERT_TRIAL.siteName,
      address: GAS_CERT_TRIAL.siteAddress,
      accessNotes: "Chris Lawson Boiler service trial site. Safe to complete.",
      primaryContact: "Chris Lawson",
      serviceLine: "Boiler servicing / gas certificate",
      nextVisit: "Today",
      vatTreatment: "Standard 20%",
      vatRateOverride: "",
    });
  } else {
    updateClientSiteRecord(GAS_CERT_TRIAL.siteId, {
      clientId: GAS_CERT_TRIAL.clientId,
      name: GAS_CERT_TRIAL.siteName,
      address: GAS_CERT_TRIAL.siteAddress,
      accessNotes: "Chris Lawson Boiler service trial site. Safe to complete.",
      primaryContact: "Chris Lawson",
      serviceLine: "Boiler servicing / gas certificate",
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
      description: GAS_CERT_TRIAL.description,
      manager: GAS_CERT_TRIAL.engineerName,
      status: existing.status === "Completed" || existing.status === "Invoiced" ? existing.status : "In progress",
      next: "Open cost centre → Engineer Flow to review Landlord Gas Safety Record",
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
    description: GAS_CERT_TRIAL.description,
    manager: GAS_CERT_TRIAL.engineerName,
    status: "In progress",
    health: "blue",
    value: 240,
    next: "Open cost centre → Engineer Flow to review Landlord Gas Safety Record",
    due: "Today",
  });
}

function clearTrialFlowEvidence(hubState: ReturnType<typeof getHubDetailState>) {
  const evidenceStore = {
    ...((hubState.flowStepEvidence ?? {}) as Record<string, EngineerFlowStepEvidenceValue>),
  };
  const completionStore = {
    ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>),
  };
  let changed = false;
  // Only clear boiler-service trial keys — never wipe Daywork Account evidence on the same job.
  const prefix = `${GAS_CERT_TRIAL.jobId}:${GAS_CERT_TRIAL.costCentreId}:`;
  for (const key of Object.keys(evidenceStore)) {
    if (key.startsWith(prefix)) {
      delete evidenceStore[key];
      changed = true;
    }
  }
  for (const key of Object.keys(completionStore)) {
    if (key.startsWith(prefix)) {
      delete completionStore[key];
      changed = true;
    }
  }
  return { evidenceStore, completionStore, changed };
}

function resetEngineerWorkflowForTrial() {
  try {
    const { resetEngineerJobWorkflows } = require("@/lib/engineer-workflow-store") as {
      resetEngineerJobWorkflows: (scheduleIds: string[]) => boolean;
    };
    resetEngineerJobWorkflows([GAS_CERT_TRIAL.scheduleId]);
  } catch {
    // Best-effort; Field will recreate empty workflow on next open.
  }
}

function ensureHubCostCentresAndResetIfNeeded() {
  purgeEmptyFlowStepCompletions({
    jobId: GAS_CERT_TRIAL.jobId,
    costCentreId: GAS_CERT_TRIAL.costCentreId,
    templateName: "Boiler servicing",
    costCentreName: GAS_CERT_TRIAL.costCentreName,
  });

  const hubState = getHubDetailState() as ReturnType<typeof getHubDetailState> & {
    gasCertTrialResetToken?: string;
    jobSchedulePlans?: Record<string, unknown>;
  };
  const centresByJob = { ...((hubState.jobCostCentres ?? {}) as Record<string, unknown[]>) };
  const existingCentres = Array.isArray(centresByJob[GAS_CERT_TRIAL.jobId])
    ? (centresByJob[GAS_CERT_TRIAL.jobId] as Array<Record<string, unknown>>)
    : [];
  const hasMatchingCentre = existingCentres.some((centre) => centre.id === GAS_CERT_TRIAL.costCentreId);
  let changed = false;

  // Keep boiler-service centre, but preserve Daywork / other variation centres on the same job.
  const boilerCentres = gasCertTrialCostCentres() as Array<Record<string, unknown>>;
  const preserved = existingCentres.filter((centre) => {
    const id = String(centre.id || "");
    return id && id !== GAS_CERT_TRIAL.costCentreId && !id.endsWith("-boiler-service");
  });
  const nextCentres = [
    ...boilerCentres,
    ...preserved.filter((centre) => !boilerCentres.some((boiler) => boiler.id === centre.id)),
  ];
  centresByJob[GAS_CERT_TRIAL.jobId] = nextCentres;
  if (JSON.stringify(existingCentres) !== JSON.stringify(nextCentres)) {
    changed = true;
  }

  // Drop Core planner assignments for this job so Field always uses sched-gas-cert-trial (Chris Lawson).
  const plansByJob = { ...((hubState.jobSchedulePlans ?? {}) as Record<string, unknown>) };
  if (plansByJob[GAS_CERT_TRIAL.jobId] !== undefined) {
    delete plansByJob[GAS_CERT_TRIAL.jobId];
    changed = true;
  }

  let evidenceStore = {
    ...((hubState.flowStepEvidence ?? {}) as Record<string, EngineerFlowStepEvidenceValue>),
  };
  let completionStore = {
    ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>),
  };

  const needsReset = hubState.gasCertTrialResetToken !== GAS_CERT_TRIAL_RESET_TOKEN;
  if (needsReset) {
    const cleared = clearTrialFlowEvidence({ ...hubState, flowStepEvidence: evidenceStore, flowStepCompletion: completionStore });
    evidenceStore = cleared.evidenceStore;
    completionStore = cleared.completionStore;
    resetEngineerWorkflowForTrial();
    changed = true;
  }

  // Ensure every boiler-service step key exists as incomplete (no sample fill).
  for (const step of boilerServiceFlowTemplate.steps) {
    const key = flowEvidenceKey(GAS_CERT_TRIAL.jobId, GAS_CERT_TRIAL.costCentreId, step.id);
    if (needsReset && (evidenceStore[key] || completionStore[key])) {
      delete evidenceStore[key];
      delete completionStore[key];
      changed = true;
    }
  }

  if (changed || needsReset) {
    saveHubDetailState({
      ...hubState,
      jobCostCentres: centresByJob,
      jobSchedulePlans: plansByJob,
      flowStepEvidence: evidenceStore,
      flowStepCompletion: completionStore,
      gasCertTrialResetToken: GAS_CERT_TRIAL_RESET_TOKEN,
    });
  }
}

let ensured = false;
let lastResetToken: string | null = null;

/** Idempotent: Core job + Boiler servicing CC for Chris Lawson; resets checklist when token bumps. */
export function ensureGasCertTrialInCore() {
  const tokenChanged = lastResetToken !== GAS_CERT_TRIAL_RESET_TOKEN;
  if (ensured && !tokenChanged) return getJob(GAS_CERT_TRIAL.jobId) ?? null;
  ensureClientAndSite();
  const job = ensureCoreJob();
  ensureHubCostCentresAndResetIfNeeded();
  // Always keep a Daywork Account variation centre available on the trial job.
  try {
    ensureDayworkVariationCostCentre(GAS_CERT_TRIAL.jobId);
  } catch {
    // Best-effort — Field can still create it on first open.
  }
  ensured = true;
  lastResetToken = GAS_CERT_TRIAL_RESET_TOKEN;
  return job;
}

export function gasCertTrialCoreDeepLink() {
  return `/?job=${encodeURIComponent(GAS_CERT_TRIAL.jobId)}&centre=${encodeURIComponent(GAS_CERT_TRIAL.costCentreId)}&tab=engineer-flow`;
}

export function gasCertTrialDayworkDeepLink() {
  return `/?job=${encodeURIComponent(GAS_CERT_TRIAL.jobId)}&centre=${encodeURIComponent(`${GAS_CERT_TRIAL.jobId}-daywork-account`)}&tab=engineer-flow`;
}

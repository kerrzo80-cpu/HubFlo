import { getHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { listSiteAssets, upsertSiteAsset } from "@/lib/site-assets-data";

export type EngineerFlowEvidence = "Photo" | "Text" | "Number" | "Signature" | "Checkbox";

export type EngineerFlowStepEvidenceValue = {
  text?: string;
  numberValue?: string;
  photoName?: string;
  capturedAt?: string;
};

export type FlowRequirementSeed = {
  id: string;
  label: string;
  status: "done" | "missing" | "optional";
  evidence: EngineerFlowEvidence;
  stepId: string;
  costCentreId: string;
  required: boolean;
  stage: string;
  formField?: string;
  value?: EngineerFlowStepEvidenceValue;
};

export type EngineerFlowStep = {
  id: string;
  stage: "Existing Boiler" | "New Boiler" | "Commissioning" | "Handover" | "Gas certificate";
  label: string;
  evidence: EngineerFlowEvidence;
  required: boolean;
  /** Maps into the NeXa gas service record summary. */
  formField?: string;
};

export type EngineerFlowTemplate = {
  id: string;
  name: string;
  appliesTo: string[];
  steps: EngineerFlowStep[];
};

export const boilerServiceFlowTemplate: EngineerFlowTemplate = {
  id: "boiler-service-flow",
  name: "Boiler servicing stop/go · Landlord Gas Safety Record",
  appliesTo: ["Boiler servicing", "Boiler service"],
  steps: [
    {
      id: "service-boiler-photo",
      stage: "Existing Boiler",
      label: "Upload photos of boiler and surrounding area",
      evidence: "Photo",
      required: true,
      formField: "appliancePhoto",
    },
    {
      id: "service-location",
      stage: "Existing Boiler",
      label: "Confirm boiler location",
      evidence: "Text",
      required: true,
      formField: "location",
    },
    {
      id: "service-make-model",
      stage: "Existing Boiler",
      label: "Record boiler make/model",
      evidence: "Text",
      required: true,
      formField: "makeModel",
    },
    {
      id: "service-serial",
      stage: "Existing Boiler",
      label: "Record boiler serial number",
      evidence: "Text",
      required: true,
      formField: "serialNumber",
    },
    {
      id: "service-visual",
      stage: "Commissioning",
      label: "Confirm visual condition of appliance and flue is satisfactory",
      evidence: "Checkbox",
      required: true,
      formField: "visualConditionOk",
    },
    {
      id: "service-flue",
      stage: "Commissioning",
      label: "Complete flue and ventilation checks",
      evidence: "Checkbox",
      required: true,
      formField: "flueVentilationOk",
    },
    {
      id: "service-safety-devices",
      stage: "Commissioning",
      label: "Confirm safety devices are working correctly",
      evidence: "Checkbox",
      required: true,
      formField: "safetyDevicesOk",
    },
    {
      id: "service-operating-pressure",
      stage: "Gas certificate",
      label: "Record operating pressure / heat input",
      evidence: "Text",
      required: true,
      formField: "operatingPressure",
    },
    {
      id: "service-co-reading",
      stage: "Gas certificate",
      label: "Record CO reading (ppm)",
      evidence: "Number",
      required: true,
      formField: "coReading",
    },
    {
      id: "service-ratio",
      stage: "Gas certificate",
      label: "Record combustion ratio / CO₂",
      evidence: "Number",
      required: true,
      formField: "combustionRatio",
    },
    {
      id: "service-safe-to-use",
      stage: "Gas certificate",
      label: "Confirm appliance is safe to use",
      evidence: "Checkbox",
      required: true,
      formField: "applianceSafeToUse",
    },
    {
      id: "service-defects",
      stage: "Gas certificate",
      label: "Defects / remedial notes (or None)",
      evidence: "Text",
      required: true,
      formField: "defects",
    },
    {
      id: "service-next-due",
      stage: "Gas certificate",
      label: "Next safety check due date (YYYY-MM-DD)",
      evidence: "Text",
      required: true,
      formField: "nextServiceDate",
    },
    {
      id: "service-gas-safe-id",
      stage: "Handover",
      label: "Engineer Gas Safe licence / ID card number",
      evidence: "Text",
      required: true,
      formField: "gasSafeLicenceNumber",
    },
    {
      id: "service-customer-signoff",
      stage: "Handover",
      label: "Customer / landlord received-by sign-off",
      evidence: "Signature",
      required: true,
      formField: "customerSignature",
    },
  ],
};

export const boilerReplacementFlowTemplate: EngineerFlowTemplate = {
  id: "boiler-replacement-flow",
  name: "Boiler replacement stop/go flow",
  appliesTo: ["Boiler replacement"],
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

export const generalWorksFlowTemplate: EngineerFlowTemplate = {
  id: "general-works-flow",
  name: "General works evidence flow",
  appliesTo: ["Bathroom refurbishment", "General plumbing", "Heating remedials", "Reactive maintenance", "Heating works"],
  steps: [
    { id: "general-arrival-photo", stage: "Existing Boiler", label: "Upload before photos", evidence: "Photo", required: true },
    { id: "general-site-notes", stage: "Existing Boiler", label: "Confirm site notes and access issues", evidence: "Text", required: true },
    { id: "general-hidden-works", stage: "Commissioning", label: "Capture hidden works / mid-work evidence", evidence: "Photo", required: false },
    { id: "general-completion-photo", stage: "Handover", label: "Upload completion photos", evidence: "Photo", required: true },
    { id: "general-customer-signoff", stage: "Handover", label: "Customer or office sign-off", evidence: "Signature", required: true },
  ],
};

export const DEFAULT_ENGINEER_FLOW_TEMPLATES: EngineerFlowTemplate[] = [
  boilerReplacementFlowTemplate,
  boilerServiceFlowTemplate,
  generalWorksFlowTemplate,
];

export function hasCapturedFlowEvidence(
  evidence: EngineerFlowEvidence,
  value?: EngineerFlowStepEvidenceValue | null,
) {
  if (evidence === "Checkbox") return true;
  return Boolean(
    value?.text?.trim() ||
    value?.numberValue?.trim() ||
    value?.photoName?.trim(),
  );
}

export function flowEvidenceKey(jobId: string, costCentreId: string, stepId: string) {
  return `${jobId}:${costCentreId}:${stepId}`;
}

function asTemplates(value: unknown): EngineerFlowTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EngineerFlowTemplate => Boolean(item && typeof item === "object" && "id" in item && "steps" in item));
}

export function resolveFlowTemplatesFromHub(hubState: HubDetailState = getHubDetailState()): EngineerFlowTemplate[] {
  const fromHub = asTemplates(hubState.engineerFlowTemplates);
  const map = new Map<string, EngineerFlowTemplate>();
  DEFAULT_ENGINEER_FLOW_TEMPLATES.forEach((template) => map.set(template.id, template));
  fromHub.forEach((template) => {
    // Prefer shared boiler-service-flow with gas cert fields when Hub still has the older short list.
    if (template.id === boilerServiceFlowTemplate.id && template.steps.length < boilerServiceFlowTemplate.steps.length) {
      map.set(template.id, boilerServiceFlowTemplate);
      return;
    }
    map.set(template.id, template);
  });
  return Array.from(map.values());
}

export function resolveFlowTemplateForCostCentre(options: {
  templateName?: string;
  costCentreName?: string;
  hubState?: HubDetailState;
}): EngineerFlowTemplate {
  const hubState = options.hubState ?? getHubDetailState();
  const templates = resolveFlowTemplatesFromHub(hubState);
  const assignments = (hubState.costCentreFlowAssignmentDrafts ?? {}) as Record<string, string>;
  const templateName = (options.templateName || options.costCentreName || "").trim();
  const assignedId = templateName ? assignments[templateName] : undefined;
  if (assignedId) {
    const assigned = templates.find((template) => template.id === assignedId);
    if (assigned) return assigned;
  }
  const byApplies = templates.find((template) =>
    template.appliesTo.some((name) => name.toLowerCase() === templateName.toLowerCase()),
  );
  if (byApplies) return byApplies;
  if (/boiler/.test(templateName.toLowerCase()) && /service/.test(templateName.toLowerCase())) {
    return boilerServiceFlowTemplate;
  }
  if (/boiler/.test(templateName.toLowerCase()) && /replace|install|change/.test(templateName.toLowerCase())) {
    return boilerReplacementFlowTemplate;
  }
  return generalWorksFlowTemplate;
}

export function requirementsFromFlowTemplate(options: {
  jobId: string;
  costCentreId: string;
  costCentreName: string;
  templateName?: string;
  hubState?: HubDetailState;
}): FlowRequirementSeed[] {
  const hubState = options.hubState ?? getHubDetailState();
  // Clear empty tap-to-done flags before deriving status.
  if (!options.hubState) {
    purgeEmptyFlowStepCompletions({
      jobId: options.jobId,
      costCentreId: options.costCentreId,
      templateName: options.templateName || options.costCentreName,
      costCentreName: options.costCentreName,
    });
  }
  const freshState = options.hubState ?? getHubDetailState();
  const template = resolveFlowTemplateForCostCentre({
    templateName: options.templateName || options.costCentreName,
    costCentreName: options.costCentreName,
    hubState: freshState,
  });
  const evidenceStore = ((freshState as HubDetailState & { flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue> })
    .flowStepEvidence ?? {}) as Record<string, EngineerFlowStepEvidenceValue>;
  const completionStore = (freshState.flowStepCompletion ?? {}) as Record<string, boolean>;

  return template.steps.map((step) => {
    const key = flowEvidenceKey(options.jobId, options.costCentreId, step.id);
    const value = evidenceStore[key];
    // Empty Field "tap to done" used to set completion without a photo/reading/note.
    // Only treat as done when real evidence exists (checkbox may use completion alone).
    const done =
      step.evidence === "Checkbox"
        ? Boolean(completionStore[key])
        : hasCapturedFlowEvidence(step.evidence, value);
    return {
      id: `${options.jobId}:${options.costCentreId}:${step.id}`,
      label: step.label,
      status: done ? "done" : step.required ? "missing" : "optional",
      evidence: step.evidence,
      stepId: step.id,
      costCentreId: options.costCentreId,
      required: step.required,
      stage: step.stage,
      formField: step.formField,
      value: hasCapturedFlowEvidence(step.evidence, value) || step.evidence === "Checkbox"
        ? value
        : undefined,
    };
  });
}

/** Drop empty stop/go completions left by earlier tap-to-done Field behaviour. */
export function purgeEmptyFlowStepCompletions(options: {
  jobId: string;
  costCentreId: string;
  templateName?: string;
  costCentreName?: string;
}) {
  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
  };
  const template = resolveFlowTemplateForCostCentre({
    templateName: options.templateName || options.costCentreName || "Boiler servicing",
    costCentreName: options.costCentreName || options.templateName || "Boiler servicing",
    hubState,
  });
  const evidenceStore = { ...(hubState.flowStepEvidence ?? {}) };
  const completionStore = { ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>) };
  let changed = false;

  for (const step of template.steps) {
    const key = flowEvidenceKey(options.jobId, options.costCentreId, step.id);
    if (step.evidence === "Checkbox") continue;
    if (!hasCapturedFlowEvidence(step.evidence, evidenceStore[key])) {
      if (completionStore[key]) {
        delete completionStore[key];
        changed = true;
      }
      if (evidenceStore[key] && !hasCapturedFlowEvidence(step.evidence, evidenceStore[key])) {
        delete evidenceStore[key];
        changed = true;
      }
    }
  }

  if (changed) {
    saveHubDetailState({
      ...hubState,
      flowStepEvidence: evidenceStore,
      flowStepCompletion: completionStore,
    });
  }
  return changed;
}

export function writeFlowStepEvidenceToHub(options: {
  jobId: string;
  costCentreId: string;
  stepId: string;
  evidence: EngineerFlowEvidence;
  value?: EngineerFlowStepEvidenceValue;
  actor?: string;
}) {
  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
  };
  const key = flowEvidenceKey(options.jobId, options.costCentreId, options.stepId);
  const capturedAt = new Date().toISOString();
  const nextValue = {
    ...(options.value || {}),
    capturedAt,
  };
  const completed = options.evidence === "Checkbox" || hasCapturedFlowEvidence(options.evidence, nextValue);
  const nextEvidence = {
    ...(hubState.flowStepEvidence ?? {}),
  };
  const nextCompletion = {
    ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>),
  };

  if (completed) {
    nextEvidence[key] = nextValue;
    nextCompletion[key] = true;
  } else {
    delete nextEvidence[key];
    delete nextCompletion[key];
  }

  saveHubDetailState({
    ...hubState,
    flowStepEvidence: nextEvidence,
    flowStepCompletion: nextCompletion,
  });

  return { key, evidence: nextEvidence[key] ?? nextValue };
}

export function clearFlowStepEvidence(options: {
  jobId: string;
  costCentreId: string;
  stepId: string;
}) {
  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
  };
  const key = flowEvidenceKey(options.jobId, options.costCentreId, options.stepId);
  const nextEvidence = { ...(hubState.flowStepEvidence ?? {}) };
  const nextCompletion = { ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>) };
  const changed = Boolean(nextEvidence[key] || nextCompletion[key]);
  delete nextEvidence[key];
  delete nextCompletion[key];
  if (changed) {
    saveHubDetailState({
      ...hubState,
      flowStepEvidence: nextEvidence,
      flowStepCompletion: nextCompletion,
    });
  }
  return changed;
}

export type GasServiceRecord = {
  location?: string;
  makeModel?: string;
  serialNumber?: string;
  appliancePhoto?: string;
  flueVentilationOk?: boolean;
  visualConditionOk?: boolean;
  safetyDevicesOk?: boolean;
  operatingPressure?: string;
  applianceSafeToUse?: boolean;
  coReading?: string;
  combustionRatio?: string;
  defects?: string;
  nextServiceDate?: string;
  customerSignature?: string;
  gasSafeLicenceNumber?: string;
  completedAt?: string;
  populatedFrom: "engineer-app" | "core";
};

export function buildGasServiceRecordFromEvidence(
  jobId: string,
  costCentreId: string,
  hubState: HubDetailState = getHubDetailState(),
): GasServiceRecord | null {
  const template = resolveFlowTemplateForCostCentre({
    templateName: "Boiler servicing",
    hubState,
  });
  if (template.id !== boilerServiceFlowTemplate.id) return null;
  const evidenceStore = ((hubState as HubDetailState & { flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue> })
    .flowStepEvidence ?? {}) as Record<string, EngineerFlowStepEvidenceValue>;

  const record: GasServiceRecord = { populatedFrom: "engineer-app" };
  let any = false;
  const booleanFields = new Set([
    "flueVentilationOk",
    "visualConditionOk",
    "safetyDevicesOk",
    "applianceSafeToUse",
  ]);
  for (const step of template.steps) {
    if (!step.formField) continue;
    const value = evidenceStore[flowEvidenceKey(jobId, costCentreId, step.id)];
    if (!value) continue;
    any = true;
    if (booleanFields.has(step.formField)) {
      (record as Record<string, string | boolean | undefined>)[step.formField] = true;
      record.completedAt = value.capturedAt || record.completedAt;
      continue;
    }
    const text = value.text?.trim() || value.numberValue?.trim() || value.photoName?.trim();
    if (!text) continue;
    (record as Record<string, string | boolean | undefined>)[step.formField] = text;
    record.completedAt = value.capturedAt || record.completedAt;
  }
  return any ? record : null;
}

export function syncGasServiceRecordToSiteAsset(options: {
  siteId?: string;
  clientId?: string;
  record: GasServiceRecord;
}) {
  if (!options.siteId || !options.record.nextServiceDate) return null;
  const assets = listSiteAssets({ siteId: options.siteId, clientId: options.clientId });
  const match =
    assets.find((asset) => asset.type === "Gas appliance" && (!options.record.serialNumber || asset.serialNumber === options.record.serialNumber)) ||
    assets.find((asset) => asset.type === "Gas appliance") ||
    null;

  const today = new Date().toISOString().slice(0, 10);
  const makeModel = options.record.makeModel || "";
  const [make, ...modelParts] = makeModel.split(/\s+/);
  const payload = {
    id: match?.id,
    siteId: options.siteId,
    clientId: options.clientId,
    type: "Gas appliance" as const,
    name: match?.name || makeModel || "Gas appliance",
    make: make || match?.make,
    model: modelParts.join(" ") || match?.model,
    serialNumber: options.record.serialNumber || match?.serialNumber,
    locationNote: options.record.location || match?.locationNote,
    lastServiceDate: today,
    nextServiceDate: options.record.nextServiceDate,
    certificateIssuedAt: today,
    certificateExpiresAt: options.record.nextServiceDate,
    notes: options.record.defects
      ? `Gas service record · defects: ${options.record.defects}`
      : "Gas service record completed via engineer stop/go.",
  };
  return upsertSiteAsset(payload);
}

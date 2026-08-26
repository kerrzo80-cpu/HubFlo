import { getHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import {
  deleteDayworkSheetFromStore,
  getDayworkSheetFromStore,
  listDayworkSheetsFromStore,
  writeDayworkSheetSnapshot,
} from "@/lib/daywork-sheets-store";
import { listSiteAssets, upsertSiteAsset } from "@/lib/site-assets-data";
import { upsertAnnualServiceRecurringPlan } from "@/lib/recurring-data";
import {
  dayworkAccountTotals,
  dayworkSheetKey,
  isDayworkSubmittedToCore,
  mergeDayworkLineUnitCosts,
  parseDayworkLineItems,
  sortDayworkSheetsByNumber,
  totalDayworkLabourHours,
  withDerivedDayworkLineTotals,
  type DayworkAccountRecord,
  type DayworkSheetSnapshot,
} from "@/lib/daywork-account-form";
import { isValidUkOrIsoDate, toUkDateDisplay, ukDateToIso } from "@/lib/uk-date";

export type { DayworkAccountRecord };
export { dayworkAccountTotals };

export type EngineerFlowEvidence = "Photo" | "Text" | "Number" | "Signature" | "Checkbox";

export type EngineerFlowStepValidation = {
  /** Exact digit count, ignoring spaces (e.g. Gas Safe ID = 12). */
  exactDigits?: number;
  /** Minimum non-space character length. */
  minLength?: number;
  /** Maximum non-space character length. */
  maxLength?: number;
  /** Value must match this full-string regex. */
  pattern?: string;
  /** Human hint shown under the input. */
  helpText?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Prefer numeric keyboard where useful. */
  inputMode?: "text" | "numeric" | "decimal";
  /** Controls which mobile input UI to show. */
  inputKind?: "text" | "date" | "digits" | "decimal";
};

export type EngineerFlowStepEvidenceValue = {
  text?: string;
  numberValue?: string;
  photoName?: string;
  photoUrl?: string;
  photoId?: string;
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
  validation?: EngineerFlowStepValidation;
  value?: EngineerFlowStepEvidenceValue;
};

export type EngineerFlowStep = {
  id: string;
  stage: "Existing Boiler" | "New Boiler" | "Commissioning" | "Handover" | "Gas certificate" | "Daywork";
  label: string;
  evidence: EngineerFlowEvidence;
  required: boolean;
  /** Maps into the Blake gas service / daywork record summary. */
  formField?: string;
  validation?: EngineerFlowStepValidation;
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
      label: "Appliance / data plate photo",
      evidence: "Photo",
      required: true,
      formField: "appliancePhoto",
      validation: { helpText: "Required on the Landlord Gas Safety Record.", placeholder: "Take or choose a photo" },
    },
    {
      id: "service-location",
      stage: "Existing Boiler",
      label: "Appliance location",
      evidence: "Text",
      required: true,
      formField: "location",
      validation: { minLength: 2, helpText: "As shown on the LGSR form.", placeholder: "e.g. Kitchen cupboard" },
    },
    {
      id: "service-make-model",
      stage: "Existing Boiler",
      label: "Make / model",
      evidence: "Text",
      required: true,
      formField: "makeModel",
      validation: { minLength: 2, helpText: "As shown on the LGSR form.", placeholder: "e.g. Worcester Greenstar 30i" },
    },
    {
      id: "service-serial",
      stage: "Existing Boiler",
      label: "Serial number",
      evidence: "Text",
      required: true,
      formField: "serialNumber",
      validation: { minLength: 4, helpText: "From the appliance data plate.", placeholder: "Serial number" },
    },
    {
      id: "service-visual",
      stage: "Commissioning",
      label: "Visual condition of appliance & flue satisfactory",
      evidence: "Checkbox",
      required: true,
      formField: "visualConditionOk",
    },
    {
      id: "service-flue",
      stage: "Commissioning",
      label: "Flue & ventilation satisfactory",
      evidence: "Checkbox",
      required: true,
      formField: "flueVentilationOk",
    },
    {
      id: "service-safety-devices",
      stage: "Commissioning",
      label: "Safety devices working correctly",
      evidence: "Checkbox",
      required: true,
      formField: "safetyDevicesOk",
    },
    {
      id: "service-operating-pressure",
      stage: "Gas certificate",
      label: "Operating pressure / heat input",
      evidence: "Text",
      required: true,
      formField: "operatingPressure",
      validation: { minLength: 2, helpText: "Enter the reading shown on the LGSR.", placeholder: "e.g. 20 mbar" },
    },
    {
      id: "service-co-reading",
      stage: "Gas certificate",
      label: "CO reading (ppm)",
      evidence: "Number",
      required: true,
      formField: "coReading",
      validation: {
        pattern: "^\\d{1,4}(?:\\.\\d+)?$",
        inputMode: "decimal",
        inputKind: "decimal",
        helpText: "Numeric CO reading in ppm.",
        placeholder: "e.g. 18",
      },
    },
    {
      id: "service-ratio",
      stage: "Gas certificate",
      label: "CO / CO₂ combustion ratio",
      evidence: "Number",
      required: true,
      formField: "combustionRatio",
      validation: {
        pattern: "^\\d+(?:\\.\\d+)?$",
        inputMode: "decimal",
        inputKind: "decimal",
        helpText: "Combustion ratio from the analyser.",
        placeholder: "e.g. 0.004",
      },
    },
    {
      id: "service-safe-to-use",
      stage: "Gas certificate",
      label: "Appliance safe to use",
      evidence: "Checkbox",
      required: true,
      formField: "applianceSafeToUse",
    },
    {
      id: "service-defects",
      stage: "Gas certificate",
      label: "Defects identified / remedial action",
      evidence: "Text",
      required: true,
      formField: "defects",
      validation: { minLength: 2, helpText: "Enter None if no defects.", placeholder: "None / describe defects" },
    },
    {
      id: "service-next-due",
      stage: "Gas certificate",
      label: "Next safety check due",
      evidence: "Text",
      required: true,
      formField: "nextServiceDate",
      validation: {
        pattern: "^\\d{2}-\\d{2}-\\d{4}$",
        inputKind: "date",
        helpText: "UK date — pick from the calendar (DD-MM-YYYY).",
        placeholder: "DD-MM-YYYY",
      },
    },
    {
      id: "service-gas-safe-id",
      stage: "Handover",
      label: "Gas Safe licence / ID card no.",
      evidence: "Text",
      required: true,
      formField: "gasSafeLicenceNumber",
      validation: {
        exactDigits: 12,
        inputMode: "numeric",
        inputKind: "digits",
        helpText: "Must be exactly 12 digits — cannot save with fewer.",
        placeholder: "12-digit Gas Safe ID",
      },
    },
    {
      id: "service-customer-signoff",
      stage: "Handover",
      label: "Received by (landlord / tenant)",
      evidence: "Signature",
      required: true,
      formField: "customerSignature",
      validation: { minLength: 2, helpText: "Name of person receiving the record.", placeholder: "Signed by…" },
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
    {
      id: "replacement-next-due",
      stage: "Handover",
      label: "Next boiler service due",
      evidence: "Text",
      required: true,
      formField: "nextServiceDate",
      validation: {
        pattern: "^\\d{2}-\\d{2}-\\d{4}$",
        inputKind: "date",
        helpText: "UK date — when the next annual service is due (DD-MM-YYYY). Creates a recurring job for Carol.",
        placeholder: "DD-MM-YYYY",
      },
    },
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

/** Reactive variation daywork sheet — mirrors Errol Watson Group Daywork Account. */
export const dayworkAccountFlowTemplate: EngineerFlowTemplate = {
  id: "daywork-account-flow",
  name: "Daywork account stop/go",
  appliesTo: ["Daywork account", "Daywork"],
  steps: [
    {
      id: "daywork-description",
      stage: "Daywork",
      label: "Description of works",
      evidence: "Text",
      required: true,
      formField: "description",
      validation: { minLength: 4, helpText: "What reactive / variation work was done.", placeholder: "Describe the daywork…" },
    },
    {
      id: "daywork-week-ending",
      stage: "Daywork",
      label: "Week ending",
      evidence: "Text",
      required: true,
      formField: "weekEnding",
      validation: {
        pattern: "^\\d{2}-\\d{2}-\\d{4}$",
        inputKind: "date",
        helpText: "UK date — pick from the calendar (DD-MM-YYYY).",
        placeholder: "DD-MM-YYYY",
      },
    },
    {
      id: "daywork-vo-ref",
      stage: "Daywork",
      label: "Variation reference",
      evidence: "Text",
      required: false,
      formField: "voReference",
      validation: { placeholder: "Optional variation / V.O. number" },
    },
    {
      id: "daywork-labour-name",
      stage: "Daywork",
      label: "Operative name",
      evidence: "Text",
      required: true,
      formField: "labourName",
      validation: { minLength: 2, placeholder: "e.g. Chris Lawson" },
    },
    {
      id: "daywork-labour-trade",
      stage: "Daywork",
      label: "Labour trade",
      evidence: "Text",
      required: true,
      formField: "labourTrade",
      validation: { minLength: 2, helpText: "Plumber, Joiner or Apprentice.", placeholder: "Plumber" },
    },
    {
      id: "daywork-labour-days",
      stage: "Daywork",
      label: "Labour hours by day",
      evidence: "Text",
      required: true,
      formField: "labourDaysJson",
      validation: { minLength: 2, helpText: "Use the Daywork sheet Mon–Sun hours grid.", placeholder: "Mon–Sun hours" },
    },
    {
      id: "daywork-materials",
      stage: "Daywork",
      label: "Materials",
      evidence: "Text",
      required: false,
      formField: "materialsJson",
      validation: { helpText: "Use the Daywork sheet materials list (description + qty).", placeholder: "Materials list" },
    },
    {
      id: "daywork-plant",
      stage: "Daywork",
      label: "Plant",
      evidence: "Text",
      required: false,
      formField: "plantJson",
      validation: { helpText: "Use the Daywork sheet plant list (description + qty).", placeholder: "Plant list" },
    },
    {
      id: "daywork-plumber-name",
      stage: "Handover",
      label: "Plumber / contractor printed name",
      evidence: "Text",
      required: true,
      formField: "plumberSignerName",
      validation: { minLength: 2, helpText: "Printed name — signatures can be hard to read.", placeholder: "Full name…" },
    },
    {
      id: "daywork-plumber-sign",
      stage: "Handover",
      label: "Plumber / contractor signature",
      evidence: "Signature",
      required: true,
      formField: "plumberSignature",
      validation: { minLength: 2, helpText: "Operative signing the Daywork Account.", placeholder: "Signed by plumber…" },
    },
    {
      id: "daywork-client-name",
      stage: "Handover",
      label: "Client / Clerk of Works printed name",
      evidence: "Text",
      required: true,
      formField: "clientSignerName",
      validation: { minLength: 2, helpText: "Printed name of the person signing off.", placeholder: "Full name…" },
    },
    {
      id: "daywork-client-sign",
      stage: "Handover",
      label: "Client / Clerk of Works signature",
      evidence: "Signature",
      required: true,
      formField: "clientSignature",
      validation: { minLength: 2, helpText: "Client or site supervisor sign-off.", placeholder: "Signed by client…" },
    },
  ],
};

export const DEFAULT_ENGINEER_FLOW_TEMPLATES: EngineerFlowTemplate[] = [
  boilerReplacementFlowTemplate,
  boilerServiceFlowTemplate,
  dayworkAccountFlowTemplate,
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

export function validateFlowStepEvidence(options: {
  label: string;
  evidence: EngineerFlowEvidence;
  validation?: EngineerFlowStepValidation;
  value?: EngineerFlowStepEvidenceValue | null;
}): string | null {
  const { label, evidence, validation, value } = options;
  if (evidence === "Checkbox") return null;

  const raw =
    evidence === "Number"
      ? value?.numberValue?.trim() || ""
      : evidence === "Photo"
        ? value?.photoName?.trim() || ""
        : value?.text?.trim() || "";

  if (!raw) {
    if (evidence === "Photo") return `Add a photo for “${label}” before saving.`;
    if (evidence === "Number") return `Enter a number for “${label}” before saving.`;
    return `Enter a value for “${label}” before saving.`;
  }

  if (!validation) return null;

  if (validation.inputKind === "date") {
    if (!isValidUkOrIsoDate(raw)) {
      return `“${label}” must be a valid UK date (DD-MM-YYYY).`;
    }
    return null;
  }

  const compact = raw.replace(/\s+/g, "");
  if (typeof validation.exactDigits === "number") {
    const digits = compact.replace(/\D/g, "");
    if (digits.length !== validation.exactDigits || digits.length !== compact.length) {
      return `“${label}” must be exactly ${validation.exactDigits} digits (you entered ${digits.length || 0}).`;
    }
  }
  if (typeof validation.minLength === "number" && compact.length < validation.minLength) {
    return `“${label}” must be at least ${validation.minLength} characters.`;
  }
  if (typeof validation.maxLength === "number" && compact.length > validation.maxLength) {
    return `“${label}” must be no more than ${validation.maxLength} characters.`;
  }
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(raw) && !regex.test(compact)) {
        return validation.helpText
          ? `“${label}” is not valid. ${validation.helpText}`
          : `“${label}” is not in the required format.`;
      }
    } catch {
      // Ignore invalid patterns in config.
    }
  }
  return null;
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
    if (template.id === dayworkAccountFlowTemplate.id) {
      map.set(template.id, dayworkAccountFlowTemplate);
      return;
    }
    map.set(template.id, template);
  });
  map.set(dayworkAccountFlowTemplate.id, dayworkAccountFlowTemplate);
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
  if (/daywork/.test(templateName.toLowerCase())) {
    return dayworkAccountFlowTemplate;
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
      validation: step.validation,
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
  customerName?: string;
  siteLabel?: string;
  sourceJobId?: string;
  sourceJobRef?: string;
  record: GasServiceRecord;
}) {
  if (!options.siteId || !options.record.nextServiceDate) return null;
  const assets = listSiteAssets({ siteId: options.siteId, clientId: options.clientId });
  const match =
    assets.find((asset) => asset.type === "Gas appliance" && (!options.record.serialNumber || asset.serialNumber === options.record.serialNumber)) ||
    assets.find((asset) => asset.type === "Gas appliance") ||
    null;

  const today = new Date().toISOString().slice(0, 10);
  const nextServiceIso = ukDateToIso(options.record.nextServiceDate || "") || options.record.nextServiceDate;
  if (!nextServiceIso) return null;
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
    nextServiceDate: nextServiceIso,
    certificateIssuedAt: today,
    certificateExpiresAt: nextServiceIso,
    notes: options.record.defects
      ? `Gas service record · defects: ${options.record.defects}`
      : "Gas service record completed via engineer stop/go.",
  };
  const updatedAssets = upsertSiteAsset(payload);
  const saved =
    updatedAssets.find((asset) => asset.id === match?.id) ||
    updatedAssets.find((asset) => asset.serialNumber === payload.serialNumber && asset.nextServiceDate === nextServiceIso) ||
    updatedAssets[0] ||
    null;

  try {
    upsertAnnualServiceRecurringPlan({
      siteId: options.siteId,
      clientId: options.clientId,
      customer: options.customerName || "Customer",
      site: options.siteLabel,
      assetId: saved?.id,
      assetName: saved?.name || makeModel || "boiler",
      nextServiceDate: nextServiceIso,
      sourceJobId: options.sourceJobId,
      sourceJobRef: options.sourceJobRef,
    });
  } catch {
    // Recurring plan sync is best-effort.
  }

  return saved;
}

export function buildDayworkAccountRecordFromEvidence(
  jobId: string,
  costCentreId: string,
  hubState: HubDetailState = getHubDetailState(),
): DayworkAccountRecord | null {
  const template = resolveFlowTemplateForCostCentre({
    templateName: "Daywork account",
    hubState,
  });
  if (template.id !== dayworkAccountFlowTemplate.id) {
    // Still allow reading if this cost centre is daywork by id match of steps.
  }
  const evidenceStore = ((hubState as HubDetailState & { flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue> })
    .flowStepEvidence ?? {}) as Record<string, EngineerFlowStepEvidenceValue>;

  const record: DayworkAccountRecord = { populatedFrom: "engineer-app" };
  let any = false;
  for (const step of dayworkAccountFlowTemplate.steps) {
    if (!step.formField) continue;
    const value = evidenceStore[flowEvidenceKey(jobId, costCentreId, step.id)];
    if (!value) continue;
    const text = value.text?.trim() || value.numberValue?.trim() || value.photoName?.trim();
    if (!text) continue;
    (record as Record<string, string | undefined>)[step.formField] = text;
    record.completedAt = value.capturedAt || record.completedAt;
    any = true;
  }
  for (const [stepId, field] of [
    ["daywork-labour-rate", "labourRate"],
    ["daywork-markup-percent", "markupPercent"],
    ["daywork-labour-hours", "labourHours"],
    ["daywork-materials-cost", "materialsCost"],
    ["daywork-plant-cost", "plantCost"],
  ] as const) {
    const value = evidenceStore[flowEvidenceKey(jobId, costCentreId, stepId)];
    const text = value?.text?.trim() || value?.numberValue?.trim();
    if (!text) continue;
    record[field] = text;
    any = true;
  }
  if (record.labourDaysJson) {
    record.labourHours = String(totalDayworkLabourHours(record) || record.labourHours || "");
  }
  return any ? record : null;
}

/** Write a full Field Daywork sheet draft into hub evidence + variation event. */
export function saveDayworkSheetToHub(options: {
  jobId: string;
  jobRef: string;
  costCentreId: string;
  engineerName: string;
  record: DayworkAccountRecord;
}) {
  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  const evidenceStore = { ...(hubState.flowStepEvidence ?? {}) };
  const completionStore = { ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>) };
  const capturedAt = options.record.completedAt || new Date().toISOString();

  for (const step of dayworkAccountFlowTemplate.steps) {
    if (!step.formField) continue;
    const key = flowEvidenceKey(options.jobId, options.costCentreId, step.id);
    const raw = (options.record as Record<string, string | undefined>)[step.formField];
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      delete evidenceStore[key];
      delete completionStore[key];
      continue;
    }
    evidenceStore[key] = { text, capturedAt };
    completionStore[key] = true;
  }

  // Also store derived total hours for older readers.
  const hoursKey = flowEvidenceKey(options.jobId, options.costCentreId, "daywork-labour-hours");
  const hours = String(totalDayworkLabourHours(options.record) || "");
  if (hours && hours !== "0") {
    evidenceStore[hoursKey] = { text: hours, numberValue: hours, capturedAt };
    completionStore[hoursKey] = true;
  }

  // Preserve any office pricing already set in Core when Field re-saves the sheet.
  const sheetKey = dayworkSheetKey(options.jobId, options.costCentreId);
  const previousSheet = hubState.dayworkSheets?.[sheetKey];
  const materialsJson = mergeDayworkLineUnitCosts(options.record.materialsJson, previousSheet?.materialsJson);
  const plantJson = mergeDayworkLineUnitCosts(options.record.plantJson, previousSheet?.plantJson);
  const priced = withDerivedDayworkLineTotals({
    ...options.record,
    materialsJson,
    plantJson,
    labourRate: options.record.labourRate || previousSheet?.labourRate,
    materialsCost: options.record.materialsCost || previousSheet?.materialsCost,
    plantCost: options.record.plantCost || previousSheet?.plantCost,
    markupPercent: options.record.markupPercent || previousSheet?.markupPercent,
  });
  const snapshot: DayworkSheetSnapshot = {
    ...priced,
    jobId: options.jobId,
    jobRef: options.jobRef,
    costCentreId: options.costCentreId,
    updatedAt: capturedAt,
  };

  // Keep evidence materials/plant JSON in sync with merged unit costs.
  if (materialsJson) {
    const materialsKey = flowEvidenceKey(options.jobId, options.costCentreId, "daywork-materials");
    evidenceStore[materialsKey] = { text: materialsJson, capturedAt };
    completionStore[materialsKey] = true;
  }
  if (plantJson) {
    const plantKey = flowEvidenceKey(options.jobId, options.costCentreId, "daywork-plant");
    evidenceStore[plantKey] = { text: plantJson, capturedAt };
    completionStore[plantKey] = true;
  }

  saveHubDetailState({
    ...hubState,
    flowStepEvidence: evidenceStore,
    flowStepCompletion: completionStore,
    dayworkSheets: {
      ...(hubState.dayworkSheets ?? {}),
      [sheetKey]: snapshot,
    },
  });

  // Dedicated durable store — survives concurrent Core hub PUTs that race Field saves.
  writeDayworkSheetSnapshot(snapshot);

  return syncDayworkAccountToJobVariation({
    ...options,
    record: snapshot,
  });
}

export const DAYWORK_COST_CENTRE_NAME = "Daywork account";
export const DAYWORK_COST_CENTRE_TEMPLATE = "Daywork account";

/** Ensure a variation cost centre for Daywork exists on the job; returns its id. */
export function ensureDayworkVariationCostCentre(jobId: string): string {
  const hubState = getHubDetailState();
  const centresByJob = { ...((hubState.jobCostCentres ?? {}) as Record<string, Array<Record<string, unknown>>>) };
  const centres = Array.isArray(centresByJob[jobId]) ? [...centresByJob[jobId]] : [];
  const existing = centres.find((centre) => {
    const templateName = String(centre.templateName || "").toLowerCase();
    const name = String(centre.name || "").toLowerCase();
    return templateName.includes("daywork") || name.includes("daywork");
  });
  if (existing && typeof existing.id === "string" && existing.id.trim()) {
    return existing.id;
  }

  const sectionsByJob = { ...((hubState.jobVariationSections ?? {}) as Record<string, Array<Record<string, unknown>>>) };
  const sections = Array.isArray(sectionsByJob[jobId]) ? [...sectionsByJob[jobId]] : [];
  let sectionId = sections.find((section) => String(section.name || "").toLowerCase().includes("daywork"))?.id as
    | string
    | undefined;
  if (!sectionId || typeof sectionId !== "string") {
    sectionId = `${jobId}-variation-section-daywork`;
    sections.push({
      id: sectionId,
      name: "Daywork / reactive variations",
      description: "Reactive daywork sheets raised from Field.",
    });
    sectionsByJob[jobId] = sections;
  }

  const costCentreId = `${jobId}-daywork-account`;
  centres.push({
    id: costCentreId,
    name: DAYWORK_COST_CENTRE_NAME,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    variation: true,
    variationSectionId: sectionId,
    clientDescription: "Reactive daywork / variation works recorded on the Daywork Account sheet.",
    engineerDescription:
      "Complete the Daywork Account stop/go on Field — labour, materials and dual sign-off populate Core Variations.",
    materials: [],
    labour: [],
  });
  centresByJob[jobId] = centres;
  saveHubDetailState({
    ...hubState,
    jobCostCentres: centresByJob,
    jobVariationSections: sectionsByJob,
  });
  return costCentreId;
}

/** Create another Daywork variation centre so Field can raise multiple sheets on one job. */
export function createAdditionalDayworkCostCentre(jobId: string): string {
  const primaryId = ensureDayworkVariationCostCentre(jobId);
  const hubState = getHubDetailState();
  const centresByJob = { ...((hubState.jobCostCentres ?? {}) as Record<string, Array<Record<string, unknown>>>) };
  const centres = Array.isArray(centresByJob[jobId]) ? [...centresByJob[jobId]] : [];
  const dayworkCentres = centres.filter((centre) => {
    const templateName = String(centre.templateName || "").toLowerCase();
    const name = String(centre.name || "").toLowerCase();
    return templateName.includes("daywork") || name.includes("daywork");
  });
  const sheets = listDayworkSheetsForJob(jobId);
  // If the primary centre has no signed sheet yet, keep using it instead of spawning empties.
  const primarySheet = sheets.find((sheet) => sheet.costCentreId === primaryId);
  const primarySigned = Boolean(
    primarySheet &&
      String(primarySheet.plumberSignature || "").trim() &&
      String(primarySheet.clientSignature || "").trim(),
  );
  if (!primarySigned && dayworkCentres.length <= 1) {
    return primaryId;
  }

  const nextIndex = dayworkCentres.length + 1;
  const costCentreId = `${jobId}-daywork-account-${nextIndex}`;
  if (centres.some((centre) => centre.id === costCentreId)) {
    return costCentreId;
  }

  const sectionsByJob = { ...((hubState.jobVariationSections ?? {}) as Record<string, Array<Record<string, unknown>>>) };
  const sections = Array.isArray(sectionsByJob[jobId]) ? [...sectionsByJob[jobId]] : [];
  let sectionId = sections.find((section) => String(section.name || "").toLowerCase().includes("daywork"))?.id as
    | string
    | undefined;
  if (!sectionId || typeof sectionId !== "string") {
    sectionId = `${jobId}-variation-section-daywork`;
    sections.push({
      id: sectionId,
      name: "Daywork / reactive variations",
      description: "Reactive daywork sheets raised from Field.",
    });
    sectionsByJob[jobId] = sections;
  }

  centres.push({
    id: costCentreId,
    name: `Daywork account ${nextIndex}`,
    templateName: DAYWORK_COST_CENTRE_TEMPLATE,
    variation: true,
    variationSectionId: sectionId,
    clientDescription: "Additional reactive daywork / variation sheet from Field.",
    engineerDescription:
      "Complete this Daywork Account on Field — labour, materials and dual sign-off populate Core Variations.",
    materials: [],
    labour: [],
  });
  centresByJob[jobId] = centres;
  saveHubDetailState({
    ...hubState,
    jobCostCentres: centresByJob,
    jobVariationSections: sectionsByJob,
  });
  return costCentreId;
}

/** Upsert a Core variation delivery event from a signed Daywork Account record. */
export function syncDayworkAccountToJobVariation(options: {
  jobId: string;
  jobRef: string;
  costCentreId: string;
  engineerName: string;
  record: DayworkAccountRecord;
}) {
  const bothSigned = Boolean(options.record.plumberSignature?.trim() && options.record.clientSignature?.trim());
  if (!bothSigned && !options.record.description?.trim()) return null;

  const totals = dayworkAccountTotals(options.record);
  const materialsSummary = parseDayworkLineItems(options.record.materialsJson)
    .map((item) => `${item.description || "Item"}${item.qty ? ` × ${item.qty}` : ""}`)
    .join("; ");
  const plantSummary = parseDayworkLineItems(options.record.plantJson)
    .map((item) => `${item.description || "Item"}${item.qty ? ` × ${item.qty}` : ""}`)
    .join("; ");
  const combinedMaterials = [materialsSummary, plantSummary ? `Plant: ${plantSummary}` : ""]
    .filter(Boolean)
    .join(" · ");
  const labourHours = totalDayworkLabourHours(options.record) || totals.labourHours;

  const hubState = getHubDetailState();
  const events = Array.isArray(hubState.jobDeliveryEvents)
    ? ([...hubState.jobDeliveryEvents] as Array<Record<string, unknown>>)
    : [];
  const eventId = `daywork-${options.jobId}-${options.costCentreId}`;
  const existingIndex = events.findIndex((event) => event.id === eventId);
  const summary =
    options.record.description?.trim() ||
    `Daywork account${options.record.voReference ? ` · ${options.record.voReference}` : ""}`;

  const actorName =
    options.engineerName?.trim() ||
    options.record.labourName?.trim() ||
    "Field";

  const nextEvent: Record<string, unknown> = {
    id: eventId,
    jobId: options.jobId,
    jobRef: options.jobRef,
    kind: "variation",
    actor: actorName,
    summary,
    createdAt:
      existingIndex >= 0 && typeof events[existingIndex]?.createdAt === "string"
        ? events[existingIndex].createdAt
        : new Date().toISOString(),
    hours: labourHours || undefined,
    materials: combinedMaterials || undefined,
    materialsJson: options.record.materialsJson,
    plantJson: options.record.plantJson,
    description: options.record.description,
    // Cost/sell filled once office sets labour rate + materials/plant costs in Core.
    costValue: Math.round(totals.total * 100) / 100 || 0,
    sellValue: Math.round(totals.total * 100) / 100 || 0,
    reason: "Daywork account",
    requiresClientApproval: true,
    clientApprovalStatus: bothSigned ? "Viewed" : "Not sent",
    status: bothSigned ? (totals.total > 0 ? "Priced" : "Office review") : "Draft",
    source: "Engineer app",
    costCentreId: options.costCentreId,
    formType: "daywork",
    plumberSignature: options.record.plumberSignature,
    clientSignature: options.record.clientSignature,
    plumberSignerName: options.record.plumberSignerName,
    clientSignerName: options.record.clientSignerName,
    weekEnding: options.record.weekEnding,
    labourTrade: options.record.labourTrade,
    labourDaysJson: options.record.labourDaysJson,
    labourRate: options.record.labourRate,
    materialsCost: options.record.materialsCost,
    plantCost: options.record.plantCost,
  };

  if (existingIndex >= 0) {
    events[existingIndex] = { ...events[existingIndex], ...nextEvent };
  } else {
    events.unshift(nextEvent);
  }

  saveHubDetailState({
    ...hubState,
    jobDeliveryEvents: events,
  });
  return nextEvent;
}

function collectDayworkJobCentrePairs(hubState: HubDetailState): Array<{ jobId: string; costCentreId: string }> {
  const pairs = new Map<string, { jobId: string; costCentreId: string }>();
  const centresByJob = (hubState.jobCostCentres ?? {}) as Record<string, Array<Record<string, unknown>>>;

  for (const [jobId, centres] of Object.entries(centresByJob)) {
    if (!Array.isArray(centres)) continue;
    for (const centre of centres) {
      const costCentreId = typeof centre.id === "string" ? centre.id.trim() : "";
      if (!costCentreId) continue;
      const isDaywork =
        costCentreId.includes("daywork") ||
        /daywork/i.test(String(centre.name || "")) ||
        /daywork/i.test(String(centre.templateName || ""));
      if (!isDaywork) continue;
      pairs.set(`${jobId}::${costCentreId}`, { jobId, costCentreId });
    }
  }

  const evidenceStore = (hubState.flowStepEvidence ?? {}) as Record<string, unknown>;
  const dayworkStepIds = new Set([
    ...dayworkAccountFlowTemplate.steps.map((step) => step.id),
    "daywork-labour-hours",
    "daywork-labour-rate",
    "daywork-markup-percent",
  ]);

  for (const key of Object.keys(evidenceStore)) {
    const stepId = dayworkAccountFlowTemplate.steps.find((step) => key.endsWith(`:${step.id}`))?.id
      || (key.endsWith(":daywork-labour-hours")
        ? "daywork-labour-hours"
        : key.endsWith(":daywork-labour-rate")
          ? "daywork-labour-rate"
          : key.endsWith(":daywork-markup-percent")
            ? "daywork-markup-percent"
            : "");
    if (!stepId || !dayworkStepIds.has(stepId)) continue;
    const suffix = `:${stepId}`;
    if (!key.endsWith(suffix)) continue;
    const withoutStep = key.slice(0, -suffix.length);
    const separator = withoutStep.lastIndexOf(":");
    if (separator <= 0) continue;
    const jobId = withoutStep.slice(0, separator);
    const costCentreId = withoutStep.slice(separator + 1);
    if (!jobId || !costCentreId) continue;
    pairs.set(`${jobId}::${costCentreId}`, { jobId, costCentreId });
  }

  return Array.from(pairs.values());
}

/**
 * Rebuild Daywork variation cards from durable sheet snapshots + flow evidence.
 * Protects against stale Core PUTs wiping jobDeliveryEvents.
 */
export function reconcileDayworkVariationsFromEvidence() {
  const hubState = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  // Seed hub dayworkSheets from the dedicated durable store first.
  const storeSheets = listDayworkSheetsFromStore();
  if (storeSheets.length) {
    const nextSheets = { ...(hubState.dayworkSheets ?? {}) };
    let changed = false;
    for (const sheet of storeSheets) {
      const key = dayworkSheetKey(sheet.jobId, sheet.costCentreId);
      if (!nextSheets[key] || String(nextSheets[key]?.updatedAt || "") < String(sheet.updatedAt || "")) {
        nextSheets[key] = sheet;
        changed = true;
      }
    }
    if (changed) {
      saveHubDetailState({
        ...hubState,
        dayworkSheets: nextSheets,
      });
    }
  }

  const fresh = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  const events = Array.isArray(fresh.jobDeliveryEvents)
    ? (fresh.jobDeliveryEvents as Array<Record<string, unknown>>)
    : [];
  const jobRefById = new Map<string, string>();
  for (const event of events) {
    if (typeof event.jobId === "string" && typeof event.jobRef === "string" && event.jobRef.trim()) {
      jobRefById.set(event.jobId, event.jobRef.trim());
    }
  }

  const rebuilt: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const sheet of Object.values(fresh.dayworkSheets ?? {})) {
    if (!sheet?.jobId || !sheet?.costCentreId) continue;
    try {
      ensureDayworkVariationCostCentre(sheet.jobId);
    } catch {
      // Best-effort.
    }
    restoreDayworkEvidenceFromSnapshot(sheet);
    writeDayworkSheetSnapshot(sheet);
    const event = syncDayworkAccountToJobVariation({
      jobId: sheet.jobId,
      jobRef: sheet.jobRef || jobRefById.get(sheet.jobId) || sheet.jobId,
      costCentreId: sheet.costCentreId,
      engineerName: sheet.labourName || sheet.plumberSignerName || "Field",
      record: sheet,
    });
    if (event) rebuilt.push(event);
    seen.add(`${sheet.jobId}::${sheet.costCentreId}`);
  }

  for (const { jobId, costCentreId } of collectDayworkJobCentrePairs(fresh)) {
    if (seen.has(`${jobId}::${costCentreId}`)) continue;
    try {
      ensureDayworkVariationCostCentre(jobId);
    } catch {
      // Best-effort.
    }
    const record = buildDayworkAccountRecordFromEvidence(jobId, costCentreId);
    if (!record) continue;
    const event = syncDayworkAccountToJobVariation({
      jobId,
      jobRef: jobRefById.get(jobId) || jobId,
      costCentreId,
      engineerName: record.labourName || record.plumberSignerName || "Field",
      record,
    });
    if (event) rebuilt.push(event);
  }
  return rebuilt;
}

function restoreDayworkEvidenceFromSnapshot(sheet: DayworkSheetSnapshot) {
  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
  };
  const evidenceStore = { ...(hubState.flowStepEvidence ?? {}) };
  const completionStore = { ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>) };
  const capturedAt = sheet.updatedAt || sheet.completedAt || new Date().toISOString();
  let changed = false;

  for (const step of dayworkAccountFlowTemplate.steps) {
    if (!step.formField) continue;
    const key = flowEvidenceKey(sheet.jobId, sheet.costCentreId, step.id);
    const raw = (sheet as Record<string, string | undefined>)[step.formField];
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    const existing = evidenceStore[key];
    if (existing?.text?.trim() === text) continue;
    evidenceStore[key] = { text, capturedAt };
    completionStore[key] = true;
    changed = true;
  }

  for (const [stepId, field] of [
    ["daywork-labour-rate", "labourRate"],
    ["daywork-materials-cost", "materialsCost"],
    ["daywork-plant-cost", "plantCost"],
    ["daywork-markup-percent", "markupPercent"],
    ["daywork-labour-hours", "labourHours"],
  ] as const) {
    const raw = sheet[field];
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    const key = flowEvidenceKey(sheet.jobId, sheet.costCentreId, stepId);
    if (evidenceStore[key]?.text?.trim() === text || evidenceStore[key]?.numberValue?.trim() === text) continue;
    evidenceStore[key] = { text, numberValue: text, capturedAt };
    completionStore[key] = true;
    changed = true;
  }

  if (!changed) return;
  saveHubDetailState({
    ...hubState,
    flowStepEvidence: evidenceStore,
    flowStepCompletion: completionStore,
  });
}

/** Office pricing for a Daywork sheet — labour rate + per-line materials/plant £. */
export function saveDayworkOfficePricing(options: {
  jobId: string;
  jobRef: string;
  costCentreId: string;
  labourRate?: string;
  materialsCost?: string;
  plantCost?: string;
  markupPercent?: string;
  materialsJson?: string;
  plantJson?: string;
}) {
  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  const sheetKey = dayworkSheetKey(options.jobId, options.costCentreId);
  const existingSheet = hubState.dayworkSheets?.[sheetKey];
  const fromEvidence = buildDayworkAccountRecordFromEvidence(options.jobId, options.costCentreId, hubState);
  const materialsJson =
    options.materialsJson?.trim() ||
    existingSheet?.materialsJson ||
    fromEvidence?.materialsJson ||
    "";
  const plantJson =
    options.plantJson?.trim() || existingSheet?.plantJson || fromEvidence?.plantJson || "";
  const base = withDerivedDayworkLineTotals({
    populatedFrom: "core",
    ...(fromEvidence || {}),
    ...(existingSheet || {}),
    materialsJson,
    plantJson,
    labourRate: options.labourRate?.trim() ?? existingSheet?.labourRate ?? fromEvidence?.labourRate,
    markupPercent: options.markupPercent?.trim() ?? existingSheet?.markupPercent ?? fromEvidence?.markupPercent,
    materialsCost: options.materialsCost?.trim() || undefined,
    plantCost: options.plantCost?.trim() || undefined,
  });

  const capturedAt = new Date().toISOString();
  const evidenceStore = { ...(hubState.flowStepEvidence ?? {}) };
  const completionStore = { ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>) };
  for (const [stepId, value] of [
    ["daywork-labour-rate", base.labourRate],
    ["daywork-materials", base.materialsJson],
    ["daywork-plant", base.plantJson],
    ["daywork-materials-cost", base.materialsCost],
    ["daywork-plant-cost", base.plantCost],
    ["daywork-markup-percent", base.markupPercent],
  ] as const) {
    const key = flowEvidenceKey(options.jobId, options.costCentreId, stepId);
    const text = String(value || "").trim();
    if (!text) {
      delete evidenceStore[key];
      delete completionStore[key];
      continue;
    }
    evidenceStore[key] = { text, numberValue: text, capturedAt };
    completionStore[key] = true;
  }

  const snapshot: DayworkSheetSnapshot = {
    ...base,
    jobId: options.jobId,
    jobRef: options.jobRef || existingSheet?.jobRef || options.jobId,
    costCentreId: options.costCentreId,
    updatedAt: capturedAt,
  };

  saveHubDetailState({
    ...hubState,
    flowStepEvidence: evidenceStore,
    flowStepCompletion: completionStore,
    dayworkSheets: {
      ...(hubState.dayworkSheets ?? {}),
      [sheetKey]: snapshot,
    },
  });
  writeDayworkSheetSnapshot(snapshot);

  return syncDayworkAccountToJobVariation({
    jobId: options.jobId,
    jobRef: snapshot.jobRef,
    costCentreId: options.costCentreId,
    engineerName: snapshot.labourName || snapshot.plumberSignerName || "Field",
    record: snapshot,
  });
}

export function listDayworkSheetsForJob(jobId: string): DayworkSheetSnapshot[] {
  const fromHub = getHubDetailState() as HubDetailState & {
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  const fromStore = (() => {
    try {
      return listDayworkSheetsFromStore(jobId);
    } catch {
      return [] as DayworkSheetSnapshot[];
    }
  })();
  const byKey = new Map<string, DayworkSheetSnapshot>();
  for (const sheet of Object.values(fromHub.dayworkSheets ?? {})) {
    if (sheet?.jobId === jobId) byKey.set(dayworkSheetKey(sheet.jobId, sheet.costCentreId), sheet);
  }
  for (const sheet of fromStore) {
    byKey.set(dayworkSheetKey(sheet.jobId, sheet.costCentreId), sheet);
  }
  // Include additional Daywork centres opened by mistake (no sheet yet) so Field can Discard them.
  // Primary `…-daywork-account` only appears once a real sheet exists.
  const centresByJob = (fromHub.jobCostCentres ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const centres = Array.isArray(centresByJob[jobId]) ? centresByJob[jobId] : [];
  const primaryId = `${jobId}-daywork-account`;
  for (const centre of centres) {
    const costCentreId = typeof centre.id === "string" ? centre.id.trim() : "";
    if (!costCentreId || costCentreId === primaryId) continue;
    const isDaywork =
      costCentreId.includes("daywork") ||
      /daywork/i.test(String(centre.name || "")) ||
      /daywork/i.test(String(centre.templateName || ""));
    if (!isDaywork) continue;
    const key = dayworkSheetKey(jobId, costCentreId);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      populatedFrom: "engineer-app",
      jobId,
      jobRef: jobId,
      costCentreId,
      updatedAt: "",
    });
  }
  return sortDayworkSheetsByNumber(jobId, Array.from(byKey.values()));
}

/**
 * Discard an unsigned Daywork sheet opened by mistake — removes sheet, evidence,
 * variation event, and additional Daywork cost centres so Mark complete is not blocked.
 */
export function discardUnsignedDayworkSheet(options: {
  jobId: string;
  costCentreId: string;
}): { discarded: boolean; reason?: string } {
  const costCentreId = options.costCentreId.trim();
  if (!costCentreId) return { discarded: false, reason: "Missing Daywork cost centre." };

  const existing =
    listDayworkSheetsForJob(options.jobId).find((sheet) => sheet.costCentreId === costCentreId) ||
    getDayworkSheetFromStore(options.jobId, costCentreId);
  if (existing && isDayworkSubmittedToCore(existing)) {
    return { discarded: false, reason: "Submitted Daywork sheets cannot be discarded on Field." };
  }

  const hubState = getHubDetailState() as HubDetailState & {
    flowStepEvidence?: Record<string, EngineerFlowStepEvidenceValue>;
    dayworkSheets?: Record<string, DayworkSheetSnapshot>;
  };
  const sheetKey = dayworkSheetKey(options.jobId, costCentreId);
  const nextSheets = { ...(hubState.dayworkSheets ?? {}) };
  delete nextSheets[sheetKey];

  const evidenceStore = { ...(hubState.flowStepEvidence ?? {}) };
  const completionStore = { ...((hubState.flowStepCompletion ?? {}) as Record<string, boolean>) };
  const prefix = `${options.jobId}:${costCentreId}:`;
  for (const key of Object.keys(evidenceStore)) {
    if (key.startsWith(prefix)) delete evidenceStore[key];
  }
  for (const key of Object.keys(completionStore)) {
    if (key.startsWith(prefix)) delete completionStore[key];
  }

  const events = Array.isArray(hubState.jobDeliveryEvents)
    ? ([...hubState.jobDeliveryEvents] as Array<Record<string, unknown>>).filter(
        (event) => event.id !== `daywork-${options.jobId}-${costCentreId}`,
      )
    : [];

  const centresByJob = { ...((hubState.jobCostCentres ?? {}) as Record<string, Array<Record<string, unknown>>>) };
  const centres = Array.isArray(centresByJob[options.jobId]) ? [...centresByJob[options.jobId]] : [];
  const primaryId = `${options.jobId}-daywork-account`;
  // Always drop additional numbered centres; keep the primary centre shell if it exists.
  const nextCentres =
    costCentreId === primaryId
      ? centres
      : centres.filter((centre) => String(centre.id || "") !== costCentreId);
  centresByJob[options.jobId] = nextCentres;

  saveHubDetailState({
    ...hubState,
    flowStepEvidence: evidenceStore,
    flowStepCompletion: completionStore,
    dayworkSheets: nextSheets,
    jobDeliveryEvents: events,
    jobCostCentres: centresByJob,
  });

  try {
    deleteDayworkSheetFromStore(options.jobId, costCentreId);
  } catch {
    // Hub state is the source of truth for Field list; durable store is best-effort.
  }

  return { discarded: true };
}

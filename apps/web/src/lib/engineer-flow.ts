import { getHubDetailState, saveHubDetailState, type HubDetailState } from "@/lib/hub-detail-store";
import { listSiteAssets, upsertSiteAsset } from "@/lib/site-assets-data";
import { isValidUkOrIsoDate, toUkDateDisplay, ukDateToIso } from "@/lib/uk-date";

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
  /** Maps into the NeXa gas service / daywork record summary. */
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
      label: "V.O. / variation reference",
      evidence: "Text",
      required: false,
      formField: "voReference",
      validation: { placeholder: "Optional V.O. number" },
    },
    {
      id: "daywork-labour-name",
      stage: "Daywork",
      label: "Labour — operative name",
      evidence: "Text",
      required: true,
      formField: "labourName",
      validation: { minLength: 2, placeholder: "e.g. Chris Lawson" },
    },
    {
      id: "daywork-labour-trade",
      stage: "Daywork",
      label: "Labour — trade",
      evidence: "Text",
      required: true,
      formField: "labourTrade",
      validation: { minLength: 2, placeholder: "e.g. Plumber" },
    },
    {
      id: "daywork-labour-hours",
      stage: "Daywork",
      label: "Labour — hours",
      evidence: "Number",
      required: true,
      formField: "labourHours",
      validation: {
        pattern: "^\\d+(?:\\.\\d{1,2})?$",
        inputMode: "decimal",
        inputKind: "decimal",
        helpText: "Total hours for this sheet.",
        placeholder: "e.g. 3.5",
      },
    },
    {
      id: "daywork-labour-rate",
      stage: "Daywork",
      label: "Labour — hourly rate (£)",
      evidence: "Number",
      required: true,
      formField: "labourRate",
      validation: {
        pattern: "^\\d+(?:\\.\\d{1,2})?$",
        inputMode: "decimal",
        inputKind: "decimal",
        helpText: "Cost rate per hour.",
        placeholder: "e.g. 45.00",
      },
    },
    {
      id: "daywork-labour-expenses",
      stage: "Daywork",
      label: "Labour — expenses (£)",
      evidence: "Number",
      required: false,
      formField: "labourExpenses",
      validation: {
        pattern: "^\\d+(?:\\.\\d{1,2})?$",
        inputMode: "decimal",
        inputKind: "decimal",
        placeholder: "Optional",
      },
    },
    {
      id: "daywork-material-1-desc",
      stage: "Daywork",
      label: "Material 1 — description",
      evidence: "Text",
      required: false,
      formField: "material1Description",
      validation: { placeholder: "e.g. 15mm isolation valve" },
    },
    {
      id: "daywork-material-1-qty",
      stage: "Daywork",
      label: "Material 1 — quantity",
      evidence: "Number",
      required: false,
      formField: "material1Qty",
      validation: { pattern: "^\\d+(?:\\.\\d{1,2})?$", inputMode: "decimal", inputKind: "decimal", placeholder: "Qty" },
    },
    {
      id: "daywork-material-1-price",
      stage: "Daywork",
      label: "Material 1 — unit price (£)",
      evidence: "Number",
      required: false,
      formField: "material1UnitPrice",
      validation: { pattern: "^\\d+(?:\\.\\d{1,2})?$", inputMode: "decimal", inputKind: "decimal", placeholder: "Unit £" },
    },
    {
      id: "daywork-material-2-desc",
      stage: "Daywork",
      label: "Material 2 — description",
      evidence: "Text",
      required: false,
      formField: "material2Description",
      validation: { placeholder: "Optional second material" },
    },
    {
      id: "daywork-material-2-qty",
      stage: "Daywork",
      label: "Material 2 — quantity",
      evidence: "Number",
      required: false,
      formField: "material2Qty",
      validation: { pattern: "^\\d+(?:\\.\\d{1,2})?$", inputMode: "decimal", inputKind: "decimal", placeholder: "Qty" },
    },
    {
      id: "daywork-material-2-price",
      stage: "Daywork",
      label: "Material 2 — unit price (£)",
      evidence: "Number",
      required: false,
      formField: "material2UnitPrice",
      validation: { pattern: "^\\d+(?:\\.\\d{1,2})?$", inputMode: "decimal", inputKind: "decimal", placeholder: "Unit £" },
    },
    {
      id: "daywork-plant-desc",
      stage: "Daywork",
      label: "Plant — description",
      evidence: "Text",
      required: false,
      formField: "plantDescription",
      validation: { placeholder: "Optional plant / equipment" },
    },
    {
      id: "daywork-plant-hours",
      stage: "Daywork",
      label: "Plant — hours",
      evidence: "Number",
      required: false,
      formField: "plantHours",
      validation: { pattern: "^\\d+(?:\\.\\d{1,2})?$", inputMode: "decimal", inputKind: "decimal", placeholder: "Hours" },
    },
    {
      id: "daywork-plant-rate",
      stage: "Daywork",
      label: "Plant — rate (£/hr)",
      evidence: "Number",
      required: false,
      formField: "plantRate",
      validation: { pattern: "^\\d+(?:\\.\\d{1,2})?$", inputMode: "decimal", inputKind: "decimal", placeholder: "Rate £" },
    },
    {
      id: "daywork-markup-percent",
      stage: "Daywork",
      label: "Materials / plant add %",
      evidence: "Number",
      required: false,
      formField: "markupPercent",
      validation: {
        pattern: "^\\d+(?:\\.\\d{1,2})?$",
        inputMode: "decimal",
        inputKind: "decimal",
        helpText: "Markup % applied to materials and plant on the daywork total.",
        placeholder: "e.g. 20",
      },
    },
    {
      id: "daywork-works-photo",
      stage: "Daywork",
      label: "Works photo",
      evidence: "Photo",
      required: false,
      formField: "worksPhoto",
      validation: { helpText: "Optional photo of completed daywork.", placeholder: "Take or choose a photo" },
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
    if (template.id === dayworkAccountFlowTemplate.id && template.steps.length < dayworkAccountFlowTemplate.steps.length) {
      map.set(template.id, dayworkAccountFlowTemplate);
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
  return upsertSiteAsset(payload);
}

export type DayworkAccountRecord = {
  description?: string;
  weekEnding?: string;
  voReference?: string;
  labourName?: string;
  labourTrade?: string;
  labourHours?: string;
  labourRate?: string;
  labourExpenses?: string;
  material1Description?: string;
  material1Qty?: string;
  material1UnitPrice?: string;
  material2Description?: string;
  material2Qty?: string;
  material2UnitPrice?: string;
  plantDescription?: string;
  plantHours?: string;
  plantRate?: string;
  markupPercent?: string;
  worksPhoto?: string;
  plumberSignature?: string;
  clientSignature?: string;
  completedAt?: string;
  populatedFrom: "engineer-app" | "core";
};

function parseMoney(value?: string) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function dayworkAccountTotals(record: DayworkAccountRecord | null | undefined) {
  const labourHours = parseMoney(record?.labourHours);
  const labourRate = parseMoney(record?.labourRate);
  const labourCost = labourHours * labourRate;
  const expenses = parseMoney(record?.labourExpenses);
  const material1 = parseMoney(record?.material1Qty) * parseMoney(record?.material1UnitPrice);
  const material2 = parseMoney(record?.material2Qty) * parseMoney(record?.material2UnitPrice);
  const materials = material1 + material2;
  const plant = parseMoney(record?.plantHours) * parseMoney(record?.plantRate);
  const markupPercent = parseMoney(record?.markupPercent);
  const materialsWithMarkup = materials * (1 + markupPercent / 100);
  const plantWithMarkup = plant * (1 + markupPercent / 100);
  const expensesWithMarkup = expenses * (1 + markupPercent / 100);
  const total = labourCost + expensesWithMarkup + materialsWithMarkup + plantWithMarkup;
  return {
    labourHours,
    labourCost,
    expenses,
    materials,
    plant,
    markupPercent,
    materialsWithMarkup,
    plantWithMarkup,
    expensesWithMarkup,
    total,
  };
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
  return any ? record : null;
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
  const materialsSummary = [
    options.record.material1Description
      ? `${options.record.material1Description} × ${options.record.material1Qty || "1"} @ £${options.record.material1UnitPrice || "0"}`
      : "",
    options.record.material2Description
      ? `${options.record.material2Description} × ${options.record.material2Qty || "1"} @ £${options.record.material2UnitPrice || "0"}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

  const hubState = getHubDetailState();
  const events = Array.isArray(hubState.jobDeliveryEvents)
    ? ([...hubState.jobDeliveryEvents] as Array<Record<string, unknown>>)
    : [];
  const eventId = `daywork-${options.jobId}-${options.costCentreId}`;
  const existingIndex = events.findIndex((event) => event.id === eventId);
  const summary =
    options.record.description?.trim() ||
    `Daywork account${options.record.voReference ? ` · V.O. ${options.record.voReference}` : ""}`;

  const nextEvent: Record<string, unknown> = {
    id: eventId,
    jobId: options.jobId,
    jobRef: options.jobRef,
    kind: "variation",
    actor: options.record.plumberSignature || options.engineerName,
    summary,
    createdAt:
      existingIndex >= 0 && typeof events[existingIndex]?.createdAt === "string"
        ? events[existingIndex].createdAt
        : new Date().toISOString(),
    hours: totals.labourHours || undefined,
    materials: materialsSummary || undefined,
    costValue: Math.round(totals.total * 100) / 100,
    sellValue: Math.round(totals.total * 100) / 100,
    reason: "Daywork account",
    requiresClientApproval: true,
    clientApprovalStatus: bothSigned ? "Viewed" : "Not sent",
    status: bothSigned ? "Office review" : "Draft",
    source: "Engineer app",
    costCentreId: options.costCentreId,
    formType: "daywork",
    plumberSignature: options.record.plumberSignature,
    clientSignature: options.record.clientSignature,
    weekEnding: options.record.weekEnding,
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

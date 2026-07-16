import {
  reviewSurveyCompletion,
  type EstimateGenerationRun,
  type EstimateLabourLine,
  type EstimateMaterialLine,
  type EstimateTrade,
  type PricingProfile,
  type SurveyEquipmentItem,
  type SurveyPipeRun,
  type SurveyRecord,
  type SurveyScopeItem,
} from "./survey-estimator";

export type MaterialAssemblyItemTemplate = {
  key: string;
  description: string;
  trade: EstimateTrade;
  unit: string;
  quantityBasis: "Scope quantity" | "Fixed" | "Measured run" | "Design dependent";
};

export type MaterialAssembly = {
  id: string;
  name: string;
  taskPatterns: string[];
  items: MaterialAssemblyItemTemplate[];
};

export const seededMaterialAssemblies: MaterialAssembly[] = [
  {
    id: "relocate-boiler-v1",
    name: "Relocate existing boiler",
    taskPatterns: ["relocate boiler", "boiler relocation", "relocate existing atag"],
    items: [
      { key: "service-pipework", description: "Service pipework from measured survey runs", trade: "Plumbing/Heating", unit: "m", quantityBasis: "Measured run" },
      { key: "flue", description: "Manufacturer-specific flue components", trade: "Plumbing/Heating", unit: "item", quantityBasis: "Design dependent" },
      { key: "cleaner", description: "System cleaner", trade: "Plumbing/Heating", unit: "bottle", quantityBasis: "Fixed" },
      { key: "inhibitor", description: "System inhibitor", trade: "Plumbing/Heating", unit: "bottle", quantityBasis: "Fixed" },
      { key: "controls", description: "Controls and electrical alterations", trade: "Electrical", unit: "item", quantityBasis: "Design dependent" },
    ],
  },
  {
    id: "install-radiator-v1",
    name: "Install radiator",
    taskPatterns: ["install radiator", "replace radiator", "radiator installation"],
    items: [
      { key: "radiator", description: "Radiator of confirmed output and dimensions", trade: "Plumbing/Heating", unit: "each", quantityBasis: "Scope quantity" },
      { key: "valves", description: "Radiator valve set", trade: "Plumbing/Heating", unit: "set", quantityBasis: "Scope quantity" },
      { key: "fixings", description: "Radiator brackets and fixings", trade: "Plumbing/Heating", unit: "set", quantityBasis: "Scope quantity" },
    ],
  },
  {
    id: "install-wc-v1",
    name: "Install WC",
    taskPatterns: ["install wc", "install toilet", "replace wc", "replace toilet"],
    items: [
      { key: "wc", description: "WC, seat and cistern/frame as selected", trade: "Plumbing/Heating", unit: "each", quantityBasis: "Scope quantity" },
      { key: "pan-connector", description: "Pan connector", trade: "Plumbing/Heating", unit: "each", quantityBasis: "Scope quantity" },
      { key: "isolation-valve", description: "Isolation valve", trade: "Plumbing/Heating", unit: "each", quantityBasis: "Scope quantity" },
      { key: "fixing-kit", description: "WC fixing kit and sanitary sealant", trade: "Plumbing/Heating", unit: "set", quantityBasis: "Scope quantity" },
    ],
  },
];

export type EstimateGenerationConfig = {
  ruleVersion: string;
  pipeWastePercent: number;
  pipeClipSpacingM: Record<string, number>;
  labourCostRates: Record<string, number>;
};

export const defaultEstimateGenerationConfig: EstimateGenerationConfig = {
  ruleVersion: "survey-estimator-assemblies-v1",
  pipeWastePercent: 10,
  pipeClipSpacingM: { Copper: 1.2, Plastic: 0.8, Steel: 1.8, Default: 1.2 },
  labourCostRates: { Plumber: 40, Joiner: 30, Electrician: 40, Other: 35 },
};

export type GeneratedEstimateContent = {
  scopeOfWorks: string[];
  questions: string[];
  assumptions: string[];
  exclusions: string[];
  riskNotes: string[];
  materialLines: EstimateMaterialLine[];
  labourLines: EstimateLabourLine[];
  generationRun: EstimateGenerationRun;
};

type MaterialInput = Omit<EstimateMaterialLine, "id" | "markupPercent"> & {
  idKey: string;
  markupPercent?: number;
  mergeMode?: "sum" | "maximum" | "once";
};

type LabourInput = Omit<EstimateLabourLine, "id" | "costRate" | "sellRate"> & {
  idKey: string;
  costRate?: number;
  sellRate?: number;
};

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "line";
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}-${parts.map(slug).join("-")}`.slice(0, 150);
}

function wordNumber(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return words[value.toLowerCase()];
}

function quantityBefore(text: string, noun: string) {
  const match = text.match(new RegExp(`(?:approximately\\s+|approx\\.?\\s+|about\\s+)?(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(?:[^,.]{0,18}\\s+)?${noun}`, "i"));
  return wordNumber(match?.[1]);
}

function pipeCostCentre(service: SurveyPipeRun["service"]) {
  return service === "Gas" || service.startsWith("Heating") ? "Heating" : "Plumbing";
}

function pipeDescription(run: SurveyPipeRun) {
  return `${run.pipeSize || "Size TBC"} ${run.material || "material TBC"} ${run.service.toLowerCase()} pipe`;
}

function sourceScopeFor(survey: SurveyRecord, pattern: RegExp) {
  return survey.scopeItems.find((item) => pattern.test(`${item.taskType} ${item.notes}`));
}

function equipmentText(item: SurveyEquipmentItem) {
  return [item.category, item.description, item.make, item.model, item.connectionRequirements, item.notes].join(" ");
}

function makeLineCollectors(pricingProfile: PricingProfile) {
  const materialMap = new Map<string, EstimateMaterialLine>();
  const labourMap = new Map<string, EstimateLabourLine>();

  function addMaterial(input: MaterialInput) {
    const id = stableId("estimate-material", input.idKey);
    const existing = materialMap.get(id);
    if (existing) {
      if (input.mergeMode === "sum") existing.quantity = round(existing.quantity + input.quantity, 3);
      if (input.mergeMode === "maximum") existing.quantity = Math.max(existing.quantity, input.quantity);
      return existing;
    }
    const line: EstimateMaterialLine = {
      ...input,
      id,
      markupPercent: input.markupPercent ?? pricingProfile.materialMarkupPercent,
    };
    delete (line as EstimateMaterialLine & { idKey?: string; mergeMode?: string }).idKey;
    delete (line as EstimateMaterialLine & { mergeMode?: string }).mergeMode;
    materialMap.set(id, line);
    return line;
  }

  function addLabour(input: LabourInput) {
    const id = stableId("estimate-labour", input.idKey);
    const existing = labourMap.get(id);
    if (existing) {
      existing.hours = Math.max(existing.hours, input.hours);
      return existing;
    }
    const line: EstimateLabourLine = {
      ...input,
      id,
      costRate: input.costRate ?? 0,
      sellRate: input.sellRate ?? pricingProfile.labourSellRate,
    };
    delete (line as EstimateLabourLine & { idKey?: string }).idKey;
    labourMap.set(id, line);
    return line;
  }

  return { addMaterial, addLabour, materialMap, labourMap };
}

function addPipeRunMaterials(
  run: SurveyPipeRun,
  config: EstimateGenerationConfig,
  addMaterial: (input: MaterialInput) => EstimateMaterialLine,
) {
  const costCentre = pipeCostCentre(run.service);
  if (!run.measuredLengthM || run.measurementStatus === "TBC") {
    addMaterial({
      idKey: `pipe-${run.id}`,
      costCentre,
      trade: "Plumbing/Heating",
      description: `${pipeDescription(run)} - measured length TBC`,
      quantity: 1,
      unit: "design item",
      status: "TBC",
      sourceType: "Pipe run",
      sourceId: run.id,
      calculationExplanation: run.tbcReason || "No safe measured quantity was recorded in the survey.",
      notes: run.notes,
    });
    return;
  }

  const wasteLength = run.measuredLengthM * config.pipeWastePercent / 100;
  const orderLength = round(run.measuredLengthM + wasteLength, 2);
  addMaterial({
    idKey: `pipe-${run.id}`,
    costCentre,
    trade: "Plumbing/Heating",
    description: pipeDescription(run),
    quantity: orderLength,
    unit: "m",
    status: "Calculated",
    sourceType: "Pipe run",
    sourceId: run.id,
    calculationExplanation: `Measured ${round(run.measuredLengthM, 2)}m + ${config.pipeWastePercent}% waste (${round(wasteLength, 2)}m) = ${orderLength}m order quantity.`,
    notes: run.notes,
  });

  const spacing = config.pipeClipSpacingM[run.material] ?? config.pipeClipSpacingM.Default ?? 1.2;
  const clips = Math.ceil(orderLength / spacing) + 2;
  addMaterial({
    idKey: `clips-${run.id}`,
    costCentre,
    trade: "Plumbing/Heating",
    description: `${run.pipeSize || "Size TBC"} clips/supports for ${run.service.toLowerCase()}`,
    quantity: clips,
    unit: "each",
    status: "Calculated",
    sourceType: "Pipe run",
    sourceId: run.id,
    calculationExplanation: `${orderLength}m / ${spacing}m clip spacing, rounded up, plus two end supports = ${clips}.`,
    notes: "Confirm support type against the actual construction.",
  });

  if (run.insulationRequired) {
    addMaterial({
      idKey: `insulation-${run.id}`,
      costCentre,
      trade: "Plumbing/Heating",
      description: `${run.pipeSize || "Size TBC"} pipe insulation`,
      quantity: orderLength,
      unit: "m",
      status: "Calculated",
      sourceType: "Pipe run",
      sourceId: run.id,
      calculationExplanation: `Insulation follows the calculated ${orderLength}m pipe order length.`,
      notes: "Confirm insulation thickness against location and specification.",
    });
  }

  for (const change of run.directionChanges.filter((item) => item.quantity > 0)) {
    addMaterial({
      idKey: `direction-${run.id}-${change.type}`,
      costCentre,
      trade: "Plumbing/Heating",
      description: `${run.pipeSize || "Size TBC"} ${change.type} for ${run.service.toLowerCase()}`,
      quantity: change.quantity,
      unit: "each",
      status: "Calculated",
      sourceType: "Pipe run",
      sourceId: run.id,
      calculationExplanation: `${change.quantity} ${change.type.toLowerCase()} direction change(s) recorded against the surveyed route.`,
      notes: "Final fitting type must suit the selected pipe system.",
    });
  }

  if (run.coreDrilling) {
    addMaterial({
      idKey: `core-drilling-${run.id}`,
      costCentre,
      trade: "Other",
      description: "Core-drilling consumables and sleeve allowance",
      quantity: 1,
      unit: "allowance",
      status: "Standard allowance",
      sourceType: "Pipe run",
      sourceId: run.id,
      calculationExplanation: "The surveyed pipe run explicitly requires core drilling.",
      notes: "Confirm core size, construction and service scans before work.",
    });
  }
  if (run.fireStopping) {
    addMaterial({
      idKey: `fire-stopping-${run.id}`,
      costCentre,
      trade: "Other",
      description: "Approved fire-stopping system",
      quantity: 1,
      unit: "system",
      status: "Supplier RFQ",
      sourceType: "Pipe run",
      sourceId: run.id,
      calculationExplanation: "Fire stopping was selected on the surveyed route; product depends on penetration and substrate.",
      notes: "Obtain the correct tested system for the surveyed construction.",
    });
  }
}

function addFlueEquipment(
  item: SurveyEquipmentItem,
  addMaterial: (input: MaterialInput) => EstimateMaterialLine,
) {
  const text = equipmentText(item);
  if (!/flue|terminal|weathering/i.test(text)) return;
  const extensions = quantityBefore(text, "extensions?") ?? 1;
  const bends45 = quantityBefore(text, "45(?:-degree|°| degree)?\\s*bends?") ?? quantityBefore(text, "bends?") ?? 0;
  const shared = {
    costCentre: "Heating",
    trade: "Plumbing/Heating" as const,
    status: "Supplier RFQ" as const,
    sourceType: "Equipment" as const,
    sourceId: item.id,
    notes: "Manufacturer/model compatibility must be confirmed before ordering.",
  };

  addMaterial({
    ...shared,
    idKey: `flue-terminal-${item.id}`,
    description: `${item.make || "Manufacturer"}-compatible vertical flue terminal`,
    quantity: 1,
    unit: "each",
    calculationExplanation: "One vertical terminal was recorded in the survey equipment requirement; exact part number remains supplier-confirmed.",
  });
  addMaterial({
    ...shared,
    idKey: `flue-extension-${item.id}`,
    description: `${item.make || "Manufacturer"}-compatible vertical flue extension`,
    quantity: extensions,
    unit: "each",
    calculationExplanation: `${extensions} extension(s) were recorded in the survey; lengths and part numbers remain model-dependent.`,
  });
  if (bends45) {
    addMaterial({
      ...shared,
      idKey: `flue-45-bend-${item.id}`,
      description: `${item.make || "Manufacturer"}-compatible 45-degree flue bend`,
      quantity: bends45,
      unit: "each",
      calculationExplanation: `${bends45} 45-degree bends were explicitly recorded in the survey equipment requirement.`,
    });
  }
  if (/roof|weathering|slate|flashing/i.test(text)) {
    addMaterial({
      ...shared,
      idKey: `flue-weathering-${item.id}`,
      description: "Vertical flue roof weathering system",
      quantity: 1,
      unit: "system",
      calculationExplanation: "Roof weathering was explicitly recorded; final product depends on roof finish, pitch and flue system.",
    });
  }
}

function addBoilerRelocationAssembly(
  survey: SurveyRecord,
  scope: SurveyScopeItem,
  config: EstimateGenerationConfig,
  addMaterial: (input: MaterialInput) => EstimateMaterialLine,
  addLabour: (input: LabourInput) => EstimateLabourLine,
) {
  const scopeText = `${scope.taskType} ${scope.notes}`;
  const services: Array<{ service: SurveyPipeRun["service"]; label: string }> = [
    { service: "Hot", label: "Hot water" },
    { service: "Cold", label: "Cold water" },
    { service: "Heating flow", label: "Heating flow" },
    { service: "Heating return", label: "Heating return" },
    { service: "Condensate", label: "Condensate" },
  ];
  for (const service of services) {
    const run = survey.pipeRuns.find((item) => item.service === service.service);
    if (run) continue;
    if (!new RegExp(service.label.replace(" water", ""), "i").test(scopeText)) continue;
    addMaterial({
      idKey: `missing-run-${scope.id}-${service.service}`,
      costCentre: "Heating",
      trade: "Plumbing/Heating",
      description: `${service.label} pipework - size, material and measured route TBC`,
      quantity: 1,
      unit: "design item",
      status: "TBC",
      sourceType: "Scope item",
      sourceId: scope.id,
      calculationExplanation: `${service.label} alteration is included in scope, but no measured ${service.label.toLowerCase()} pipe run is stored.`,
      notes: "Add the measured run before converting this to an order quantity.",
    });
  }

  addMaterial({
    idKey: "system-cleaner",
    costCentre: "Heating",
    trade: "Plumbing/Heating",
    description: "Heating system cleaner",
    quantity: 1,
    unit: "bottle",
    status: "Standard allowance",
    sourceType: "Assembly",
    sourceId: scope.id,
    calculationExplanation: "One cleaner allowance is included because the boiler relocation requires drain-down, alteration and recommissioning.",
    notes: "Confirm product suitability against system volume and manufacturer guidance.",
    mergeMode: "once",
  });
  addMaterial({
    idKey: "system-inhibitor",
    costCentre: "Heating",
    trade: "Plumbing/Heating",
    description: "Heating system inhibitor",
    quantity: 1,
    unit: "bottle",
    status: "Standard allowance",
    sourceType: "Assembly",
    sourceId: scope.id,
    calculationExplanation: "One inhibitor allowance is included for refill and commissioning after the recorded heating alterations.",
    notes: "Confirm dose against system volume.",
    mergeMode: "once",
  });

  addLabour({
    idKey: `boiler-isolate-${scope.id}`,
    costCentre: "Heating",
    trade: "Plumbing/Heating",
    labourType: "Plumber",
    description: "Isolate, drain and carefully disconnect existing boiler",
    hours: 2,
    costRate: config.labourCostRates.Plumber,
    status: "Allowance",
    calculationBasis: "Standard two-hour isolation, drain-down and disconnection allowance; estimator to confirm site complexity.",
    sourceType: "Scope item",
    sourceId: scope.id,
    notes: "Does not include asbestos or hazardous-material remediation.",
  });
  const measuredPipeLength = survey.pipeRuns.reduce((sum, run) => sum + (run.measuredLengthM || 0), 0);
  addLabour({
    idKey: `boiler-pipework-${scope.id}`,
    costCentre: "Heating",
    trade: "Plumbing/Heating",
    labourType: "Plumber",
    description: "Alter and install surveyed service pipework",
    hours: round(4 + measuredPipeLength * 0.25, 1),
    costRate: config.labourCostRates.Plumber,
    status: measuredPipeLength ? "Calculated" : "TBC",
    calculationBasis: measuredPipeLength ? `Four-hour setup allowance + ${measuredPipeLength} measured metre(s) at 0.25 hours/m.` : "Pipe runs are not sufficiently measured for calculated labour.",
    sourceType: "Scope item",
    sourceId: scope.id,
    notes: "Access difficulty and return visits remain estimator review items.",
  });
  addLabour({
    idKey: `boiler-flue-${scope.id}`,
    costCentre: "Heating",
    trade: "Plumbing/Heating",
    labourType: "Plumber",
    description: "Install vertical flue system and weathering components",
    hours: 4,
    costRate: config.labourCostRates.Plumber,
    status: "Allowance",
    calculationBasis: "Initial four-hour allowance pending confirmed flue design, roof access and weathering detail.",
    sourceType: "Scope item",
    sourceId: scope.id,
    notes: "Scaffold, specialist roofing or lifting access is excluded unless added.",
  });
  addLabour({
    idKey: `boiler-commission-${scope.id}`,
    costCentre: "Heating",
    trade: "Plumbing/Heating",
    labourType: "Plumber",
    description: "Fill, test, flush, dose, commission and certify",
    hours: 3,
    costRate: config.labourCostRates.Plumber,
    status: "Allowance",
    calculationBasis: "Three-hour commissioning and certification allowance for boiler relocation.",
    sourceType: "Assembly",
    sourceId: scope.id,
    notes: "Final certification requirements depend on appliance and work scope.",
  });
  if (/cupboard|boxing|joiner|making good/i.test(`${scopeText} ${scope.proposedPosition}`)) {
    addLabour({
      idKey: `boiler-joinery-${scope.id}`,
      costCentre: "Joinery",
      trade: "Joinery",
      labourType: "Joiner",
      description: "Cupboard access, local alterations and making good",
      hours: 4,
      costRate: config.labourCostRates.Joiner,
      status: "Allowance",
      calculationBasis: "Initial half-day joinery allowance triggered by the recorded cupboard location/making-good scope.",
      sourceType: "Scope item",
      sourceId: scope.id,
      notes: "Final scope depends on cupboard construction and required clearances.",
    });
  }
  if (/control|electrical|wiring/i.test(scopeText)) {
    addMaterial({
      idKey: `controls-material-${scope.id}`,
      costCentre: "Electrical",
      trade: "Electrical",
      description: "Controls/wiring components to suit confirmed control strategy",
      quantity: 1,
      unit: "design item",
      status: "TBC",
      sourceType: "Scope item",
      sourceId: scope.id,
      calculationExplanation: "Controls alterations are in scope, but the exact existing/proposed controls and wiring components require confirmation.",
      notes: "Do not order until the control strategy and electrical supply are confirmed.",
    });
    addLabour({
      idKey: `controls-labour-${scope.id}`,
      costCentre: "Electrical",
      trade: "Electrical",
      labourType: "Electrician",
      description: "Alter controls and electrical connections, test and certify",
      hours: 4,
      costRate: config.labourCostRates.Electrician,
      status: "Allowance",
      calculationBasis: "Initial half-day electrical allowance pending confirmed control strategy and existing supply.",
      sourceType: "Scope item",
      sourceId: scope.id,
      notes: "Consumer-unit remedial work is excluded unless identified and added.",
    });
  }
}

function addRadiatorAssembly(
  scope: SurveyScopeItem,
  equipment: SurveyEquipmentItem | undefined,
  config: EstimateGenerationConfig,
  addMaterial: (input: MaterialInput) => EstimateMaterialLine,
  addLabour: (input: LabourInput) => EstimateLabourLine,
) {
  const quantity = Math.max(scope.quantity || equipment?.quantity || 1, 1);
  addMaterial({ idKey: `radiator-${scope.id}`, costCentre: "Heating", trade: "Plumbing/Heating", description: equipment?.description || "Radiator - output and dimensions TBC", quantity, unit: "each", unitCost: equipment?.confirmedSupplierPrice, status: equipment?.rfqRequired ? "Supplier RFQ" : equipment?.status === "Confirmed" ? "Confirmed" : "TBC", sourceType: equipment ? "Equipment" : "Scope item", sourceId: equipment?.id || scope.id, calculationExplanation: equipment ? "Quantity and selection taken from the linked surveyed equipment item." : "Scope quantity is known but radiator selection requires equipment/heat-loss confirmation.", notes: equipment?.notes || "Confirm output, dimensions and connection orientation." });
  addMaterial({ idKey: `radiator-valves-${scope.id}`, costCentre: "Heating", trade: "Plumbing/Heating", description: "Radiator valve set", quantity, unit: "set", status: "Standard allowance", sourceType: "Assembly", sourceId: scope.id, calculationExplanation: `One valve set per radiator x ${quantity}.`, notes: "Confirm TRV/lockshield style and finish." });
  addMaterial({ idKey: `radiator-fixings-${scope.id}`, costCentre: "Heating", trade: "Plumbing/Heating", description: "Radiator brackets and fixings", quantity, unit: "set", status: "Standard allowance", sourceType: "Assembly", sourceId: scope.id, calculationExplanation: `One fixing set per radiator x ${quantity}.`, notes: "Fixings must suit the recorded wall construction." });
  addLabour({ idKey: `radiator-labour-${scope.id}`, costCentre: "Heating", trade: "Plumbing/Heating", labourType: "Plumber", description: "Install, connect, test and balance radiator", hours: round(quantity * 2.5, 1), costRate: config.labourCostRates.Plumber, status: "Allowance", calculationBasis: `${quantity} radiator(s) at an initial 2.5 hours each, excluding unmeasured pipe routes.`, sourceType: "Scope item", sourceId: scope.id, notes: "Adjust for access, drain-down and measured pipe alterations." });
}

function addWcAssembly(
  scope: SurveyScopeItem,
  config: EstimateGenerationConfig,
  addMaterial: (input: MaterialInput) => EstimateMaterialLine,
  addLabour: (input: LabourInput) => EstimateLabourLine,
) {
  const quantity = Math.max(scope.quantity, 1);
  const components = [
    ["wc", "WC, seat and cistern/frame as selected", "each", "Supplier RFQ"],
    ["pan", "Pan connector", "each", "Standard allowance"],
    ["valve", "Isolation valve", "each", "Standard allowance"],
    ["fix", "WC fixing kit and sanitary sealant", "set", "Standard allowance"],
  ] as const;
  for (const [key, description, unit, status] of components) {
    addMaterial({ idKey: `wc-${key}-${scope.id}`, costCentre: "Bathrooms", trade: "Plumbing/Heating", description, quantity, unit, status, sourceType: "Assembly", sourceId: scope.id, calculationExplanation: `One ${description.toLowerCase()} per WC x ${quantity}.`, notes: status === "Supplier RFQ" ? "Confirm selected sanitaryware and supplier price." : "Standard installation component; verify compatibility." });
  }
  addLabour({ idKey: `wc-labour-${scope.id}`, costCentre: "Bathrooms", trade: "Plumbing/Heating", labourType: "Plumber", description: "Install and test WC", hours: round(quantity * 3, 1), costRate: config.labourCostRates.Plumber, status: "Allowance", calculationBasis: `${quantity} WC(s) at an initial three hours each, excluding unmeasured waste alterations.`, sourceType: "Scope item", sourceId: scope.id, notes: "Adjust after waste and supply routes are confirmed." });
}

export function generateEstimateFromSurvey(
  survey: SurveyRecord,
  pricingProfile: PricingProfile,
  partialConfig: Partial<EstimateGenerationConfig> = {},
  completedAt = new Date().toISOString(),
): GeneratedEstimateContent {
  const config: EstimateGenerationConfig = {
    ...defaultEstimateGenerationConfig,
    ...partialConfig,
    pipeClipSpacingM: { ...defaultEstimateGenerationConfig.pipeClipSpacingM, ...(partialConfig.pipeClipSpacingM || {}) },
    labourCostRates: { ...defaultEstimateGenerationConfig.labourCostRates, ...(partialConfig.labourCostRates || {}) },
  };
  const { addMaterial, addLabour, materialMap, labourMap } = makeLineCollectors(pricingProfile);
  const completion = reviewSurveyCompletion(survey);

  survey.pipeRuns.forEach((run) => addPipeRunMaterials(run, config, addMaterial));
  survey.equipmentItems.forEach((item) => addFlueEquipment(item, addMaterial));

  for (const scope of survey.scopeItems) {
    const text = `${scope.taskType} ${scope.notes}`;
    if (/relocat.*boiler|boiler.*relocat/i.test(text) || survey.jobType === "Boiler relocation") {
      addBoilerRelocationAssembly(survey, scope, config, addMaterial, addLabour);
      continue;
    }
    if (/radiator|towel rail/i.test(text)) {
      const equipment = survey.equipmentItems.find((item) => /radiator|towel/i.test(equipmentText(item)) && (!item.roomOrArea || item.roomOrArea === scope.roomOrArea));
      addRadiatorAssembly(scope, equipment, config, addMaterial, addLabour);
      continue;
    }
    if (/\b(wc|toilet)\b/i.test(text)) {
      addWcAssembly(scope, config, addMaterial, addLabour);
      continue;
    }
  }

  const questions = [
    ...completion.missingInformation.map((item) => item.message),
    ...completion.conflicts.map((item) => item.message),
  ];
  const riskNotes = [
    ...completion.designDependencies.map((item) => item.message),
    ...completion.tbcItems.map((item) => item.message),
  ];
  if (!survey.scopeItems.length) questions.push("Add at least one structured scope item before estimate approval.");

  const materialLines = [...materialMap.values()];
  const labourLines = [...labourMap.values()];
  return {
    scopeOfWorks: survey.scopeItems.map((item) => `${item.taskType}${item.roomOrArea ? ` - ${item.roomOrArea}` : ""}${item.notes ? `: ${item.notes}` : ""}`),
    questions: Array.from(new Set(questions)),
    assumptions: [...survey.assumptions],
    exclusions: [...survey.workByOthers],
    riskNotes: Array.from(new Set(riskNotes)),
    materialLines,
    labourLines,
    generationRun: {
      id: stableId("estimate-run", survey.id, String(survey.version), config.ruleVersion),
      startedAt: completedAt,
      completedAt,
      sourceSurveyVersion: survey.version,
      ruleVersion: config.ruleVersion,
      summary: `${materialLines.length} material component(s) and ${labourLines.length} labour task(s) generated from ${survey.reference}.`,
    },
  };
}

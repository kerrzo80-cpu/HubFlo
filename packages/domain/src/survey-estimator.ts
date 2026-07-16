export const surveyJobTypes = [
  "Bathroom or wet room",
  "Boiler change",
  "Boiler relocation",
  "Heating alterations",
  "Full heating system",
  "Radiators or towel rails",
  "ASHP",
  "Underfloor heating",
  "Kitchen plumbing",
  "Commercial or tender work",
  "General plumbing",
  "Custom survey",
] as const;

export type SurveyJobType = (typeof surveyJobTypes)[number];
export type SurveyStatus = "Draft" | "Ready for review" | "Complete" | "Sent to estimator";
export type SurveyMarket = "Domestic" | "Commercial";
export type SurveyOccupancy = "Occupied" | "Vacant" | "Unknown";
export type SurveyValueStatus = "Confirmed" | "Assumed" | "Provisional" | "TBC" | "Not applicable";
export type SurveyResponsibility = "EWG" | "Client" | "Main contractor" | "Other trade";
export type SurveyLinkType = "Lead" | "Quote" | "Job";
export type SurveyPhotoCategory =
  | "Room overview"
  | "Existing condition"
  | "Proposed position"
  | "Pipe route"
  | "Boiler data plate"
  | "Gas meter"
  | "Consumer unit"
  | "Drainage"
  | "Access issue"
  | "Damage or making good"
  | "Measurement evidence"
  | "Other";

export type SurveyJobLink = {
  type: SurveyLinkType;
  id: string;
  reference: string;
};

export type SurveyContact = {
  name: string;
  email: string;
  phone: string;
};

export type SurveyAnswer = {
  id: string;
  key: string;
  section: string;
  question: string;
  value: string | number | boolean | null;
  status: SurveyValueStatus;
  tbcReason?: string;
  notes: string;
  photoIds: string[];
  updatedAt: string;
};

export type SurveyRoom = {
  id: string;
  name: string;
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  wallConstruction: string;
  floorConstruction: string;
  ceilingConstruction: string;
  accessNotes: string;
  photoIds: string[];
};

export type SurveyScopeItem = {
  id: string;
  taskType: string;
  trade: string;
  roomOrArea: string;
  existingPosition: string;
  proposedPosition: string;
  quantity: number;
  dimensions: string;
  status: Exclude<SurveyValueStatus, "Not applicable">;
  tbcReason?: string;
  responsibility: SurveyResponsibility;
  notes: string;
  photoIds: string[];
};

export type SurveyDirectionChange = {
  type: string;
  quantity: number;
};

export type SurveyPipeRun = {
  id: string;
  service:
    | "Hot"
    | "Cold"
    | "Heating flow"
    | "Heating return"
    | "Gas"
    | "Waste"
    | "Soil"
    | "Condensate"
    | "Other";
  fromLocation: string;
  toLocation: string;
  measuredLengthM?: number;
  pipeSize: string;
  material: string;
  route: string;
  insulationRequired: boolean;
  directionChanges: SurveyDirectionChange[];
  accessDifficulty: "Normal" | "Restricted" | "Difficult" | "TBC";
  fireStopping: boolean;
  coreDrilling: boolean;
  makingGood: boolean;
  measurementStatus: "Measured" | "Drawing-derived" | "Allowance" | "TBC";
  tbcReason?: string;
  notes: string;
  photoIds: string[];
};

export type SurveyEquipmentItem = {
  id: string;
  category: string;
  roomOrArea: string;
  description: string;
  make: string;
  model: string;
  supplierCode: string;
  quantity: number;
  dimensions: string;
  outputOrCapacity: string;
  connectionRequirements: string;
  confirmedSupplierPrice?: number;
  rfqRequired: boolean;
  status: SurveyValueStatus;
  tbcReason?: string;
  notes: string;
  photoIds: string[];
};

export type SurveyPhoto = {
  id: string;
  category: SurveyPhotoCategory;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  caption: string;
  capturedAt: string;
  surveySection: string;
  linkedScopeItemId?: string;
};

export type SurveyAuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
};

export type SurveyAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  step: string;
  createdAt: string;
};

export type SurveyRecord = {
  id: string;
  tenantId: string;
  reference: string;
  version: number;
  status: SurveyStatus;
  customerId?: string;
  customerName: string;
  siteId?: string;
  siteAddress: string;
  primaryContact: SurveyContact;
  additionalContacts: SurveyContact[];
  jobLink?: SurveyJobLink;
  surveyorId?: string;
  surveyorName: string;
  surveyDate: string;
  requiredByDate?: string;
  customerRequirements: string;
  occupancy: SurveyOccupancy;
  market: SurveyMarket;
  jobType: SurveyJobType;
  answers: SurveyAnswer[];
  rooms: SurveyRoom[];
  scopeItems: SurveyScopeItem[];
  pipeRuns: SurveyPipeRun[];
  equipmentItems: SurveyEquipmentItem[];
  photos: SurveyPhoto[];
  workByOthers: string[];
  assumptions: string[];
  assistantMessages?: SurveyAssistantMessage[];
  legacyTakeoffProjectId?: string;
  estimateId?: string;
  audit: SurveyAuditEntry[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  sentToEstimatorAt?: string;
};

export type SurveyQuestionDefinition = {
  key: string;
  section: string;
  question: string;
  required: boolean;
  safetyCritical?: boolean;
  jobTypes?: SurveyJobType[];
};

export type SurveyQuestionSet = {
  jobType: SurveyJobType;
  intro: string;
  questions: SurveyQuestionDefinition[];
};

export type SurveyCompletionIssue = {
  code: string;
  section: string;
  message: string;
  recordId?: string;
};

export type SurveyCompletionReview = {
  canComplete: boolean;
  canSendToEstimator: boolean;
  blockers: SurveyCompletionIssue[];
  pricingReadinessIssues: SurveyCompletionIssue[];
  missingInformation: SurveyCompletionIssue[];
  tbcItems: SurveyCompletionIssue[];
  designDependencies: SurveyCompletionIssue[];
  supplierRfqs: SurveyCompletionIssue[];
  conflicts: SurveyCompletionIssue[];
  workByOthers: string[];
  assumptions: string[];
  completedSections: string[];
};

export type EstimateLineStatus = "Confirmed" | "Calculated" | "Standard allowance" | "TBC" | "Supplier RFQ";
export type EstimateStatus = "Draft" | "In review" | "Approved" | "Pushed";
export type EstimateTrade = "Plumbing/Heating" | "Joinery" | "Electrical" | "Tiling/Flooring" | "Painting" | "Other";

export type PricingProfile = {
  id: string;
  name: string;
  market: SurveyMarket;
  labourSellRate: number;
  materialMarkupPercent: number;
  plantMarkupPercent: number;
  vatPercent: number;
};

export const seededPricingProfiles: PricingProfile[] = [
  {
    id: "domestic-small-works",
    name: "Domestic / small works",
    market: "Domestic",
    labourSellRate: 70,
    materialMarkupPercent: 30,
    plantMarkupPercent: 20,
    vatPercent: 20,
  },
  {
    id: "commercial-daywork",
    name: "Commercial daywork reference",
    market: "Commercial",
    labourSellRate: 60,
    materialMarkupPercent: 25,
    plantMarkupPercent: 20,
    vatPercent: 20,
  },
];

export type SimproEstimateMappings = {
  labourTypes: Record<string, number>;
  costCentres: Record<string, number>;
};

export const seededSimproEstimateMappings: SimproEstimateMappings = {
  labourTypes: { Plumber: 104, Joiner: 70 },
  costCentres: {
    Bathrooms: 4,
    Heating: 5,
    Plumbing: 6,
    Joinery: 7,
    Electrical: 11,
    Painting: 13,
    Tiling: 14,
  },
};

export type EstimateMaterialLine = {
  id: string;
  costCentre: string;
  trade: EstimateTrade;
  description: string;
  quantity: number;
  unit: string;
  unitCost?: number;
  markupPercent: number;
  status: EstimateLineStatus;
  sourceType: "Survey answer" | "Scope item" | "Pipe run" | "Equipment" | "Assembly" | "Manual";
  sourceId: string;
  calculationExplanation: string;
  supplier?: string;
  notes: string;
};

export type EstimateLabourLine = {
  id: string;
  costCentre: string;
  trade: string;
  labourType: string;
  description: string;
  hours: number;
  costRate: number;
  sellRate: number;
  status: "Confirmed" | "Calculated" | "Allowance" | "TBC";
  calculationBasis: string;
  sourceType: "Survey answer" | "Scope item" | "Pipe run" | "Equipment" | "Assembly" | "Manual";
  sourceId: string;
  notes: string;
};

export type EstimateCorrection = {
  id: string;
  lineType: "Material" | "Labour" | "Scope";
  lineId: string;
  reason: string;
  actor: string;
  createdAt: string;
  reusable: boolean;
};

export type EstimateGenerationRun = {
  id: string;
  startedAt: string;
  completedAt: string;
  sourceSurveyVersion: number;
  ruleVersion: string;
  summary: string;
};

export type EstimateRecord = {
  id: string;
  tenantId: string;
  reference: string;
  surveyId: string;
  sourceSurveyVersion: number;
  version: number;
  status: EstimateStatus;
  pricingProfile: PricingProfile;
  scopeOfWorks: string[];
  questions: string[];
  assumptions: string[];
  exclusions: string[];
  riskNotes: string[];
  materialLines: EstimateMaterialLine[];
  labourLines: EstimateLabourLine[];
  corrections: EstimateCorrection[];
  generationRuns: EstimateGenerationRun[];
  simproMappings: SimproEstimateMappings;
  coreQuoteId?: string;
  coreQuoteRef?: string;
  pushedAt?: string;
  createdAt: string;
  updatedAt: string;
};

const siteBaselineQuestions: SurveyQuestionDefinition[] = [
  { key: "access-construction", section: "Access and construction", question: "Record loft, floor and wall access plus wall, floor and ceiling construction.", required: true },
  { key: "parking-restrictions", section: "Access and construction", question: "Record parking, access and working restrictions.", required: false },
  { key: "asbestos-safety", section: "Safety", question: "Are there known or suspected asbestos or other safety concerns?", required: true, safetyCritical: true },
  { key: "builders-work", section: "Access and construction", question: "What builder's work, core drilling, fire stopping or making good is required?", required: false },
];

const waterAndWasteQuestions: SurveyQuestionDefinition[] = [
  { key: "water-supply-stopcock", section: "Existing conditions", question: "Where are the incoming water supply and stopcock, and are they accessible?", required: true },
  { key: "drainage-waste-routes", section: "Existing conditions", question: "What drainage and waste routes are available?", required: true },
];

const heatingSystemQuestions: SurveyQuestionDefinition[] = [
  { key: "existing-heating-system", section: "Heating", question: "Record the existing heat source, controls, pipe sizes and system condition.", required: true },
  { key: "heating-drain-down", section: "Heating", question: "How can the heating system be isolated, drained down, refilled and tested?", required: true },
];

const electricalSupplyQuestion: SurveyQuestionDefinition = {
  key: "electrical-supply",
  section: "Electrical",
  question: "What electrical supply, isolators and controls are present or affected by these works?",
  required: true,
};

const boilerQuestions: SurveyQuestionDefinition[] = [
  ...heatingSystemQuestions,
  electricalSupplyQuestion,
  { key: "existing-boiler", section: "Boiler", question: "Record the existing boiler make, model, serial number, condition and whether it will be reused.", required: true },
  { key: "gas-meter-supply", section: "Gas", question: "Record the gas meter position, incoming supply and existing pipe size.", required: true, safetyCritical: true },
  { key: "proposed-boiler-position", section: "Boiler", question: "Where is the proposed boiler position and what clearances or cupboard access apply?", required: true },
  { key: "flue-route", section: "Flue", question: "Record the proposed flue route, terminal position, access and weathering requirements.", required: true, safetyCritical: true },
  { key: "condensate-route", section: "Boiler", question: "Record the condensate route and termination.", required: true },
  { key: "controls", section: "Controls", question: "Record the existing and proposed controls and wiring requirements.", required: true },
];

const jobSpecificQuestions: Partial<Record<SurveyJobType, SurveyQuestionDefinition[]>> = {
  "Bathroom or wet room": [
    ...waterAndWasteQuestions,
    { key: "sanitaryware", section: "Bathroom", question: "Record sanitaryware, showers and baths to remove, reuse or install.", required: true },
    { key: "waterproofing-finishes", section: "Bathroom", question: "Record tanking, wet wall, tiling, flooring and making-good scope.", required: true },
    { ...electricalSupplyQuestion, required: false, question: "Record fan, lighting, shaver point, electric shower or other electrical items only if affected." },
  ],
  "Boiler change": boilerQuestions,
  "Boiler relocation": boilerQuestions,
  "Heating alterations": [
    ...heatingSystemQuestions,
    { key: "heating-alterations", section: "Heating", question: "Record each heating alteration and the proposed pipe route.", required: true },
    { key: "heating-controls-affected", section: "Controls", question: "Are controls, wiring or thermostats affected by the heating alteration?", required: false },
  ],
  "Full heating system": [
    ...heatingSystemQuestions,
    electricalSupplyQuestion,
    { key: "design-temperatures", section: "Heating", question: "Record design temperatures, heat-loss dependencies and emitter requirements.", required: true },
  ],
  "Radiators or towel rails": [
    ...heatingSystemQuestions,
    { key: "emitter-requirements", section: "Radiators", question: "Record each radiator or towel rail being moved, reused, replaced or newly supplied.", required: true },
    { key: "radiator-pipe-routes", section: "Radiators", question: "Record existing and proposed radiator positions, pipe routes, pipe sizes, valves and access/making-good.", required: true },
  ],
  ASHP: [
    ...heatingSystemQuestions,
    electricalSupplyQuestion,
    { key: "ashp-design", section: "ASHP", question: "Record outdoor unit, cylinder, emitter, noise, heat-loss and electrical design dependencies.", required: true },
  ],
  "Underfloor heating": [
    ...heatingSystemQuestions,
    electricalSupplyQuestion,
    { key: "ufh-build-up", section: "UFH", question: "Record floor build-up, manifold, zones, insulation, coverings and controls.", required: true },
  ],
  "Kitchen plumbing": [
    ...waterAndWasteQuestions,
    { key: "kitchen-appliances", section: "Kitchen", question: "Record sink, appliances, hot/cold and waste connections.", required: true },
  ],
  "Commercial or tender work": [
    { key: "tender-documents", section: "Tender", question: "Record drawing, specification, programme, access and commercial dependencies.", required: true },
  ],
  "General plumbing": waterAndWasteQuestions,
};

const questionSetIntros: Record<SurveyJobType, string> = {
  "Bathroom or wet room": "Bathroom surveys ask about water, waste, sanitaryware, waterproofing, finishes and only affected electrics.",
  "Boiler change": "Boiler change surveys focus on heating isolation, boiler data, gas, flue, condensate and controls.",
  "Boiler relocation": "Boiler relocation surveys focus on existing boiler data, gas sizing, flue, condensate, controls and altered pipe routes.",
  "Heating alterations": "Heating alteration surveys focus on the existing system, drain-down, altered pipe routes, controls only if affected and making-good.",
  "Full heating system": "Full heating surveys include heat source, emitters, controls, electrical supply and heat-loss dependencies.",
  "Radiators or towel rails": "Radiator surveys focus on the existing heating system, drain-down, emitter positions, valves and pipe routes.",
  ASHP: "ASHP surveys capture outdoor unit, cylinder, emitter, noise, heat-loss, electrical and control dependencies.",
  "Underfloor heating": "Underfloor heating surveys capture floor build-up, manifold, zones, insulation, coverings, controls and electrical interfaces.",
  "Kitchen plumbing": "Kitchen plumbing surveys focus on hot, cold, waste, sink and appliance connections.",
  "Commercial or tender work": "Commercial and tender surveys focus on drawings, specifications, programme, access and commercial dependencies.",
  "General plumbing": "General plumbing surveys focus on the water supply, isolation, drainage, access and any job-specific scope items.",
  "Custom survey": "Custom surveys keep the baseline site and safety checks, then rely on the scope, measurements and Ask NeXa prompts.",
};

function uniqueQuestions(questions: SurveyQuestionDefinition[]) {
  const seen = new Set<string>();
  return questions.filter((question) => {
    if (seen.has(question.key)) return false;
    seen.add(question.key);
    return true;
  });
}

export function inferSurveyJobTypeFromText(text: string): SurveyJobType | undefined {
  const normalised = text.toLowerCase();
  if (!normalised.trim()) return undefined;
  if (/boiler/.test(normalised) && /relocat|move|moving|reposition|new\s+position/.test(normalised)) return "Boiler relocation";
  if (/boiler|combi|system\s+boiler|heat\s+only/.test(normalised)) return "Boiler change";
  if (/bathroom|wet\s*room|shower\s*(?:room|cubicle|tray|screen)|en-suite|ensuite/.test(normalised)) return "Bathroom or wet room";
  if (/air\s*source|ashp|heat\s*pump/.test(normalised)) return "ASHP";
  if (/underfloor|ufh/.test(normalised)) return "Underfloor heating";
  if (/full\s+heating|whole\s+heating|heating\s+system/.test(normalised)) return "Full heating system";
  if (/radiator|radiators|rad\b|rads\b|towel\s*rail|towel\s*rails/.test(normalised)) return "Radiators or towel rails";
  if (/heating|pipework\s+alteration|alter\s+pipe|move\s+pipe|relocate\s+pipe/.test(normalised)) return "Heating alterations";
  if (/kitchen|sink|dishwasher|washing\s+machine|appliance/.test(normalised)) return "Kitchen plumbing";
  if (/tender|boq|bill\s+of\s+quantities|commercial|specification|drawing/.test(normalised)) return "Commercial or tender work";
  if (/tap|toilet|wc|leak|waste|soil|hot\s+water|cold\s+water|stopcock|plumb/.test(normalised)) return "General plumbing";
  return undefined;
}

export function surveyQuestionSetForJobType(jobType: SurveyJobType): SurveyQuestionSet {
  return {
    jobType,
    intro: questionSetIntros[jobType],
    questions: uniqueQuestions([...siteBaselineQuestions, ...(jobSpecificQuestions[jobType] ?? [])]),
  };
}

export function surveyQuestionsForJobType(jobType: SurveyJobType) {
  return surveyQuestionSetForJobType(jobType).questions;
}

function hasAnswerValue(answer: SurveyAnswer | undefined) {
  if (!answer) return false;
  if (answer.status === "Not applicable") return true;
  if (answer.status === "TBC") return Boolean(answer.tbcReason?.trim());
  return typeof answer.value === "boolean" || typeof answer.value === "number" || Boolean(answer.value?.toString().trim());
}

function photoCategoriesRequired(jobType: SurveyJobType): SurveyPhotoCategory[] {
  if (jobType === "Boiler change" || jobType === "Boiler relocation") {
    return ["Existing condition", "Proposed position", "Pipe route", "Boiler data plate", "Gas meter"];
  }
  return ["Existing condition", "Proposed position"];
}

export function reviewSurveyCompletion(survey: SurveyRecord): SurveyCompletionReview {
  const blockers: SurveyCompletionIssue[] = [];
  const pricingReadinessIssues: SurveyCompletionIssue[] = [];
  const missingInformation: SurveyCompletionIssue[] = [];
  const tbcItems: SurveyCompletionIssue[] = [];
  const designDependencies: SurveyCompletionIssue[] = [];
  const supplierRfqs: SurveyCompletionIssue[] = [];
  const conflicts: SurveyCompletionIssue[] = [];

  if (!survey.customerName.trim()) blockers.push({ code: "CUSTOMER_REQUIRED", section: "Job details", message: "Customer is required." });
  if (!survey.siteAddress.trim()) blockers.push({ code: "SITE_REQUIRED", section: "Job details", message: "Site address is required." });
  if (!survey.jobLink?.id || !survey.jobLink.reference.trim()) blockers.push({ code: "JOB_LINK_REQUIRED", section: "Job details", message: "Link the survey to a lead, quote or job." });
  if (!survey.surveyorName.trim()) blockers.push({ code: "SURVEYOR_REQUIRED", section: "Job details", message: "Surveyor is required." });
  if (!survey.surveyDate) blockers.push({ code: "SURVEY_DATE_REQUIRED", section: "Job details", message: "Survey date is required." });
  if (!survey.customerRequirements.trim()) {
    pricingReadinessIssues.push({ code: "CUSTOMER_REQUIREMENT_REQUIRED", section: "Job details", message: "Record what the customer wants priced and the required outcome." });
  }
  if (!survey.scopeItems.length) {
    pricingReadinessIssues.push({ code: "SCOPE_REQUIRED", section: "Proposed scope", message: "Add at least one structured scope item before sending this survey to Estimator." });
  }

  const answersByKey = new Map<string, SurveyAnswer[]>();
  survey.answers.forEach((answer) => answersByKey.set(answer.key, [...(answersByKey.get(answer.key) ?? []), answer]));
  surveyQuestionsForJobType(survey.jobType).forEach((definition) => {
    const answers = answersByKey.get(definition.key) ?? [];
    const answer = answers.at(-1);
    if (definition.required && !hasAnswerValue(answer)) {
      const issue = { code: "REQUIRED_ANSWER", section: definition.section, message: definition.question, recordId: answer?.id };
      if (definition.safetyCritical) blockers.push(issue);
      else missingInformation.push(issue);
    }
    if (answer?.status === "TBC") {
      const issue = { code: "TBC_ITEM", section: definition.section, message: `${definition.question}${answer.tbcReason ? ` Reason: ${answer.tbcReason}` : ""}`, recordId: answer.id };
      tbcItems.push(issue);
      if (!answer.tbcReason?.trim()) blockers.push({ ...issue, code: "TBC_REASON_REQUIRED", message: `Add a reason for TBC: ${definition.question}` });
    }
    const confirmedValues = new Set(answers.filter((item) => item.status === "Confirmed" && hasAnswerValue(item)).map((item) => String(item.value).trim().toLowerCase()));
    if (confirmedValues.size > 1) conflicts.push({ code: "CONFLICTING_ANSWER", section: definition.section, message: `Conflicting confirmed answers: ${definition.question}` });
  });

  survey.scopeItems.forEach((item) => {
    if (item.status === "TBC") {
      tbcItems.push({ code: "TBC_SCOPE", section: "Proposed scope", message: `${item.taskType}: ${item.tbcReason || "reason required"}`, recordId: item.id });
      if (!item.tbcReason?.trim()) blockers.push({ code: "TBC_REASON_REQUIRED", section: "Proposed scope", message: `Add a TBC reason for ${item.taskType}.`, recordId: item.id });
    }
  });
  survey.pipeRuns.forEach((run) => {
    if (run.measurementStatus === "TBC") {
      tbcItems.push({ code: "TBC_PIPE_RUN", section: "Pipe runs", message: `${run.service} ${run.fromLocation} to ${run.toLocation}: ${run.tbcReason || "reason required"}`, recordId: run.id });
      if (!run.tbcReason?.trim()) blockers.push({ code: "TBC_REASON_REQUIRED", section: "Pipe runs", message: `Add a TBC reason for the ${run.service} pipe run.`, recordId: run.id });
    }
    if (run.service === "Gas" && (!run.pipeSize.trim() || run.measurementStatus !== "Measured")) {
      designDependencies.push({ code: "GAS_DESIGN_DEPENDENCY", section: "Pipe runs", message: "Gas sizing remains design-dependent until route, measured length and pipe size are confirmed.", recordId: run.id });
    }
    if (run.directionChanges.some((change) => change.quantity > 0 && !/[a-z]/i.test(change.type))) {
      pricingReadinessIssues.push({ code: "PIPE_FITTING_TYPE_REQUIRED", section: "Pipe runs", message: `Choose a fitting type for the ${run.service.toLowerCase()} pipe direction changes.`, recordId: run.id });
    }
    if ((run.service === "Hot" || run.service === "Cold") && /radiator|heating/i.test(run.toLocation)) {
      pricingReadinessIssues.push({ code: "PIPE_SERVICE_CHECK", section: "Pipe runs", message: `Check whether the ${run.service.toLowerCase()} pipe run to ${run.toLocation} should be heating flow or heating return.`, recordId: run.id });
    }
  });
  survey.equipmentItems.forEach((item) => {
    if (item.rfqRequired) supplierRfqs.push({ code: "SUPPLIER_RFQ", section: "Equipment", message: `${item.description || item.category} requires supplier confirmation.`, recordId: item.id });
    if (item.status === "TBC") designDependencies.push({ code: "EQUIPMENT_TBC", section: "Equipment", message: `${item.description || item.category} selection remains TBC.`, recordId: item.id });
  });

  for (const category of photoCategoriesRequired(survey.jobType)) {
    if (!survey.photos.some((photo) => photo.category === category)) {
      missingInformation.push({ code: "PHOTO_EVIDENCE_MISSING", section: "Photographs", message: `${category} photograph is still required or must be marked unavailable in the survey notes.` });
    }
  }
  survey.photos.forEach((photo) => {
    if (!photo.caption.trim()) pricingReadinessIssues.push({ code: "PHOTO_CAPTION_REQUIRED", section: "Photographs", message: `Add a caption explaining what ${photo.fileName} proves.`, recordId: photo.id });
  });

  const completedSections = Array.from(new Set(survey.answers.filter(hasAnswerValue).map((answer) => answer.section)));
  if (survey.rooms.length) completedSections.push("Rooms and measurements");
  if (survey.scopeItems.length) completedSections.push("Proposed scope");
  if (survey.pipeRuns.length) completedSections.push("Pipe runs");
  if (survey.equipmentItems.length) completedSections.push("Equipment");
  if (survey.photos.length) completedSections.push("Photographs");

  return {
    canComplete: blockers.length === 0,
    canSendToEstimator: blockers.length === 0 && pricingReadinessIssues.length === 0,
    blockers,
    pricingReadinessIssues,
    missingInformation,
    tbcItems,
    designDependencies,
    supplierRfqs,
    conflicts,
    workByOthers: survey.workByOthers,
    assumptions: survey.assumptions,
    completedSections: Array.from(new Set(completedSections)),
  };
}

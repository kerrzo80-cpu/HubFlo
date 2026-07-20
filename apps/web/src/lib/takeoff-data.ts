import { appendAuditEvent, getClientSites, type AuditEvent } from "@/lib/people-data";
import { getHubDetailState, saveHubDetailState } from "@/lib/hub-detail-store";
import { loadServerStore, writeServerStore } from "@/lib/server-store";
import { useDemoSeedData } from "@/lib/workspace-mode";
import { getQuotes, updateQuote, type Quote } from "@/lib/workflow-data";

export type TakeoffStatus = "Draft" | "In review" | "Approved" | "Pushed";
export type TakeoffDocumentKind = "Drawing" | "Specification" | "Contractor BOQ" | "Survey note" | "Survey photo" | "LiDAR scan";
export type TakeoffDocumentStatus = "Uploaded" | "Parsed" | "Needs review";
export type TakeoffSurveyAnswer = "Yes" | "No" | "Unknown" | "N/A";
export type TakeoffSurveyStep = "scope" | "stop-go" | "rooms" | "handoff";

export type TakeoffRoomScanSurface = {
  type: string;
  widthM: number;
  heightM: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  rotationDegrees?: number;
};

export type TakeoffRoomScanObject = {
  category: string;
  widthM: number;
  heightM: number;
  depthM: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  rotationDegrees?: number;
};

export type TakeoffRoomScanPreview = {
  roomName: string;
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  areaM2: number;
  wallCount: number;
  windowCount: number;
  doorCount: number;
  openingCount: number;
  objectCount: number;
  surfaces: TakeoffRoomScanSurface[];
  objects: TakeoffRoomScanObject[];
};

export type TakeoffSurveyStopGoItem = {
  id: string;
  section: string;
  question: string;
  answer: TakeoffSurveyAnswer;
  blockOn?: TakeoffSurveyAnswer;
  notes: string;
};

export type TakeoffSurveyQuestion = {
  id: string;
  section: string;
  question: string;
  required: boolean;
  answer: string;
};

export type TakeoffSurveyChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  createdAt: string;
  attachments?: string[];
};

export type TakeoffSurveyWorkflow = {
  projectType: string;
  propertyType: string;
  existingSystem: string;
  fuelType: string;
  hotWater: string;
  occupancy: string;
  plannedRoomCount: number;
  scopeNotes: string;
  step: TakeoffSurveyStep;
  stopGo: TakeoffSurveyStopGoItem[];
  aiQuestions: TakeoffSurveyQuestion[];
  generatedAt?: string;
  generatedBy?: "Pilot" | "OpenAI";
  completedAt?: string;
};

export type TakeoffDocument = {
  id: string;
  kind: TakeoffDocumentKind;
  fileName: string;
  mimeType?: string;
  size?: number;
  storageKey?: string;
  previewImageDataUrl?: string;
  roomScanPreview?: TakeoffRoomScanPreview;
  uploadedAt: string;
  status: TakeoffDocumentStatus;
  notes: string[];
};

export type TakeoffRoom = {
  id: string;
  name: string;
  level: string;
  lengthM?: number;
  widthM?: number;
  heightM?: number;
  outsideWalls?: number;
  windowAreaM2?: number;
  construction?: "Modern / insulated" | "Average" | "Older / exposed";
  glazing?: "Double glazed" | "Single glazed" | "Large glazing";
  areaM2: number;
  heatLoadWatts: number;
  notes: string;
};

export type TakeoffMeasurement = {
  id: string;
  roomId?: string;
  label: string;
  quantity: number;
  unit: string;
  source: "Drawing" | "Spec" | "BOQ" | "Manual" | "LiDAR";
};

export type TakeoffPipeRun = {
  id: string;
  roomId?: string;
  service: "Heating flow/return" | "Hot water" | "Cold water" | "Gas" | "Waste" | "Condensate" | "Other";
  route: string;
  diameter: string;
  material: string;
  lengthM: number;
  fittings: number;
  insulation: boolean;
  notes: string;
};

export type TakeoffRadiator = {
  id: string;
  roomId?: string;
  roomName: string;
  outputWatts: number;
  model: string;
  quantity: number;
  supplierRequired: boolean;
  notes: string;
};

export type TakeoffMaterialAllowance = {
  id: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  markupPercent: number;
  supplierRequired: boolean;
  preferredSupplier?: string;
  sourceDocumentId?: string;
};

export type TakeoffLabourAllowance = {
  id: string;
  section: string;
  role: string;
  hours: number;
  costRate: number;
  markupPercent: number;
  notes: string;
};

export type TakeoffSupplierRequestItem = {
  id: string;
  supplier: string;
  description: string;
  quantity: number;
  unit: string;
  linkedMaterialId?: string;
  notes: string;
};

export type TakeoffReview = {
  officeNotes: string;
  riskFlags: string[];
  approvedBy?: string;
  approvedAt?: string;
  pushedAt?: string;
  pushedQuoteId?: string;
  pushedQuoteRef?: string;
};

export type TakeoffExtractionSummary = {
  status: "Not run" | "Draft extracted";
  provider?: "Pilot" | "OpenAI";
  model?: string;
  requestedAt?: string;
  completedAt?: string;
  confidence: "Low" | "Medium" | "High";
  summary: string;
  questions: string[];
  sourceFiles?: number;
};

export type TakeoffExtractionDraft = {
  rooms: TakeoffRoom[];
  measurements: TakeoffMeasurement[];
  pipeRuns: TakeoffPipeRun[];
  radiators: TakeoffRadiator[];
  materialAllowances: TakeoffMaterialAllowance[];
  labourAllowances: TakeoffLabourAllowance[];
  supplierRequests: TakeoffSupplierRequestItem[];
  riskFlags: string[];
  questions: string[];
};

export type TakeoffMarkupService =
  | "Cold water"
  | "Hot water"
  | "Heating flow"
  | "Heating return"
  | "Gas"
  | "Waste"
  | "Soil"
  | "UFH"
  | "Condensate"
  | "Other";

export type TakeoffMarkupPoint = {
  x: number;
  y: number;
};

export type TakeoffMarkupPipe = {
  id: string;
  type: "pipe";
  service: TakeoffMarkupService;
  material: string;
  diameter: string;
  colour: string;
  points: TakeoffMarkupPoint[];
  floor: string;
  flat?: string;
  drawingDocumentId?: string;
  riseDropM: number;
  notes: string;
  included: boolean;
};

export type TakeoffMarkupSymbolCategory = "Fitting" | "Valve" | "Plant";

export type TakeoffMarkupSymbolKind =
  | "45 elbow"
  | "90 elbow"
  | "45 degree elbow"
  | "22.5 degree elbow"
  | "60 degree elbow"
  | "Reducing tee"
  | "Branch tee"
  | "Cross"
  | "Union coupling"
  | "Compression coupling"
  | "Soldered coupling"
  | "Push-fit coupling"
  | "Cap / blind end"
  | "Tee"
  | "Coupling"
  | "Union"
  | "Bend"
  | "Tee reducer"
  | "Reducer"
  | "End cap"
  | "Sweating cap"
  | "Ball valve"
  | "Gate valve"
  | "Globe valve"
  | "Check valve"
  | "Full bore valve"
  | "Pressure reducing valve"
  | "Temperature and pressure relief valve"
  | "Air vent"
  | "Angle stop"
  | "Stopcock"
  | "Gate cock"
  | "Stop valve"
  | "Concealed stopcock"
  | "Isolation valve"
  | "Shut-off valve"
  | "Zone valve"
  | "Thermostatic mixing valve"
  | "Air vent valve"
  | "Backflow preventer"
  | "Angle stop valve"
  | "Solenoid valve"
  | "TRV"
  | "Lockshield"
  | "Drain cock"
  | "Gas boiler"
  | "Combi boiler"
  | "System boiler"
  | "Cylinder"
  | "ASHP"
  | "UFH manifold"
  | "Pump"
  | "Boiler flue"
  | "Expansion vessel"
  | "Gas meter"
  | "Water main"
  | "Radiator panel"
  | "Convector heater"
  | "Manifold"
  | "Sluice valve"
  | "Flow temperature sensor"
  | "Return temperature sensor"
  | "Electrical isolator"
  | "Expansion tank"
  | "Soil stack"
  | "Tundish"
  | "Radiator"
  | "Towel radiator"
  | "WC"
  | "Basin"
  | "Bath"
  | "Shower tray"
  | "Shower valve"
  | "Kitchen sink"
  | (string & {});

export type TakeoffMarkupSymbol = {
  id: string;
  type: "symbol";
  category: TakeoffMarkupSymbolCategory;
  kind: TakeoffMarkupSymbolKind;
  x: number;
  y: number;
  rotation: number;
  floor?: string;
  flat?: string;
  drawingDocumentId?: string;
  service?: TakeoffMarkupService;
  material?: string;
  diameter?: string;
  linkedPipeId?: string;
  autoGenerated?: boolean;
  manufacturer?: string;
  model?: string;
  notes: string;
  included: boolean;
};

export type TakeoffServicesMarkup = {
  drawingDocumentId?: string;
  calibration: {
    status: "Uncalibrated" | "Calibrated";
    pixelsPerMetre?: number;
    realLengthM?: number;
    scaleLabel?: string;
  };
  settings: {
    wastagePercent: number;
    pipeStockLengthM: number;
    showGrid: boolean;
  };
  pipes: TakeoffMarkupPipe[];
  symbols: TakeoffMarkupSymbol[];
  assumptions: string[];
  updatedAt?: string;
};

export type TakeoffProject = {
  id: string;
  reference: string;
  name: string;
  customer: string;
  site: string;
  description: string;
  linkedQuoteId?: string;
  linkedQuoteRef?: string;
  linkedJobId?: string;
  linkedJobRef?: string;
  status: TakeoffStatus;
  documents: TakeoffDocument[];
  rooms: TakeoffRoom[];
  measurements: TakeoffMeasurement[];
  pipeRuns: TakeoffPipeRun[];
  radiators: TakeoffRadiator[];
  materialAllowances: TakeoffMaterialAllowance[];
  labourAllowances: TakeoffLabourAllowance[];
  supplierRequests: TakeoffSupplierRequestItem[];
  surveyWorkflow?: TakeoffSurveyWorkflow;
  surveyChat?: TakeoffSurveyChatMessage[];
  servicesMarkup?: TakeoffServicesMarkup;
  review: TakeoffReview;
  extraction?: TakeoffExtractionSummary;
  createdAt: string;
  updatedAt: string;
};

export type TakeoffStore = {
  projects: TakeoffProject[];
};

type QuoteCostLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell: number;
  supplierRequired?: boolean;
  rateSource?: "ratebook" | "manual";
};

type QuoteTakeoffRow = {
  id: string;
  source: "Takeoff" | "BOQ";
  section: string;
  description: string;
  quantity: number;
  unit: string;
  supplierRequired: boolean;
  unitCost: number;
  markupPercent: number;
};

type QuoteTakeoffDocument = {
  id: string;
  kind: "Drawings" | "Specification" | "Contractor BOQ" | "Survey evidence";
  fileName: string;
  previewImageDataUrl?: string;
  status: "Uploaded" | "Draft extracted" | "Needs review";
  confidence: "High" | "Medium" | "Low";
  extractedAt: string;
  questions: string[];
};

type QuoteHeatLossRoom = {
  id: string;
  name: string;
  roomType: string;
  length: string | number;
  width: string | number;
  height: string | number;
  exteriorWalls: number;
  wallType: string;
  glazingType: string;
  windowArea: string | number;
  floorType: string;
  ceilingType: string;
  heatingSystemType: "Hydronic" | "Electric";
  meanWaterTemperature: string | number;
  preferredRange: string;
  selectedRadiatorId?: string;
  markupPercent: string | number;
};

type QuoteCostCentre = {
  id: string;
  name: string;
  sectionId?: string;
  sectionName?: string;
  templateName?: string;
  clientDescription?: string;
  engineerDescription?: string;
  lines: QuoteCostLine[];
  takeoffRows?: QuoteTakeoffRow[];
  takeoffDocuments?: QuoteTakeoffDocument[];
  heatLossRooms?: QuoteHeatLossRoom[];
};

type QuoteSection = {
  id: string;
  name: string;
  description: string;
};

type TakeoffCostCentreGroup = {
  location: string;
  service: string;
  materialLines: TakeoffMaterialAllowance[];
  labourLines: TakeoffLabourAllowance[];
  pipeLines: TakeoffPipeRun[];
  radiatorLines: TakeoffRadiator[];
  supplierLines: TakeoffSupplierRequestItem[];
};

export type TakeoffPushResult = {
  project: TakeoffProject;
  quote: Quote;
  costCentre: QuoteCostCentre;
  costCentres: QuoteCostCentre[];
  auditEvent: AuditEvent;
  generated?: TakeoffExtractionResult["generated"];
  totalSell?: number;
};

export type TakeoffExtractionResult = {
  project: TakeoffProject;
  generated: {
    rooms: number;
    measurements: number;
    pipeRuns: number;
    radiators: number;
    materialAllowances: number;
    labourAllowances: number;
    supplierRequests: number;
  };
};

const seedCreatedAt = "2026-06-24T09:00:00.000Z";

export function createDefaultTakeoffSurveyWorkflow(
  patch: Partial<TakeoffSurveyWorkflow> = {},
): TakeoffSurveyWorkflow {
  return {
    projectType: "Full heating replacement",
    propertyType: "House",
    existingSystem: "Existing wet central heating",
    fuelType: "Gas",
    hotWater: "Combination boiler",
    occupancy: "Occupied",
    plannedRoomCount: 0,
    scopeNotes: "",
    step: "scope",
    stopGo: [
      {
        id: "access",
        section: "Access",
        question: "Is there safe access to every room, boiler location, loft/cupboards and external flue route?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "customer-scope",
        section: "Scope",
        question: "Has the customer confirmed the required outcome, rooms included and any rooms excluded?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "asbestos",
        section: "Risk",
        question: "Is asbestos, fragile material or unsafe fabric suspected where work is needed?",
        answer: "Unknown",
        blockOn: "Yes",
        notes: "",
      },
      {
        id: "isolation",
        section: "Services",
        question: "Can the existing heating, water and electrical services be isolated for replacement works?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "flue",
        section: "Boiler",
        question: "Is a compliant boiler/flue/condensate route visible or achievable?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
      {
        id: "photos",
        section: "Evidence",
        question: "Have photos been taken of boiler/cylinder, pipe routes, every room, windows, radiators and access constraints?",
        answer: "Unknown",
        blockOn: "No",
        notes: "",
      },
    ],
    aiQuestions: [
      {
        id: "boiler-position",
        section: "Boiler",
        question: "Where is the proposed heat source located and what access, flue and condensate constraints are visible?",
        required: true,
        answer: "",
      },
      {
        id: "room-schedule",
        section: "Rooms",
        question: "List every heated room with length, width, height, window sizes, outside walls and radiator preference.",
        required: true,
        answer: "",
      },
      {
        id: "pipe-strategy",
        section: "Pipework",
        question: "Will pipework be reused, partially replaced or fully renewed, and what routes are realistic?",
        required: true,
        answer: "",
      },
      {
        id: "making-good",
        section: "Exclusions",
        question: "What access, joinery, boxing-in, electrical, controls, decorations or making-good items need allowance or exclusion?",
        required: true,
        answer: "",
      },
    ],
    ...patch,
  };
}

const seedProject: TakeoffProject = {
  id: "takeoff-northfield-hopetoun",
  reference: "TK-3001",
  name: "Hopetoun boiler replacement takeoff",
  customer: "Northfield Properties",
  site: "10 Hopetoun Court, Aberdeen",
  description: "Separate Takeoff / BOQ pack for boiler replacement materials, radiator schedule and labour allowances.",
  linkedQuoteId: "quote-2061",
  linkedQuoteRef: "Q-2061",
  status: "In review",
  documents: [
    {
      id: "takeoff-doc-hopetoun-drawing",
      kind: "Drawing",
      fileName: "Hopetoun-plant-room-revB.pdf",
      mimeType: "application/pdf",
      size: 824000,
      uploadedAt: seedCreatedAt,
      status: "Needs review",
      notes: ["Confirm scale before final pipe quantities.", "Check wall penetrations with site team."],
    },
    {
      id: "takeoff-doc-hopetoun-boq",
      kind: "Contractor BOQ",
      fileName: "Contractor-BOQ-heating.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 156000,
      uploadedAt: seedCreatedAt,
      status: "Parsed",
      notes: ["Supplier request lines staged for valves and controls."],
    },
  ],
  rooms: [
    {
      id: "takeoff-room-plant",
      name: "Plant room",
      level: "Ground",
      lengthM: 4,
      widthM: 3,
      heightM: 2.4,
      areaM2: 12,
      heatLoadWatts: 0,
      notes: "Existing wall-hung boiler position with limited clearance.",
    },
    {
      id: "takeoff-room-office",
      name: "Open office",
      level: "First",
      lengthM: 8,
      widthM: 8,
      heightM: 2.6,
      areaM2: 64,
      heatLoadWatts: 6200,
      notes: "Radiator outputs to be checked against latest room layout.",
    },
  ],
  measurements: [
    {
      id: "takeoff-measure-pipe-route",
      roomId: "takeoff-room-plant",
      label: "Primary pipe route",
      quantity: 18,
      unit: "m",
      source: "Drawing",
    },
    {
      id: "takeoff-measure-office-heat",
      roomId: "takeoff-room-office",
      label: "Office heat load",
      quantity: 6200,
      unit: "W",
      source: "Manual",
    },
  ],
  pipeRuns: [
    {
      id: "takeoff-pipe-primary",
      roomId: "takeoff-room-plant",
      service: "Heating flow/return",
      route: "Plant room to riser",
      diameter: "28mm",
      material: "Copper",
      lengthM: 18,
      fittings: 14,
      insulation: true,
      notes: "Allow isolation valves and commissioning points.",
    },
  ],
  radiators: [
    {
      id: "takeoff-rad-office-1",
      roomId: "takeoff-room-office",
      roomName: "Open office",
      outputWatts: 6200,
      model: "K2 panel radiator schedule allowance",
      quantity: 3,
      supplierRequired: true,
      notes: "Supplier to confirm exact sizes against output.",
    },
  ],
  materialAllowances: [
    {
      id: "takeoff-material-boiler",
      section: "Boiler package",
      description: "Commercial boiler, flue and controls package",
      quantity: 1,
      unit: "item",
      unitCost: 2850,
      markupPercent: 30,
      supplierRequired: true,
      preferredSupplier: "Aldrite Plumbing Ltd",
      sourceDocumentId: "takeoff-doc-hopetoun-boq",
    },
    {
      id: "takeoff-material-pipe",
      section: "Pipework",
      description: "Copper pipe, fittings, valves and insulation",
      quantity: 1,
      unit: "allowance",
      unitCost: 680,
      markupPercent: 30,
      supplierRequired: true,
      preferredSupplier: "Aldrite Plumbing Ltd",
      sourceDocumentId: "takeoff-doc-hopetoun-drawing",
    },
    {
      id: "takeoff-material-consumables",
      section: "Preliminaries",
      description: "Consumables, fixings and waste allowance",
      quantity: 1,
      unit: "allowance",
      unitCost: 185,
      markupPercent: 25,
      supplierRequired: false,
    },
  ],
  labourAllowances: [
    {
      id: "takeoff-labour-install",
      section: "Installation",
      role: "Heating engineer",
      hours: 42,
      costRate: 38,
      markupPercent: 45,
      notes: "Includes strip-out, install, fill, test and commissioning support.",
    },
    {
      id: "takeoff-labour-office",
      section: "Office review",
      role: "Project manager",
      hours: 5,
      costRate: 42,
      markupPercent: 40,
      notes: "Commercial review, supplier coordination and handover pack.",
    },
  ],
  supplierRequests: [
    {
      id: "takeoff-supplier-boiler",
      supplier: "Aldrite Plumbing Ltd",
      description: "Commercial boiler, flue, controls, pipe and valve package",
      quantity: 1,
      unit: "package",
      linkedMaterialId: "takeoff-material-boiler",
      notes: "Include delivery and lead time.",
    },
    {
      id: "takeoff-supplier-rads",
      supplier: "Radiator merchant",
      description: "Radiator schedule for open office heat load",
      quantity: 3,
      unit: "each",
      linkedMaterialId: "takeoff-rad-office-1",
      notes: "Confirm outputs and bracket packs.",
    },
  ],
  surveyChat: [
    {
      id: "survey-chat-opening",
      role: "assistant",
      text: "What are we pricing today? Tell me the customer outcome first, then we can capture photos, room scan evidence and anything needed for the quote.",
      createdAt: seedCreatedAt,
    },
    {
      id: "survey-chat-scope",
      role: "user",
      text: "Boiler replacement with radiator schedule and pipework checks for Hopetoun Court.",
      createdAt: seedCreatedAt,
    },
    {
      id: "survey-chat-follow-up",
      role: "assistant",
      text: "Good. Next, capture the boiler location, flue route, condensate route, pipe routes and each heated room. If using iPad/iPhone room scan, attach the RoomPlan export so Takeoff can turn it into rooms and quantities.",
      createdAt: seedCreatedAt,
    },
  ],
  surveyWorkflow: createDefaultTakeoffSurveyWorkflow({
    plannedRoomCount: 2,
    scopeNotes: "Pilot workflow for a heating replacement survey with office review before quote handoff.",
    step: "handoff",
  }),
  review: {
    officeNotes: "Ready for office check before pushing into Q-2061.",
    riskFlags: ["Drawing scale unconfirmed", "Supplier lead times required"],
  },
  createdAt: seedCreatedAt,
  updatedAt: seedCreatedAt,
};

const defaultTakeoffStore: TakeoffStore = {
  projects: useDemoSeedData() ? [seedProject] : [],
};

let takeoffStore = loadServerStore("takeoff-store", defaultTakeoffStore);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persistTakeoffStore() {
  writeServerStore("takeoff-store", takeoffStore);
}

function refreshTakeoffStore() {
  takeoffStore = loadServerStore("takeoff-store", defaultTakeoffStore);
  return takeoffStore;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nextReference(projects: TakeoffProject[]) {
  const currentMax = Math.max(
    3000,
    ...projects.map((project) => Number(project.reference.replace(/\D/g, "")) || 0),
  );
  return `TK-${currentMax + 1}`;
}

function normaliseLookup(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function findTakeoffProjectIndexByLookup(value: string) {
  const lookup = normaliseLookup(value);
  if (!lookup) return -1;
  return takeoffStore.projects.findIndex((project) =>
    [
      project.id,
      project.reference,
      project.linkedQuoteId,
      project.linkedQuoteRef,
    ].some((candidate) => normaliseLookup(candidate) === lookup),
  );
}

function findLinkedQuote(quoteIdOrRef?: string) {
  const lookup = normaliseLookup(quoteIdOrRef);
  if (!lookup) return undefined;
  return getQuotes().find((quote) => normaliseLookup(quote.id) === lookup || normaliseLookup(quote.ref) === lookup);
}

function linkedQuoteSiteAddress(quote?: Quote) {
  if (!quote?.siteId) return undefined;
  return getClientSites().find((site) => site.id === quote.siteId)?.address;
}

function lineSellFromMarkup(unitCost: number, markupPercent: number) {
  return Math.round(unitCost * (1 + markupPercent / 100) * 100) / 100;
}

function inferTemplateName(project: TakeoffProject) {
  const text = `${project.name} ${project.description} ${surveyUserText(project)}`.toLowerCase();
  if (isRadiatorRelocationScope(text, surveyChatText(project).toLowerCase())) return "Heating remedials";
  if (text.includes("boiler")) return "Boiler replacement";
  if (text.includes("heating") || text.includes("radiator")) return "Heating remedials";
  if (text.includes("bathroom")) return "Bathroom refurbishment";
  return "General plumbing";
}

function quoteDocumentKind(kind: TakeoffDocumentKind): QuoteTakeoffDocument["kind"] {
  if (kind === "Survey note" || kind === "Survey photo" || kind === "LiDAR scan") return "Survey evidence";
  return kind === "Drawing" ? "Drawings" : kind;
}

function documentNeedsOfficeReview(kind: TakeoffDocumentKind) {
  return kind === "Drawing" || kind === "Survey note" || kind === "Survey photo" || kind === "LiDAR scan";
}

function quoteDocumentStatus(status: TakeoffDocumentStatus): QuoteTakeoffDocument["status"] {
  if (status === "Parsed") return "Draft extracted";
  if (status === "Needs review") return "Needs review";
  return "Uploaded";
}

function roomName(project: TakeoffProject, roomId?: string) {
  if (!roomId) return undefined;
  return project.rooms.find((room) => room.id === roomId)?.name;
}

function buildClientDescription(project: TakeoffProject) {
  const roomCount = project.rooms.length;
  const materialCount = project.materialAllowances.length;
  const labourHours = project.labourAllowances.reduce((sum, line) => sum + line.hours, 0);
  const scope = estimateScopeText(project).trim();
  return [
    scope || project.description.trim(),
    `${roomCount} room${roomCount === 1 ? "" : "s"} reviewed with ${materialCount} material allowance${materialCount === 1 ? "" : "s"} and ${labourHours.toFixed(1)} labour hours.`,
  ].filter(Boolean).join(" ");
}

function buildEngineerDescription(project: TakeoffProject) {
  const scope = estimateScopeText(project).trim();
  const measurements = project.measurements
    .map((measurement) => {
      const location = roomName(project, measurement.roomId);
      return `${location ? `${location}: ` : ""}${measurement.label} ${measurement.quantity} ${measurement.unit}`;
    })
    .join("; ");
  const pipeRuns = project.pipeRuns
    .map((run) => `${run.service} ${run.route}: ${run.lengthM}m ${run.diameter} ${run.material}${run.insulation ? " insulated" : ""}`)
    .join("; ");
  const radiators = project.radiators
    .map((radiator) => `${radiator.roomName}: ${radiator.quantity} x ${radiator.model} (${radiator.outputWatts}W)`)
    .join("; ");

  return [
    scope ? `Survey scope: ${scope}.` : "",
    measurements ? `Measurements: ${measurements}.` : "",
    pipeRuns ? `Pipe runs: ${pipeRuns}.` : "",
    radiators ? `Radiator schedule: ${radiators}.` : "",
    project.review.riskFlags.length ? `Office flags: ${project.review.riskFlags.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

function buildQuoteTakeoffDocuments(project: TakeoffProject): QuoteTakeoffDocument[] {
  return project.documents.map((document) => ({
    id: document.id,
    kind: quoteDocumentKind(document.kind),
    fileName: document.fileName,
    previewImageDataUrl: document.previewImageDataUrl,
    status: quoteDocumentStatus(document.status),
    confidence: document.status === "Parsed" ? "High" : document.status === "Needs review" ? "Medium" : "Low",
    extractedAt: document.uploadedAt,
    questions: document.notes,
  }));
}

function buildMaterialTakeoffRows(project: TakeoffProject): QuoteTakeoffRow[] {
  return project.materialAllowances.map((line) => ({
    id: `takeoff-row-${line.id}`,
    source: "BOQ" as const,
    section: line.section,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    supplierRequired: line.supplierRequired,
    unitCost: line.unitCost,
    markupPercent: line.markupPercent,
  }));
}

function buildPipeTakeoffRows(project: TakeoffProject): QuoteTakeoffRow[] {
  return project.pipeRuns.map((run) => ({
    id: `takeoff-row-${run.id}`,
    source: "Takeoff" as const,
    section: roomName(project, run.roomId) ?? "Pipe runs",
    description: `${run.service} - ${run.route}`,
    quantity: run.lengthM,
    unit: "m",
    supplierRequired: true,
    unitCost: 0,
    markupPercent: 30,
  }));
}

function buildRadiatorTakeoffRows(project: TakeoffProject): QuoteTakeoffRow[] {
  return project.radiators.map((radiator) => ({
    id: `takeoff-row-${radiator.id}`,
    source: "Takeoff" as const,
    section: radiator.roomName || "Radiator schedule",
    description: radiator.model,
    quantity: radiator.quantity,
    unit: "each",
    supplierRequired: radiator.supplierRequired,
    unitCost: 0,
    markupPercent: 30,
  }));
}

function buildSupplierTakeoffRows(project: TakeoffProject): QuoteTakeoffRow[] {
  return project.supplierRequests.map((line) => ({
    id: `takeoff-row-${line.id}`,
    source: "Takeoff" as const,
    section: line.supplier || "Supplier request",
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    supplierRequired: true,
    unitCost: 0,
    markupPercent: 30,
  }));
}

function roomToLocation(project: TakeoffProject, roomId?: string, roomName?: string): string {
  const room = roomId
    ? project.rooms.find((item) => item.id === roomId)
    : project.rooms.find((item) => item.name.toLowerCase() === (roomName ?? "").toLowerCase());
  if (!room) return roomName?.trim() || "General";

  const cleanedName = room.name.trim();
  const level = room.level?.trim();
  const hasFlatHint = /\bflat\b/i.test(cleanedName);
  const hasLevelHint = level ? /\b(floor|level)\b/i.test(level) : false;

  if (hasFlatHint) return cleanedName;
  if (hasLevelHint && level) return `${level} - ${cleanedName}`;
  if (level) return `${level}: ${cleanedName}`;
  return cleanedName;
}

function locateLocationInSection(section: string, rooms: TakeoffRoom[]) {
  const cleaned = section.trim().toLowerCase();
  if (!cleaned) return undefined;

  const roomByName = rooms
    .map((room) => ({ room, key: room.name.trim().toLowerCase() }))
    .sort((left, right) => right.key.length - left.key.length);

  return roomByName.find(({ key }) => key && (cleaned === key || cleaned.includes(key) || new RegExp(`\\b${escapeRegExp(key)}\\b`, "i").test(cleaned)))?.room.name;
}

function stripLocationFromSection(section: string, location: string) {
  const trimmed = section.trim();
  const normalisedLocation = location.trim();
  if (!trimmed || !normalisedLocation) return trimmed || "General";
  if (trimmed.toLowerCase() === normalisedLocation.toLowerCase()) return "General";

  const locationLower = normalisedLocation.toLowerCase();
  const parts = trimmed
    .split(/\s*(?:\/|\||·|—|-)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const filtered = parts.filter((part) => part.toLowerCase() !== locationLower);
  if (parts.some((part) => part.toLowerCase() === locationLower)) {
    const joined = filtered.join(" / ");
    if (joined) return joined;
    return "General";
  }

  const startsWithLocation = new RegExp(`^\\s*${escapeRegExp(normalisedLocation)}\\s*[\\/\\|·—-]\\s*(.*)$`, "i");
  const endsWithLocation = new RegExp(`^(.*?)\\s*[\\/\\|·—-]\\s*${escapeRegExp(normalisedLocation)}\\s*$`, "i");

  const startMatch = startsWithLocation.exec(trimmed);
  if (startMatch?.[1]) return startMatch[1].trim() || "General";

  const endMatch = endsWithLocation.exec(trimmed);
  if (endMatch?.[1]) return endMatch[1].trim() || "General";

  return "General";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferMaterialLabourLocationAndService(section: string, roomHint?: string, rooms: TakeoffRoom[] = []) {
  if (roomHint && roomHint !== "General") {
    return { location: roomHint, service: section || "General" };
  }

  const trimmed = (section ?? "").trim();
  if (!trimmed) return { location: "General", service: "General" };

  const roomFromSection = locateLocationInSection(trimmed, rooms);
  if (roomFromSection) {
    const service = stripLocationFromSection(trimmed, roomFromSection);
    return { location: roomFromSection, service };
  }

  const separators = [" / ", " | ", " - ", " · "];
  for (const separator of separators) {
    const index = trimmed.indexOf(separator);
    if (index <= 0 || index >= trimmed.length - separator.length) continue;
    const left = trimmed.slice(0, index).trim();
    const right = trimmed.slice(index + separator.length).trim();

    const leftLooksLikeLocation = /\b(floor|flat|level|ground|first|second|third|basement|terrace|unit|apartment|suite)\b/i.test(left);
    const rightLooksLikeLocation = /\b(floor|flat|level|ground|first|second|third|basement|terrace|unit|apartment|suite)\b/i.test(right);

    if (leftLooksLikeLocation && !rightLooksLikeLocation) return { location: left, service: right };
    if (rightLooksLikeLocation && !leftLooksLikeLocation) return { location: right, service: left };
    return { location: left, service: right };
  }

  return { location: "General", service: trimmed };
}

function mapSupplierRequestToGroup(supplier: TakeoffSupplierRequestItem, project: TakeoffProject) {
  if (!supplier.linkedMaterialId) {
    return {
      location: "General",
      service: supplier.supplier || "Supplier requests",
    };
  }

  const linkedMaterial = project.materialAllowances.find((material) => material.id === supplier.linkedMaterialId);
  if (!linkedMaterial) {
    return {
      location: "General",
      service: supplier.supplier || "Supplier requests",
    };
  }

  const parsed = inferMaterialLabourLocationAndService(linkedMaterial.section, undefined, project.rooms);
  return {
    location: parsed.location,
    service: parsed.service,
  };
}

function buildQuoteMaterialLines(project: TakeoffProject): QuoteCostLine[] {
  return project.materialAllowances.map((line) => ({
    id: `takeoff-material-line-${line.id}`,
    catalogItemId: "takeoff-boq",
    description: `${line.section} - ${line.description}`,
    quantity: line.quantity,
    unitCost: line.unitCost,
    unitSell: lineSellFromMarkup(line.unitCost, line.markupPercent),
    supplierRequired: line.supplierRequired,
  }));
}

function buildQuoteRadiatorLines(project: TakeoffProject): QuoteCostLine[] {
  return project.radiators.map((radiator) => ({
    id: `takeoff-radiator-line-${radiator.id}`,
    catalogItemId: "takeoff-boq",
    description: `${radiator.roomName || "Radiator schedule"} - ${radiator.model}`,
    quantity: radiator.quantity,
    unitCost: 0,
    unitSell: 0,
    supplierRequired: radiator.supplierRequired,
  }));
}

function buildQuoteLabourLines(project: TakeoffProject): QuoteCostLine[] {
  return project.labourAllowances.map((line) => ({
    id: `takeoff-labour-line-${line.id}`,
    catalogItemId: "labour-engineer",
    description: `${line.section} - ${line.role}`,
    quantity: line.hours,
    unitCost: line.costRate,
    unitSell: lineSellFromMarkup(line.costRate, line.markupPercent),
    rateSource: "manual",
  }));
}

function roomAreaDimensions(areaM2: number) {
  const safeArea = Math.max(0, areaM2);
  if (!safeArea) return { length: "", width: "" };
  const length = Math.sqrt(safeArea * 1.35);
  const width = safeArea / length;
  return {
    length: Number(length.toFixed(2)),
    width: Number(width.toFixed(2)),
  };
}

function buildQuoteHeatLossRooms(project: TakeoffProject): QuoteHeatLossRoom[] {
  return project.rooms
    .filter((room) => room.heatLoadWatts > 0 || project.radiators.some((radiator) => radiator.roomId === room.id))
    .map((room) => {
      const dimensions = roomAreaDimensions(room.areaM2);
      return {
        id: `takeoff-heat-${room.id}`,
        name: room.name,
        roomType: /bath|wc/i.test(room.name) ? "Bathroom" : /bed/i.test(room.name) ? "Bedroom" : "Living Room",
        length: room.lengthM || dimensions.length,
        width: room.widthM || dimensions.width,
        height: room.heightM || 2.4,
        exteriorWalls: 1,
        wallType: "Brick cavity wall",
        glazingType: "Wood/PVCu Double Glazed",
        windowArea: "",
        floorType: "Heated room",
        ceilingType: "Heated room",
        heatingSystemType: "Hydronic",
        meanWaterTemperature: 70,
        preferredRange: "Any range",
        markupPercent: 30,
      };
    });
}

function buildSplitQuoteCostCentre(
  quoteId: string,
  project: TakeoffProject,
  key: string,
  name: string,
  lines: QuoteCostLine[],
  takeoffRows: QuoteTakeoffRow[] = [],
  heatLossRooms: QuoteHeatLossRoom[] = [],
): QuoteCostCentre | null {
  if (!lines.length && !takeoffRows.length && !heatLossRooms.length) return null;

  return {
    id: `${quoteId}-takeoff-${project.id}-${key}`,
    name,
    templateName: inferTemplateName(project),
    clientDescription: buildClientDescription(project),
    engineerDescription: buildEngineerDescription(project),
    lines,
    takeoffRows,
    takeoffDocuments: buildQuoteTakeoffDocuments(project),
    heatLossRooms,
  };
}

function costCentreKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

function materialLineToQuoteLine(line: TakeoffMaterialAllowance): QuoteCostLine {
  return {
    id: `takeoff-material-line-${line.id}`,
    catalogItemId: "takeoff-boq",
    description: line.description,
    quantity: line.quantity,
    unitCost: line.unitCost,
    unitSell: lineSellFromMarkup(line.unitCost, line.markupPercent),
    supplierRequired: line.supplierRequired,
  };
}

function labourLineToQuoteLine(line: TakeoffLabourAllowance): QuoteCostLine {
  return {
    id: `takeoff-labour-line-${line.id}`,
    catalogItemId: "labour-engineer",
    description: line.role,
    quantity: line.hours,
    unitCost: line.costRate,
    unitSell: lineSellFromMarkup(line.costRate, line.markupPercent),
    rateSource: "manual",
  };
}

function materialTakeoffRow(line: TakeoffMaterialAllowance): QuoteTakeoffRow {
  return {
    id: `takeoff-row-${line.id}`,
    source: "BOQ" as const,
    section: line.section,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    supplierRequired: line.supplierRequired,
    unitCost: line.unitCost,
    markupPercent: line.markupPercent,
  };
}

function supplierRequestSection(project: TakeoffProject, line: TakeoffSupplierRequestItem) {
  return project.materialAllowances.find((material) => material.id === line.linkedMaterialId)?.section;
}

function supplierTakeoffRow(line: TakeoffSupplierRequestItem, section: string): QuoteTakeoffRow {
  return {
    id: `takeoff-row-${line.id}`,
    source: "Takeoff" as const,
    section,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    supplierRequired: true,
    unitCost: 0,
    markupPercent: 30,
  };
}

function buildSectionQuoteCostCentres(project: TakeoffProject, quoteId: string): QuoteCostCentre[] {
  const groups = new Map<string, TakeoffCostCentreGroup>();
  const locate = (location: string, service: string) => `${location.toLowerCase()}||${costCentreKey(service)}`;

  const ensureGroup = (location: string, service: string) => {
    const key = locate(location, service);
    if (!groups.has(key)) {
      groups.set(key, {
        location,
        service,
        materialLines: [],
        labourLines: [],
        pipeLines: [],
        radiatorLines: [],
        supplierLines: [],
      });
    }

    return groups.get(key)!;
  };

  const normalizedSectionRows = project.materialAllowances.map((line) => {
    const parsed = inferMaterialLabourLocationAndService(line.section, undefined, project.rooms);
    const location = roomToLocation(project, undefined, parsed.location !== "General" ? parsed.location : undefined);
    return { line, location: location, service: parsed.service };
  });

  normalizedSectionRows.forEach(({ line, location, service }) => {
    const group = ensureGroup(location, service);
    group.materialLines.push(line);
  });

  const normalisedLabour = project.labourAllowances.map((line) => {
    const parsed = inferMaterialLabourLocationAndService(line.section, undefined, project.rooms);
    const location = roomToLocation(project, undefined, parsed.location !== "General" ? parsed.location : undefined);
    return { line, location, service: parsed.service };
  });

  normalisedLabour.forEach(({ line, location, service }) => {
    const group = ensureGroup(location, service);
    group.labourLines.push(line);
  });

  project.pipeRuns.forEach((run) => {
    const location = roomToLocation(project, run.roomId);
    const service = `Pipework - ${run.service}`;
    const group = ensureGroup(location, service);
    group.pipeLines.push(run);
  });

  project.radiators.forEach((radiator) => {
    const location = roomToLocation(project, undefined, radiator.roomName);
    const service = "Radiators / Heat emitters";
    const group = ensureGroup(location, service);
    group.radiatorLines.push(radiator);
  });

  project.supplierRequests.forEach((line) => {
    const mapped = mapSupplierRequestToGroup(line, project);
    const service = mapped.service || "Supplier requests";
    const group = ensureGroup(mapped.location, service);
    group.supplierLines.push(line);
  });

  const quoteHeatLoss = buildQuoteHeatLossRooms(project);
  const locationOrder = Array.from(new Set(
    Array.from(groups.keys()).map((key) => {
      const [location] = key.split("||", 2);
      return location?.trim();
    }),
  )).filter((location): location is string => Boolean(location));

  const quoteSections = locationOrder.map((location) => ({
    id: `takeoff-location-${quoteId}-${costCentreKey(location)}`,
    name: location,
    description: "",
  }));

  const sectionIdByLocation = new Map<string, string>(
    quoteSections.map((section) => [section.name.toLowerCase(), section.id]),
  );

  const costCentres = Array.from(groups.entries()).map(([key, group]) => {
    const [rawLocation] = key.split("||", 2);
    const sectionName = rawLocation || "General";

    const groupHeatLossRooms = quoteHeatLoss.filter((room) => {
      const roomName = room.name.toLowerCase();
      const hasRadiator = group.radiatorLines.some((radiator) => radiator.roomName.toLowerCase() === roomName);
      return hasRadiator || group.location.toLowerCase() === roomName;
    });

    return buildSplitQuoteCostCentre(
      quoteId,
      project,
      `location-${costCentreKey(sectionName)}-${costCentreKey(group.service)}`,
      group.service,
      [
        ...group.materialLines.map(materialLineToQuoteLine),
        ...group.labourLines.map(labourLineToQuoteLine),
      ],
      [
        ...group.materialLines.map(materialTakeoffRow),
        ...group.pipeLines.map((run) => ({
          id: `takeoff-row-${run.id}`,
          source: "Takeoff" as const,
          section: group.service,
          description: `${run.service} - ${run.route}`,
          quantity: run.lengthM,
          unit: "m",
          supplierRequired: true,
          unitCost: 0,
          markupPercent: 30,
        })),
        ...group.radiatorLines.map((radiator) => ({
          id: `takeoff-row-${radiator.id}`,
          source: "Takeoff" as const,
          section: group.service,
          description: radiator.model,
          quantity: radiator.quantity,
          unit: "each",
          supplierRequired: radiator.supplierRequired,
          unitCost: 0,
          markupPercent: 30,
        })),
        ...group.supplierLines.map((supplierLine) => supplierTakeoffRow(supplierLine, group.service)),
      ],
      groupHeatLossRooms,
    );
  }).filter((centre): centre is QuoteCostCentre => Boolean(centre));

  return costCentres.map((centre, index) => {
    const groupEntry = Array.from(groups.values())[index];
    if (!groupEntry) {
      return {
        ...centre,
        sectionName: "General",
        sectionId: `takeoff-location-${quoteId}-general`,
      };
    }

    const sectionId = sectionIdByLocation.get(groupEntry.location.toLowerCase())
      ?? `takeoff-location-${quoteId}-${costCentreKey(groupEntry.location)}`;

    return {
      ...centre,
      sectionName: groupEntry.location,
      sectionId,
    };
  });
}

function buildQuoteSectionsFromCostCentres(quoteId: string, costCentres: QuoteCostCentre[]) {
  const knownSections = new Map<string, QuoteSection>();

  costCentres.forEach((centre) => {
    if (!centre.sectionId) return;
    if (knownSections.has(centre.sectionId)) return;
    knownSections.set(centre.sectionId, {
      id: centre.sectionId,
      name: centre.sectionName || (centre.sectionId === `takeoff-location-${quoteId}-general` ? "General" : centre.sectionId.replace(`takeoff-location-${quoteId}-`, "")),
      description: "",
    });
  });

  if (!knownSections.size && costCentres.length) {
    const fallback = `takeoff-location-${quoteId}-general`;
    knownSections.set(fallback, { id: fallback, name: "General", description: "" });
  }

  return Array.from(knownSections.values());
}

function buildQuoteCostCentres(project: TakeoffProject, quoteId: string): QuoteCostCentre[] {
  const sectionCentres = buildSectionQuoteCostCentres(project, quoteId);
  if (sectionCentres.length) {
    return sectionCentres;
  }

  const centres = [
    buildSplitQuoteCostCentre(
      quoteId,
      project,
      "materials",
      `BOQ / Materials - ${project.name}`,
      buildQuoteMaterialLines(project),
      buildMaterialTakeoffRows(project),
    ),
    buildSplitQuoteCostCentre(
      quoteId,
      project,
      "pipework",
      `Pipework - ${project.name}`,
      [],
      buildPipeTakeoffRows(project),
    ),
    buildSplitQuoteCostCentre(
      quoteId,
      project,
      "radiators",
      `Radiators / Heat emitters - ${project.name}`,
      buildQuoteRadiatorLines(project),
      buildRadiatorTakeoffRows(project),
      buildQuoteHeatLossRooms(project),
    ),
    buildSplitQuoteCostCentre(
      quoteId,
      project,
      "labour",
      `Labour - ${project.name}`,
      buildQuoteLabourLines(project),
    ),
    buildSplitQuoteCostCentre(
      quoteId,
      project,
      "supplier-requests",
      `Supplier requests - ${project.name}`,
      [],
      buildSupplierTakeoffRows(project),
    ),
  ].filter((centre): centre is QuoteCostCentre => Boolean(centre));

  if (centres.length) return centres;

  return [{
    id: `${quoteId}-takeoff-${project.id}-summary`,
    name: `Takeoff / BOQ - ${project.name}`,
    templateName: inferTemplateName(project),
    clientDescription: buildClientDescription(project),
    engineerDescription: buildEngineerDescription(project),
    lines: [],
    takeoffRows: [],
    takeoffDocuments: buildQuoteTakeoffDocuments(project),
  }];
}

function quoteCentreSell(centre: QuoteCostCentre) {
  return centre.lines.reduce((sum, line) => sum + line.quantity * line.unitSell, 0);
}

function quoteDescriptionFromProject(project: TakeoffProject, quote: Quote) {
  const scope = estimateScopeText(project).trim();
  const focusedText = `${project.name} ${project.description} ${surveyUserText(project) || scope}`.toLowerCase();
  if (isRadiatorRelocationScope(focusedText, surveyChatText(project).toLowerCase())) {
    return radiatorRelocationClientScope(project, countRadiatorsFromSurveyText(focusedText));
  }
  if (!scope || ["customer to confirm", "takeoff scope to review.", "survey conversation started from nexa survey."].includes(scope.toLowerCase())) {
    return quote.description;
  }
  return scope;
}

function applyProjectCostCentresToQuote(
  project: TakeoffProject,
  quote: Quote,
  actor: string,
  source: "survey" | "takeoff",
) {
  const costCentres = buildQuoteCostCentres(project, quote.id);
  const costCentre = costCentres[0];
  if (!costCentre) return null;

  const hubState = getHubDetailState();
  const currentQuoteCostCentres = (hubState.quoteCostCentres ?? {}) as Record<string, unknown>;
  const existingCentres = Array.isArray(currentQuoteCostCentres[quote.id])
    ? (currentQuoteCostCentres[quote.id] as QuoteCostCentre[])
    : [];
  const splitCentreIds = new Set(costCentres.map((centre) => centre.id));
  const legacyCentreId = `${quote.id}-takeoff-${project.id}`;
  const projectCentrePrefix = `${quote.id}-takeoff-${project.id}-`;
  const nextQuoteCentres = [
    ...existingCentres.filter((centre) => !splitCentreIds.has(centre.id) && centre.id !== legacyCentreId && !centre.id.startsWith(projectCentrePrefix)),
    ...costCentres,
  ];
  const nextQuoteSections = {
    ...(hubState.quoteSections || {}),
    [quote.id]: buildQuoteSectionsFromCostCentres(quote.id, costCentres),
  };
  const nextQuoteCostCentres = {
    ...currentQuoteCostCentres,
    [quote.id]: nextQuoteCentres,
  };

  saveHubDetailState({
    ...hubState,
    quoteSections: nextQuoteSections,
    quoteCostCentres: nextQuoteCostCentres,
  });

  const totalSell = Math.round(nextQuoteCentres.reduce((sum, centre) => sum + quoteCentreSell(centre), 0));
  const updatedQuote = updateQuote(quote.id, {
    description: source === "survey" ? quoteDescriptionFromProject(project, quote) : quote.description,
    value: totalSell,
    next: source === "survey"
      ? `Review ${project.reference} survey-built cost centres`
      : `Review ${project.reference} Takeoff / BOQ output`,
  }) ?? quote;

  const label = source === "survey" ? "Survey" : "Takeoff / BOQ";
  const sourceLabel = source === "survey" ? "survey assistant" : "takeoff add-on";
  const auditEvent = appendAuditEvent({
    actor,
    action: "pushed",
    recordType: "quote",
    recordId: quote.id,
    summary: `${project.reference} ${label} pushed into ${quote.ref}: ${costCentres.length} cost centre(s), ${costCentres.reduce((sum, centre) => sum + centre.lines.length, 0)} line(s), ${project.supplierRequests.length} supplier request item(s).`,
    source: sourceLabel,
    importance: "high",
  });

  return {
    quote: updatedQuote,
    costCentre,
    costCentres,
    auditEvent,
    totalSell,
  };
}

export function attachSurveyEvidenceToQuote(
  projectId: string,
  quoteId: string,
  actor = "NeXa Field",
) {
  refreshTakeoffStore();
  const project = takeoffStore.projects.find((item) => item.id === projectId);
  const quote = getQuotes().find((item) => item.id === quoteId);
  if (!project || !quote) return null;

  const takeoffDocuments = buildQuoteTakeoffDocuments(project).filter((document) => document.kind === "Survey evidence");
  if (!takeoffDocuments.length) return null;

  const hubState = getHubDetailState();
  const currentQuoteCostCentres = (hubState.quoteCostCentres ?? {}) as Record<string, unknown>;
  const existingCentres = Array.isArray(currentQuoteCostCentres[quote.id])
    ? (currentQuoteCostCentres[quote.id] as QuoteCostCentre[])
    : [];
  const centreId = `${quote.id}-takeoff-${project.id}-summary`;
  const existingCentre = existingCentres.find((centre) => centre.id === centreId);
  const evidenceCentre: QuoteCostCentre = {
    id: centreId,
    name: existingCentre?.name ?? `Survey evidence - ${project.name}`,
    templateName: existingCentre?.templateName ?? inferTemplateName(project),
    clientDescription: existingCentre?.clientDescription ?? buildClientDescription(project),
    engineerDescription: existingCentre?.engineerDescription ?? buildEngineerDescription(project),
    lines: existingCentre?.lines ?? [],
    takeoffRows: existingCentre?.takeoffRows ?? [],
    takeoffDocuments,
    heatLossRooms: existingCentre?.heatLossRooms ?? buildQuoteHeatLossRooms(project),
  };

  const nextQuoteCentres = [
    ...existingCentres.filter((centre) => centre.id !== centreId),
    evidenceCentre,
  ];

  saveHubDetailState({
    ...hubState,
    quoteCostCentres: {
      ...currentQuoteCostCentres,
      [quote.id]: nextQuoteCentres,
    },
  });

  const updatedQuote = updateQuote(quote.id, {
    next: `Review ${project.reference} LiDAR survey evidence`,
  }) ?? quote;

  const auditEvent = appendAuditEvent({
    actor,
    action: "attached",
    recordType: "quote",
    recordId: quote.id,
    summary: `${project.reference} LiDAR room scan attached to ${quote.ref}.`,
    source: "field scanner",
    importance: "normal",
  });

  return {
    project: clone(project),
    quote: updatedQuote,
    costCentre: evidenceCentre,
    auditEvent,
  };
}

function documentBaseName(document: TakeoffDocument) {
  return document.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || document.kind;
}

function mergeById<T extends { id: string }>(current: T[], generated: T[]) {
  const merged = new Map<string, T>();
  current.forEach((item) => merged.set(item.id, item));
  generated.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

function buildDraftExtraction(project: TakeoffProject): TakeoffExtractionDraft {
  const generatedRooms: TakeoffRoom[] = [];
  const generatedMeasurements: TakeoffMeasurement[] = [];
  const generatedPipeRuns: TakeoffPipeRun[] = [];
  const generatedRadiators: TakeoffRadiator[] = [];
  const generatedMaterials: TakeoffMaterialAllowance[] = [];
  const generatedLabour: TakeoffLabourAllowance[] = [];
  const generatedSupplierRequests: TakeoffSupplierRequestItem[] = [];
  const riskFlags = new Set(project.review.riskFlags);
  const questions = new Set<string>();

  project.documents.forEach((document, index) => {
    const baseName = documentBaseName(document);
    const drawingRoomId = `ai-room-${document.id}`;
    const baseLength = 12 + (index * 4);

    if (document.kind === "Drawing") {
      const roomName = /plant/i.test(baseName) ? "Plant room" : `Drawing area ${index + 1}`;
      generatedRooms.push({
        id: drawingRoomId,
        name: roomName,
        level: /first|1st/i.test(baseName) ? "First" : "Ground",
        lengthM: /office/i.test(baseName) ? 8 : 4.5,
        widthM: /office/i.test(baseName) ? 6 : 4,
        heightM: 2.4,
        areaM2: /office/i.test(baseName) ? 48 : 18,
        heatLoadWatts: /office|radiator|heating/i.test(baseName) ? 4200 : 0,
        notes: `Draft room created from ${document.fileName}.`,
      });
      generatedMeasurements.push(
        {
          id: `ai-measure-${document.id}-pipe`,
          roomId: drawingRoomId,
          label: "Pipe route from drawing",
          quantity: baseLength,
          unit: "m",
          source: "Drawing",
        },
        {
          id: `ai-measure-${document.id}-fittings`,
          roomId: drawingRoomId,
          label: "Fittings allowance from route changes",
          quantity: Math.max(8, Math.round(baseLength * 0.7)),
          unit: "nr",
          source: "Drawing",
        },
      );
      generatedPipeRuns.push({
        id: `ai-pipe-${document.id}`,
        roomId: drawingRoomId,
        service: "Heating flow/return",
        route: `${roomName} route from ${baseName}`,
        diameter: /boiler|plant/i.test(baseName) ? "28mm" : "22mm",
        material: "Copper",
        lengthM: baseLength,
        fittings: Math.max(8, Math.round(baseLength * 0.7)),
        insulation: /plant|heating/i.test(baseName),
        notes: "Draft from drawing extraction; confirm scale before approval.",
      });
      if (/office|radiator|heating/i.test(`${baseName} ${project.description}`)) {
        generatedRadiators.push({
          id: `ai-radiator-${document.id}`,
          roomId: drawingRoomId,
          roomName,
          outputWatts: 4200,
          model: "Panel radiator schedule allowance",
          quantity: 2,
          supplierRequired: true,
          notes: "Draft radiator allowance; supplier to confirm outputs and sizes.",
        });
      }
      riskFlags.add("Drawing extraction needs scale/revision check");
      questions.add("Confirm drawing scale before approving measured lengths.");
      return;
    }

    if (document.kind === "Specification") {
      const specMaterialId = `ai-material-${document.id}-specified`;
      generatedMaterials.push({
        id: specMaterialId,
        section: "Specification",
        description: "Specified valves, controls and accessories",
        quantity: 1,
        unit: "allowance",
        unitCost: 240,
        markupPercent: 30,
        supplierRequired: true,
        preferredSupplier: "",
        sourceDocumentId: document.id,
      });
      generatedSupplierRequests.push({
        id: `ai-supplier-${document.id}-specified`,
        supplier: "",
        description: `Price specified items from ${document.fileName}`,
        quantity: 1,
        unit: "allowance",
        linkedMaterialId: specMaterialId,
        notes: "Confirm approved manufacturer, equivalent options and lead time.",
      });
      riskFlags.add("Specification named manufacturers need office confirmation");
      questions.add("Confirm whether equal-approved alternatives are allowed.");
      return;
    }

    const boqMaterialId = `ai-material-${document.id}-boq`;
    generatedMaterials.push(
      {
        id: boqMaterialId,
        section: "Contractor BOQ",
        description: `${baseName} materials package`,
        quantity: 1,
        unit: "package",
        unitCost: 850,
        markupPercent: 30,
        supplierRequired: true,
        preferredSupplier: "",
        sourceDocumentId: document.id,
      },
      {
        id: `ai-material-${document.id}-sundries`,
        section: "Contractor BOQ",
        description: "Sundries, fixings and consumables allowance",
        quantity: 1,
        unit: "allowance",
        unitCost: 120,
        markupPercent: 25,
        supplierRequired: false,
        sourceDocumentId: document.id,
      },
    );
    generatedSupplierRequests.push({
      id: `ai-supplier-${document.id}-boq`,
      supplier: "",
      description: `Price contractor BOQ package from ${document.fileName}`,
      quantity: 1,
      unit: "package",
      linkedMaterialId: boqMaterialId,
      notes: "Confirm BOQ quantities, exclusions, delivery and lead time.",
    });
    riskFlags.add("Contractor BOQ quantities need comparison against latest drawings");
    questions.add("Confirm whether provisional sums are included or excluded.");
  });

  if (project.documents.length > 0) {
    const labourBase = Math.max(16, generatedPipeRuns.reduce((sum, run) => sum + run.lengthM, 0) * 1.35);
    generatedLabour.push(
      {
        id: "ai-labour-install",
        section: "Installation",
        role: "Engineer labour",
        hours: Math.round(labourBase),
        costRate: 38,
        markupPercent: 45,
        notes: "Draft labour allowance from drawing routes and BOQ complexity.",
      },
      {
        id: "ai-labour-review",
        section: "Office review",
        role: "Project manager",
        hours: 4,
        costRate: 42,
        markupPercent: 40,
        notes: "Review extraction, supplier list and quote handoff.",
      },
    );
  }

  return {
    rooms: generatedRooms,
    measurements: generatedMeasurements,
    pipeRuns: generatedPipeRuns,
    radiators: generatedRadiators,
    materialAllowances: generatedMaterials,
    labourAllowances: generatedLabour,
    supplierRequests: generatedSupplierRequests,
    riskFlags: Array.from(riskFlags),
    questions: Array.from(questions),
  };
}

function surveyChatText(project: TakeoffProject) {
  return (project.surveyChat ?? [])
    .map((message) => `${message.role === "assistant" ? "NeXa" : "User"}: ${message.text}`)
    .join("\n");
}

function surveyUserText(project: TakeoffProject) {
  return (project.surveyChat ?? [])
    .filter((message) => message.role === "user")
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join("\n");
}

function estimateScopeText(project: TakeoffProject) {
  const userMessages = (project.surveyChat ?? [])
    .filter((message) => message.role === "user")
    .map((message) => message.text.trim())
    .filter(Boolean);
  return userMessages.at(-1) || project.description || project.name;
}

function isShowerOnlyScope(focusedText: string, fullText: string) {
  const combined = `${focusedText} ${fullText}`;
  const hasShowerScope = /shower|cubicle|enclosure|tray|screen|bi[- ]?fold|bifold/.test(combined);
  const explicitShowerOnly =
    /shower\s+only|only\s+(?:the\s+)?shower|only\s+working\s+on\s+(?:the\s+)?shower|shower\s+cubicle|shower\s+enclosure|shower\s+tray/.test(combined) ||
    /no\s+(?:basin|toilet|wc)|not\s+(?:moving|pricing|supplying|including|working\s+on).*(?:basin|toilet|wc)/.test(combined);
  const widerBathroomSignals =
    /toilet|wc|basin|vanity|bath(?!room)|suite|sanitaryware|move\s+(?:the\s+)?(?:toilet|basin)|soil\s+route|full\s+bathroom|bathroom\s+(?:refurb|refurbishment|renovation)/.test(
      focusedText,
    );

  return hasShowerScope && (explicitShowerOnly || !widerBathroomSignals);
}

function countRadiatorsFromSurveyText(text: string) {
  const countWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  const wordMatch = text.match(/\b(one|two|three|four|five|six|seven|eight)\s+(?:x\s+)?(?:radiators?|rads?)\b/);
  if (wordMatch?.[1]) return countWords[wordMatch[1]] ?? 1;
  const digitMatch = text.match(/\b(\d{1,2})\s*(?:x\s*)?(?:radiators?|rads?)\b/);
  if (digitMatch?.[1]) return Math.max(1, Number(digitMatch[1]));
  if (/\bboth\s+(?:radiators?|rads?)\b/.test(text)) return 2;
  return /\bradiators?\b|\brads?\b/.test(text) ? 1 : 0;
}

function isRadiatorRelocationScope(focusedText: string, fullText: string) {
  const combined = `${focusedText} ${fullText}`;
  const mentionsRadiators = /\bradiators?\b|\brads?\b/.test(combined);
  const relocationIntent = /move|moving|relocat|reposition|shift|alter(?:ing|ed)?\s+(?:the\s+)?(?:pipework|pipes|radiators?)|new\s+position/.test(focusedText);
  return mentionsRadiators && relocationIntent;
}

function radiatorRelocationClientScope(project: TakeoffProject, radiatorCount: number) {
  const count = Math.max(1, radiatorCount || countRadiatorsFromSurveyText(`${project.name} ${project.description} ${surveyUserText(project)}`.toLowerCase()));
  const radiatorLabel = count === 1 ? "one radiator" : `${count} radiators`;
  return `Relocate ${radiatorLabel}, including isolation/drain down, pipework alterations, refitting, refill, testing and balancing. Final pipe routes, access and making good remain subject to site conditions confirmed from the survey evidence.`;
}

function numberFromUnknown(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function configuredSurveyLabourRate() {
  const financeSettings = getHubDetailState().financeSettings;
  const labourRates = Array.isArray(financeSettings?.labourRates) ? financeSettings.labourRates : [];
  const firstRate = labourRates.find((rate): rate is Record<string, unknown> => Boolean(rate) && typeof rate === "object");
  const defaultMarkup = numberFromUnknown(financeSettings?.defaultLabourMarkupPercent, 35);

  return {
    costRate: numberFromUnknown(firstRate?.costRate, 40),
    markupPercent: numberFromUnknown(firstRate?.markupPercent, defaultMarkup),
  };
}

function buildSurveyChatDraftExtraction(project: TakeoffProject): TakeoffExtractionDraft {
  const scope = estimateScopeText(project);
  const focusedText = `${project.name} ${project.description} ${surveyUserText(project) || scope}`.toLowerCase();
  const text = `${focusedText} ${surveyChatText(project)}`.toLowerCase();
  const { costRate: defaultLabourCostRate, markupPercent: defaultLabourMarkupPercent } = configuredSurveyLabourRate();
  const generatedMaterials: TakeoffMaterialAllowance[] = [];
  const generatedLabour: TakeoffLabourAllowance[] = [];
  const generatedSupplierRequests: TakeoffSupplierRequestItem[] = [];
  const riskFlags = new Set(project.review.riskFlags);
  const questions = new Set<string>();

  const addMaterial = (
    id: string,
    section: string,
    description: string,
    quantity: number,
    unit: string,
    unitCost: number,
    markupPercent = 30,
    supplierRequired = false,
  ) => {
    generatedMaterials.push({
      id: `survey-pack-material-${id}`,
      section,
      description,
      quantity,
      unit,
      unitCost,
      markupPercent,
      supplierRequired,
    });
    if (supplierRequired) {
      generatedSupplierRequests.push({
        id: `survey-pack-supplier-${id}`,
        supplier: "",
        description,
        quantity,
        unit,
        linkedMaterialId: `survey-pack-material-${id}`,
        notes: "Confirm model, availability, delivery and current trade price before quote issue.",
      });
    }
  };

  const addLabour = (
    id: string,
    section: string,
    role: string,
    hours: number,
    notes: string,
    costRate = defaultLabourCostRate,
    markupPercent = defaultLabourMarkupPercent,
  ) => {
    generatedLabour.push({
      id: `survey-pack-labour-${id}`,
      section,
      role,
      hours,
      costRate,
      markupPercent,
      notes,
    });
  };

  if (isShowerOnlyScope(focusedText, text)) {
    const hasWetWall = /wet\s*wall|wall\s*panel|panel/.test(focusedText);
    const hasPlasterboard = /plasterboard|plaster\s*board|backing\s*board|board/.test(focusedText);
    const hasPlinth = /plinth/.test(focusedText);
    const hasTowelRail = /towel\s*rail|heated\s*towel/.test(focusedText);
    const refitExistingScreen = /refit\s+(?:the\s+)?existing\s+(?:shower\s+)?screen|reuse\s+(?:the\s+)?(?:existing\s+)?screen/.test(focusedText);
    const refitExistingShower = /refit\s+(?:the\s+)?existing\s+(?:bar\s+)?shower|reuse\s+(?:the\s+)?(?:existing\s+)?(?:bar\s+)?shower/.test(focusedText);
    const supplierDescription = [
      /new\s+shower\s+tray|supply\s+and\s+fit\s+(?:a\s+)?new\s+shower\s+tray/.test(focusedText)
        ? "New shower tray"
        : "Shower tray if supplied by us",
      refitExistingScreen ? "" : "cubicle/screen",
      refitExistingShower ? "" : "shower set/valve if included",
      hasWetWall ? "wet wall panels/trims" : "",
      "waste/trap",
    ].filter(Boolean).join(", ");

    addMaterial("shower-strip-waste", "Strip out works", "Remove and dispose existing shower screen/tray/plinth allowance", 1, "allowance", 120, 25);
    addMaterial("shower-isolation", "Strip out works", "Isolation valves, caps and shower strip-out sundries", 1, "allowance", 45, 30);
    addLabour("shower-strip-out", "Strip out works", "Plumber / labourer strip out and isolate", 5, "Remove existing shower screen/tray/plinth, isolate services and prepare the work area.");

    addMaterial("shower-first-fix-pipe", "Shower pipework and waste", "Hot/cold feed and shower waste alteration allowance", 1, "allowance", 140, 30, true);
    addLabour("shower-first-fix", "Shower pipework and waste", "Plumber first fix", 8, "Adjust shower feeds and waste route only; no basin, WC or toilet works included.");

    addMaterial("shower-cubicle", "Shower cubicle", supplierDescription, 1, "supplier quote", 0, 30, true);
    addMaterial("shower-sealants", "Shower cubicle", "Sealants, fixings, traps/waste sundries and local waterproofing allowance", 1, "allowance", 90, 30);
    if (hasWetWall) {
      addMaterial("shower-wet-wall", "Shower cubicle", "Wet wall panels, trims, adhesive and sealant for shower cubicle area", 1, "supplier quote", 0, 30, true);
    }
    if (hasPlasterboard) {
      addMaterial("shower-plasterboard", "Making good and handover", "Plasterboard/backing board repair behind wet wall", 1, "allowance", 85, 30);
    }
    if (hasPlinth) {
      addMaterial("shower-plinth", "Making good and handover", "Rebuild shower tray plinth materials allowance", 1, "allowance", 90, 30);
    }
    if (hasTowelRail) {
      addMaterial("shower-towel-rail", "Strip out works", "Towel rail removal/refit pipework sundries allowance", 1, "allowance", 35, 30);
      addLabour("shower-towel-rail", "Strip out works", "Remove and refit towel rail", 2, "Remove towel rail for access and refit/test on completion.");
    }
    addLabour("shower-second-fix", "Shower cubicle", "Plumber second fix and test", 8, `${refitExistingScreen ? "Refit existing screen, " : "Fit shower screen/cubicle, "}${refitExistingShower ? "refit existing bar shower, " : ""}connect waste/feed, seal and test.`);

    addMaterial("shower-making-good", "Making good and handover", "Local making-good sundries around shower cubicle", 1, "allowance", 80, 30);
    addLabour("shower-making-good", "Making good and handover", "Making good / handover allowance", hasWetWall || hasPlinth ? 6 : 4, "Local making good, wet wall/plinth finishing where included, silicone, test and handover.");

    riskFlags.add(refitExistingScreen ? "Existing shower screen is assumed suitable to refit; confirm condition before quote issue." : "Confirm whether shower tray/cubicle/screen are supplied by us or by the customer.");
    if (refitExistingShower) riskFlags.add("Existing bar shower is assumed suitable to refit; replacement valve is excluded unless added.");
    riskFlags.add("Wall/floor condition behind the existing shower cubicle is provisional until strip-out.");
    questions.add("Are we supplying the shower tray/cubicle/screen and waste, or is the customer supplying?");
    questions.add("Are wall panels, tiling, flooring, electrics and decorating excluded unless specifically added?");
    questions.add("Is the shower waste staying in the same location or moving?");
  } else if (/bathroom|toilet|basin|shower|cubicle|suite|wc|sanitary|tile|tiling/.test(focusedText)) {
    addMaterial("bathroom-strip-waste", "Strip out works", "Skip / waste disposal allowance", 1, "allowance", 180, 25);
    addMaterial("bathroom-isolation", "Strip out works", "Isolation valves, caps and strip-out sundries", 1, "allowance", 45, 30);
    addLabour("bathroom-strip-out", "Strip out works", "Plumber / labourer strip out and isolate", 8, "Remove existing suite, isolate services and clear working area.");

    addMaterial("bathroom-first-fix-pipe", "First fix plumbing", "Hot, cold and waste pipework/fittings allowance", 1, "allowance", 220, 30);
    addMaterial("bathroom-soil-route", "First fix plumbing", "WC soil route / waste alteration allowance", 1, "allowance", 180, 30, true);
    addLabour("bathroom-first-fix", "First fix plumbing", "Plumber first fix", 16, "Move basin/WC/shower services and test rough-in routes.");

    addMaterial("bathroom-suite", "Sanitaryware and shower", "WC, basin, taps, shower tray/cubicle and shower set", 1, "supplier quote", 0, 30, true);
    addMaterial("bathroom-tanking", "Sanitaryware and shower", "Tanking, sealants, traps, wastes and fixing sundries", 1, "allowance", 160, 30);
    addLabour("bathroom-second-fix", "Sanitaryware and shower", "Plumber second fix and test", 12, "Fit sanitaryware, shower enclosure, wastes, taps and final test.");

    addMaterial("bathroom-making-good", "Making good and handover", "Boxing, access panel and making-good sundries", 1, "allowance", 140, 30);
    addLabour("bathroom-making-good", "Making good and handover", "Making good / handover allowance", 8, "Allow for boxing, minor making good, silicone and handover.");

    riskFlags.add("WC relocation depends on soil route, joist direction, floor build-up and external stack position.");
    riskFlags.add("Tiling, flooring, decorating and electrical works must be explicitly included or excluded.");
    questions.add("Is the toilet moving onto the same soil wall or does it need a new soil route?");
    questions.add("Are we supplying sanitaryware/shower items or is the customer supplying them?");
    questions.add("Are tiling, flooring, fan/electrics and decorating included in our price?");
  } else if (isRadiatorRelocationScope(focusedText, text)) {
    const radiatorCount = Math.max(1, countRadiatorsFromSurveyText(focusedText));
    const section = "Radiator relocation";
    const difficultAccess = /concrete|tile|tiled|laminate|floorboard|joist|boxing|chase|boxed|underfloor|lift\s+(?:floor|carpet)/.test(text);
    const newRadiatorsRequired = /new\s+(?:radiators?|rads?)|replace\s+(?:the\s+)?(?:radiators?|rads?)|stelrad|heat\s*loss|sizing|size\s+(?:the\s+)?(?:radiators?|rads?)/.test(text);
    const pipeworkCost = Math.max(85, radiatorCount * 55 + (difficultAccess ? 45 : 0));
    const relocationHours = Math.max(4, Math.round(radiatorCount * 2.75 * 2) / 2);
    const clientScope = radiatorRelocationClientScope(project, radiatorCount);

    addMaterial(
      "radiator-relocation-pipework",
      section,
      `${radiatorCount === 1 ? "Pipework and fittings allowance to relocate one radiator" : `Pipework and fittings allowance to relocate ${radiatorCount} radiators`}`,
      1,
      "allowance",
      pipeworkCost,
      30,
      false,
    );
    addMaterial("radiator-relocation-sundries", section, "Inhibitor/top-up, clips, fixings and testing sundries", 1, "allowance", 45, 30);
    if (difficultAccess) {
      addMaterial("radiator-relocation-access", section, "Access and local making-good allowance around pipe routes", 1, "allowance", 95, 30);
    }
    if (newRadiatorsRequired) {
      addMaterial(
        "radiator-relocation-new-rads",
        section,
        `${radiatorCount === 1 ? "New radiator if replacement is required" : `New radiators if replacement is required (${radiatorCount})`}`,
        radiatorCount,
        "supplier quote",
        0,
        30,
        true,
      );
    }

    addLabour(
      "radiator-relocation-install",
      section,
      "Heating engineer - relocate radiators",
      relocationHours,
      "Drain/isolate heating circuit, alter radiator pipework, reposition/refit radiators and prepare for testing.",
      defaultLabourCostRate,
      defaultLabourMarkupPercent,
    );
    addLabour(
      "radiator-relocation-test",
      section,
      "Refill, test and balance heating system",
      1.5,
      "Refill, dose/top up, check for leaks, bleed and balance affected radiators.",
      defaultLabourCostRate,
      defaultLabourMarkupPercent,
    );

    riskFlags.add("Radiator relocation price assumes accessible pipe routes; hidden floor/wall conditions may change labour and making good.");
    riskFlags.add("Confirm whether existing radiators, valves and brackets are suitable to reuse before final issue.");
    questions.add(clientScope);
    questions.add("Are the radiators staying on the same wall/room or moving to a different route?");
    questions.add("What floor/wall finishes need lifted, opened or made good?");
    questions.add("Are existing radiator valves being reused or should TRVs/lockshields be added?");
  } else if (/boiler|heating|radiator|heat loss|cylinder|flue|controls|thermostat/.test(focusedText)) {
    addMaterial("heating-survey", "Survey and heat loss", "Heat loss/radiator schedule office allowance", 1, "allowance", 120, 30);
    addLabour("heating-survey", "Survey and heat loss", "Estimator / heating engineer survey review", 4, "Review rooms, heat losses, radiator output and design assumptions.", 42, 35);

    addMaterial("heating-plant", "Plant and emitters", "Boiler/radiators/controls package", 1, "supplier quote", 0, 30, true);
    addMaterial("heating-valves", "Plant and emitters", "TRVs, lockshields, controls and sundries allowance", 1, "allowance", 220, 30, true);

    addMaterial("heating-pipework", "Pipework alterations", "Copper/plastic pipework, fittings, clips and insulation", 1, "allowance", 420, 30, true);
    addLabour("heating-install", "Pipework alterations", "Heating engineer installation", 24, "Pipework alterations, plant/emitter install and controls preparation.", 42, 35);

    addMaterial("heating-commissioning", "Commissioning and handover", "Chemicals, flushing consumables and commissioning sundries", 1, "allowance", 160, 30);
    addLabour("heating-commissioning", "Commissioning and handover", "Flush, balance, commission and handover", 8, "Fill, dose, test, balance and complete handover evidence.", 42, 35);

    riskFlags.add("Heat loss and radiator sizing must be confirmed before supplier order.");
    riskFlags.add("Boiler/flue/condensate route and gas-safe evidence must be confirmed.");
    questions.add("Are we replacing like-for-like or moving plant/radiator positions?");
    questions.add("What boiler/radiator range should supplier price?");
    questions.add("Is flushing, balancing and controls upgrade included?");
  } else if (/leak|burst|repair|reactive|emergency|tap|valve|blockage/.test(focusedText)) {
    addMaterial("reactive-parts", "Repair materials", "Standard repair fittings and consumables allowance", 1, "allowance", 85, 30);
    addMaterial("reactive-special", "Repair materials", "Specialist part if not van stock", 1, "supplier quote", 0, 30, true);
    addLabour("reactive-attend", "Attend and diagnose", "Engineer attendance and diagnosis", 2, "Attend site, diagnose issue and confirm repair route.");
    addLabour("reactive-repair", "Repair and test", "Engineer repair and test", 3, "Complete repair, test and capture evidence.");
    riskFlags.add("Reactive repair should remain time/materials unless access and fault are fully confirmed.");
    questions.add("Is this being quoted upfront or completed as time and materials?");
    questions.add("Is access straightforward or do we need to open finishes?");
  } else {
    addMaterial("general-sundries", "Materials and sundries", "General fittings, fixings and consumables allowance", 1, "allowance", 180, 30);
    addMaterial("general-supplier", "Materials and sundries", "Specialist materials to supplier quote", 1, "supplier quote", 0, 30, true);
    addLabour("general-install", "Labour installation", "Engineer labour allowance", 8, "Provisional labour until scope is broken into detailed cost centres.");
    addLabour("general-review", "Office review", "Estimator review and quote preparation", 2, "Turn survey chat into client wording, supplier request and final quote pack.", 42, 35);
    questions.add("What is included, what is excluded, and which items need supplier prices?");
  }

  return {
    rooms: [],
    measurements: [],
    pipeRuns: [],
    radiators: [],
    materialAllowances: generatedMaterials,
    labourAllowances: generatedLabour,
    supplierRequests: generatedSupplierRequests,
    riskFlags: Array.from(riskFlags),
    questions: [
      `Review client-visible scope before issue: ${scope}`,
      ...Array.from(questions),
    ],
  };
}

export function runSurveyChatEstimatePackDraft(
  projectId: string,
  actor = "NeXa Survey",
): TakeoffExtractionResult | null {
  refreshTakeoffStore();
  const project = takeoffStore.projects.find((item) => item.id === projectId);
  if (!project) return null;

  const draft = buildSurveyChatDraftExtraction(project);
  return applyTakeoffExtractionDraft(project.id, draft, {
    actor,
    provider: "Pilot",
    summary: `${draft.materialAllowances.length} material line(s), ${draft.labourAllowances.length} labour allowance(s) and ${draft.supplierRequests.length} supplier request line(s) generated from survey chat for quote cost centres.`,
    confidence: project.documents.length ? "Medium" : "Low",
    documentNote: "Survey chat converted into quote cost centres; office review required before quote issue.",
    sourceFiles: project.documents.length,
    replaceIdPrefixes: ["survey-pack-"],
  });
}

export function getTakeoffProjects(): TakeoffProject[] {
  refreshTakeoffStore();
  return clone(takeoffStore.projects);
}

export function getTakeoffProject(id: string): TakeoffProject | undefined {
  refreshTakeoffStore();
  const index = findTakeoffProjectIndexByLookup(id);
  const project = index >= 0 ? takeoffStore.projects[index] : undefined;
  return project ? clone(project) : undefined;
}

export function createTakeoffProject(payload: Partial<TakeoffProject>): TakeoffProject {
  refreshTakeoffStore();
  const linkedQuote = findLinkedQuote(payload.linkedQuoteId);
  const createdAt = nowIso();
  const project: TakeoffProject = {
    id: payload.id ?? makeId("takeoff"),
    reference: payload.reference ?? nextReference(takeoffStore.projects),
    name: payload.name?.trim() || "New Takeoff / BOQ project",
    customer: payload.customer?.trim() || linkedQuote?.customer || "Customer to confirm",
    site: payload.site?.trim() || linkedQuoteSiteAddress(linkedQuote) || "Site to confirm",
    description: payload.description?.trim() || "Takeoff scope to review.",
    linkedQuoteId: payload.linkedQuoteId,
    linkedQuoteRef: linkedQuote?.ref ?? payload.linkedQuoteRef,
    linkedJobId: payload.linkedJobId,
    linkedJobRef: payload.linkedJobRef,
    status: payload.status ?? "Draft",
    documents: payload.documents ?? [],
    rooms: payload.rooms ?? [],
    measurements: payload.measurements ?? [],
    pipeRuns: payload.pipeRuns ?? [],
    radiators: payload.radiators ?? [],
    materialAllowances: payload.materialAllowances ?? [],
    labourAllowances: payload.labourAllowances ?? [],
    supplierRequests: payload.supplierRequests ?? [],
    surveyChat: payload.surveyChat ?? [
      {
        id: makeId("survey-chat"),
        role: "assistant",
        text: "What are we pricing today? Tell me the job in plain English, then add photos, room scans or notes as we go.",
        createdAt,
      },
    ],
    surveyWorkflow: payload.surveyWorkflow ?? createDefaultTakeoffSurveyWorkflow({
      projectType: payload.description?.toLowerCase().includes("heating")
        ? "Full heating replacement"
        : "Survey to price",
      scopeNotes: payload.description?.trim() || "",
    }),
    review: payload.review ?? { officeNotes: "", riskFlags: [] },
    createdAt,
    updatedAt: createdAt,
  };

  takeoffStore.projects = [project, ...takeoffStore.projects];
  persistTakeoffStore();
  return clone(project);
}

export function updateTakeoffProject(id: string, patch: Partial<TakeoffProject>): TakeoffProject | null {
  refreshTakeoffStore();
  const index = findTakeoffProjectIndexByLookup(id);
  if (index < 0) return null;
  const current = takeoffStore.projects[index];
  if (!current) return null;

  const requestedLinkedQuoteId = patch.linkedQuoteId !== undefined
    ? patch.linkedQuoteId || undefined
    : current.linkedQuoteId;
  const linkedQuote = patch.linkedQuoteId !== undefined
    ? findLinkedQuote(requestedLinkedQuoteId)
    : findLinkedQuote(current.linkedQuoteId ?? current.linkedQuoteRef);
  const nextLinkedQuoteId = linkedQuote?.id ?? requestedLinkedQuoteId;

  const updated: TakeoffProject = {
    ...current,
    ...patch,
    id: current.id,
    reference: current.reference,
    linkedQuoteId: nextLinkedQuoteId,
    linkedQuoteRef: patch.linkedQuoteId !== undefined
      ? linkedQuote?.ref
      : patch.linkedQuoteRef ?? current.linkedQuoteRef,
    linkedJobId: patch.linkedJobId !== undefined ? patch.linkedJobId || undefined : current.linkedJobId,
    linkedJobRef: patch.linkedJobRef !== undefined ? patch.linkedJobRef || undefined : current.linkedJobRef,
    review: {
      ...current.review,
      ...(patch.review ?? {}),
      riskFlags: patch.review?.riskFlags ?? current.review.riskFlags,
    },
    surveyWorkflow: patch.surveyWorkflow
      ? {
          ...createDefaultTakeoffSurveyWorkflow(current.surveyWorkflow),
          ...patch.surveyWorkflow,
          stopGo: patch.surveyWorkflow.stopGo ?? current.surveyWorkflow?.stopGo ?? createDefaultTakeoffSurveyWorkflow().stopGo,
          aiQuestions: patch.surveyWorkflow.aiQuestions ?? current.surveyWorkflow?.aiQuestions ?? createDefaultTakeoffSurveyWorkflow().aiQuestions,
        }
      : current.surveyWorkflow ?? createDefaultTakeoffSurveyWorkflow(),
    surveyChat: patch.surveyChat ?? current.surveyChat,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };

  takeoffStore.projects[index] = updated;
  persistTakeoffStore();
  return clone(updated);
}

export function deleteTakeoffProject(id: string): TakeoffProject | null {
  refreshTakeoffStore();
  const index = findTakeoffProjectIndexByLookup(id);
  const existing = index >= 0 ? takeoffStore.projects[index] : undefined;
  if (!existing) return null;

  takeoffStore.projects = takeoffStore.projects.filter((project) => project.id !== existing.id);
  persistTakeoffStore();
  return clone(existing);
}

export function resetTakeoffStore(): TakeoffStore {
  takeoffStore.projects = useDemoSeedData() ? [clone(seedProject)] : [];
  persistTakeoffStore();
  return clone(takeoffStore);
}

type TakeoffExtractionApplyOptions = {
  actor?: string;
  provider?: "Pilot" | "OpenAI";
  model?: string;
  summary?: string;
  confidence?: "Low" | "Medium" | "High";
  documentNote?: string;
  sourceFiles?: number;
  replaceIdPrefixes?: string[];
};

function extractionCounts(draft: TakeoffExtractionDraft) {
  return {
    rooms: draft.rooms.length,
    measurements: draft.measurements.length,
    pipeRuns: draft.pipeRuns.length,
    radiators: draft.radiators.length,
    materialAllowances: draft.materialAllowances.length,
    labourAllowances: draft.labourAllowances.length,
    supplierRequests: draft.supplierRequests.length,
  };
}

function hasIdPrefix(id: string | undefined, prefixes: string[]) {
  return Boolean(id && prefixes.some((prefix) => id.startsWith(prefix)));
}

function removeGeneratedTakeoffLines(project: TakeoffProject, prefixes: string[]): TakeoffProject {
  if (!prefixes.length) return project;

  return {
    ...project,
    rooms: project.rooms.filter((line) => !hasIdPrefix(line.id, prefixes)),
    measurements: project.measurements.filter((line) => !hasIdPrefix(line.id, prefixes)),
    pipeRuns: project.pipeRuns.filter((line) => !hasIdPrefix(line.id, prefixes)),
    radiators: project.radiators.filter((line) => !hasIdPrefix(line.id, prefixes)),
    materialAllowances: project.materialAllowances.filter((line) => !hasIdPrefix(line.id, prefixes)),
    labourAllowances: project.labourAllowances.filter((line) => !hasIdPrefix(line.id, prefixes)),
    supplierRequests: project.supplierRequests.filter((line) => !hasIdPrefix(line.id, prefixes) && !hasIdPrefix(line.linkedMaterialId, prefixes)),
  };
}

function hasNonGeneratedEstimatePack(project: TakeoffProject) {
  const isGeneratedSurveyPackLine = (id: string) => id.startsWith("survey-pack-");
  return [
    ...project.materialAllowances.map((line) => line.id),
    ...project.labourAllowances.map((line) => line.id),
    ...project.supplierRequests.map((line) => line.id),
    ...project.radiators.map((line) => line.id),
    ...project.pipeRuns.map((line) => line.id),
  ].some((id) => !isGeneratedSurveyPackLine(id));
}

export function applyTakeoffExtractionDraft(
  projectId: string,
  draft: TakeoffExtractionDraft,
  options: TakeoffExtractionApplyOptions = {},
): TakeoffExtractionResult | null {
  refreshTakeoffStore();
  const storedProject = takeoffStore.projects.find((item) => item.id === projectId);
  if (!storedProject) return null;
  const project = removeGeneratedTakeoffLines(storedProject, options.replaceIdPrefixes ?? []);

  const extractedAt = nowIso();
  const provider = options.provider ?? "Pilot";
  const documentNote = options.documentNote
    ?? (provider === "OpenAI"
      ? "OpenAI extraction drafted; confirm measurements, scale and exclusions before approval."
      : "Draft measurements extracted; confirm scale before approval.");
  const riskFlags = Array.from(new Set([...project.review.riskFlags, ...draft.riskFlags]));
  const updated = updateTakeoffProject(project.id, {
    status: "In review",
    documents: project.documents.map((document) => ({
      ...document,
      status: documentNeedsOfficeReview(document.kind) ? "Needs review" : "Parsed",
      notes: Array.from(
        new Set([
          ...document.notes,
          documentNote,
        ]),
      ),
    })),
    rooms: mergeById(project.rooms, draft.rooms),
    measurements: mergeById(project.measurements, draft.measurements),
    pipeRuns: mergeById(project.pipeRuns, draft.pipeRuns),
    radiators: mergeById(project.radiators, draft.radiators),
    materialAllowances: mergeById(project.materialAllowances, draft.materialAllowances),
    labourAllowances: mergeById(project.labourAllowances, draft.labourAllowances),
    supplierRequests: mergeById(project.supplierRequests, draft.supplierRequests),
    review: {
      ...project.review,
      riskFlags,
      officeNotes: project.review.officeNotes || "Draft extraction ready for office review.",
    },
    extraction: {
      status: "Draft extracted",
      provider,
      model: options.model,
      requestedAt: extractedAt,
      completedAt: extractedAt,
      confidence: options.confidence ?? (project.documents.some((document) => document.kind === "Drawing") ? "Medium" : "High"),
      summary: options.summary
        ?? `${draft.measurements.length} measurement row(s), ${draft.pipeRuns.length} pipe run(s), ${draft.materialAllowances.length} material allowance(s), ${draft.labourAllowances.length} labour allowance(s) drafted.`,
      questions: draft.questions,
      sourceFiles: options.sourceFiles,
    },
  });

  if (!updated) return null;

  appendAuditEvent({
    actor: options.actor ?? "NeXa Takeoff",
    action: "extracted",
    recordType: "takeoff_project",
    recordId: project.id,
    summary: `${project.reference} ${provider} extraction generated from ${project.documents.length} document(s).`,
    source: "takeoff add-on",
    importance: "normal",
  });

  return {
    project: updated,
    generated: extractionCounts(draft),
  };
}

export function runTakeoffDraftExtraction(
  projectId: string,
  actor = "NeXa Takeoff",
): TakeoffExtractionResult | null {
  refreshTakeoffStore();
  const project = takeoffStore.projects.find((item) => item.id === projectId);
  if (!project) return null;

  const draft = buildDraftExtraction(project);
  return applyTakeoffExtractionDraft(project.id, draft, {
    actor,
    provider: "Pilot",
    sourceFiles: project.documents.length,
  });
}

export function pushTakeoffProjectToQuote(
  projectId: string,
  quoteId: string,
  actor = "NeXa Takeoff",
): TakeoffPushResult | null {
  refreshTakeoffStore();
  const project = takeoffStore.projects.find((item) => item.id === projectId);
  if (!project) return null;

  const quote = getQuotes().find((item) => item.id === quoteId);
  if (!quote) return null;

  if (project.status !== "Approved" && project.status !== "Pushed") {
    return null;
  }

  const applied = applyProjectCostCentresToQuote(project, quote, actor, "takeoff");
  if (!applied) return null;

  const pushedAt = nowIso();
  const updatedProject = updateTakeoffProject(project.id, {
    linkedQuoteId: quote.id,
    linkedQuoteRef: quote.ref,
    status: "Pushed",
    review: {
      ...project.review,
      pushedAt,
      pushedQuoteId: quote.id,
      pushedQuoteRef: quote.ref,
    },
  });

  if (!updatedProject) return null;

  return {
    project: updatedProject,
    quote: applied.quote,
    costCentre: applied.costCentre,
    costCentres: applied.costCentres,
    auditEvent: applied.auditEvent,
    totalSell: applied.totalSell,
  };
}

export function pushSurveyProjectToQuote(
  projectId: string,
  quoteId: string,
  actor = "NeXa Survey",
): TakeoffPushResult | null {
  refreshTakeoffStore();
  const project = takeoffStore.projects.find((item) => item.id === projectId);
  if (!project) return null;

  const quote = getQuotes().find((item) => item.id === quoteId);
  if (!quote) return null;

  const shouldUseExistingPack = hasNonGeneratedEstimatePack(project);
  const estimatePack = shouldUseExistingPack ? null : runSurveyChatEstimatePackDraft(project.id, actor);
  const preparedProject = shouldUseExistingPack
    ? removeGeneratedTakeoffLines(project, ["survey-pack-"])
    : estimatePack?.project;
  if (!preparedProject) return null;

  const applied = applyProjectCostCentresToQuote(preparedProject, quote, actor, "survey");
  if (!applied) return null;

  const pushedAt = nowIso();
  const updatedProject = updateTakeoffProject(preparedProject.id, {
    linkedQuoteId: quote.id,
    linkedQuoteRef: quote.ref,
    status: "Pushed",
    review: {
      ...preparedProject.review,
      pushedAt,
      pushedQuoteId: quote.id,
      pushedQuoteRef: quote.ref,
    },
  });

  if (!updatedProject) return null;

  return {
    project: updatedProject,
    quote: applied.quote,
    costCentre: applied.costCentre,
    costCentres: applied.costCentres,
    auditEvent: applied.auditEvent,
    generated: estimatePack?.generated ?? {
      rooms: preparedProject.rooms.length,
      measurements: preparedProject.measurements.length,
      pipeRuns: preparedProject.pipeRuns.length,
      radiators: preparedProject.radiators.length,
      materialAllowances: preparedProject.materialAllowances.length,
      labourAllowances: preparedProject.labourAllowances.length,
      supplierRequests: preparedProject.supplierRequests.length,
    },
    totalSell: applied.totalSell,
  };
}

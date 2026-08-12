/** Standalone heat-pump / heating design lab (floor-plan-first workflow). */

export type FloorLevel = "ground" | "cellar" | "first" | "second";

export type PlanPoint = { x: number; y: number };

export type PlanOpening = {
  id: string;
  /** Edge index into room.polygon */
  wallIndex: number;
  /** @deprecated use wallIndex */
  wall?: number;
  /** 0–1 position along wall */
  t: number;
  kind: "window" | "door" | "rooflight";
  widthM: number;
  heightM: number;
  /** Override room glazing / door material for this opening. */
  materialId?: string;
};

export type SurveyedEmitter = {
  id: string;
  kind: "radiator" | "ufh";
  wallIndex: number;
  /** 0–1 along wall */
  t: number;
  widthM: number;
  depthM: number;
  heightM?: number;
  radiatorId?: string;
  outputWatts?: number;
  label?: string;
};

export type HeatDesignRoom = {
  id: string;
  name: string;
  roomType: string;
  /** Bounding-box length (derived from polygon when present). */
  length: string;
  width: string;
  height: string;
  exteriorWalls: number;
  /** Legacy 4-wall flags for rectangular rooms. */
  exteriorFlags: [boolean, boolean, boolean, boolean];
  /** Per-edge exterior flags matching polygon edges. */
  wallExterior?: boolean[];
  /** Floor polygon in metres (absolute plan coordinates). Enables alcoves / bay windows. */
  polygon?: PlanPoint[];
  wallType: string;
  glazingType: string;
  windowArea: string;
  floorType: string;
  ceilingType: string;
  meanWaterTemperature: string;
  preferredRange: string;
  selectedRadiatorId?: string;
  planX: number;
  planY: number;
  floorLevel: FloorLevel;
  openings: PlanOpening[];
  /** Existing emitters on the surveyed plan. */
  surveyedEmitters?: SurveyedEmitter[];
  /** Override room-type default ACH (air changes per hour). */
  airChanges?: number;
  /** Override room-type default design temperature °C. */
  targetTemp?: number;
};

export type WallConstruction = {
  id: string;
  category: "solid" | "cavity" | "rendered" | "clad" | "other";
  label: string;
  uValue: number;
  thicknessMm: number;
  layers: string;
};

export type RadiatorTypeOption = {
  id: string;
  code: "K1" | "K2" | "K3" | "P+";
  label: string;
  panels: number;
  fins: number;
};

export type HeatingPlantKind =
  | "boiler"
  | "electric_boiler"
  | "outdoor_unit"
  | "cylinder"
  | "buffer"
  | "manifold"
  | "oil_tank"
  | "lpg_tank";

export type HeatingPlantItem = {
  id: string;
  kind: HeatingPlantKind;
  label: string;
  x: number;
  y: number;
  floorLevel: FloorLevel;
  widthM?: number;
  depthM?: number;
  /** Engineer-placed (or dragged into final spot) — keep when Blake re-routes pipes. */
  placedByUser?: boolean;
};

/** Two-point known-distance calibration so plan metres match the drawing. */
export type PlanScaleCalibration = {
  calibrated: boolean;
  knownMetres: number;
  from: PlanPoint;
  to: PlanPoint;
  /** Plan distance before last apply (diagnostic). */
  measuredPlanM?: number;
  scaleFactor?: number;
  calibratedAt?: string;
};

/** Optional scanned / PDF-export floor drawing under the editable rooms. */
export type PlanUnderlay = {
  dataUrl: string;
  opacity: number;
  /** Image extent on the metre plan grid */
  widthM: number;
  heightM: number;
  originX: number;
  originY: number;
  /** Set when the engineer calibrates a known length on the underlay. */
  scale?: PlanScaleCalibration | null;
};

export type HeatingEmitterKind = "radiator" | "ufh";

/** Radiator or underfloor heating zone drawn on the floor plan. */
export type HeatingEmitterItem = {
  id: string;
  kind: HeatingEmitterKind;
  label: string;
  roomId: string;
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  /** Degrees — radiators align to the wall they sit on. */
  rotationDeg: number;
  floorLevel: FloorLevel;
  radiatorId?: string;
  outputWatts?: number;
};

export type HeatingPipeKind = "flow" | "return" | "primary" | "gas" | "oil" | "refrigerant" | "dhw";

/** Pipe OD tiers for Blake / takeoff (mm). Includes 16 for UK UFH PEX. */
export type HeatingPipeDiameterMm = 15 | 16 | 22 | 28;

export type HeatingPipeRun = {
  id: string;
  kind: HeatingPipeKind;
  label: string;
  points: PlanPoint[];
  floorLevel: FloorLevel;
  /** Sized pipe for BOQ / fittings (copper primary or 16 mm PEX UFH). */
  diameterMm?: HeatingPipeDiameterMm;
  pipeSpecId?: string;
  material?: string;
};

export type HeatingEmitterMode = "radiators" | "ufh" | "mixed";

/** Overlay design for a chosen heating system — plant, emitters and pipe routes. */
export type HeatingSystemLayout = {
  systemOptionId: string;
  plants: HeatingPlantItem[];
  pipes: HeatingPipeRun[];
  emitters: HeatingEmitterItem[];
  emitterMode: HeatingEmitterMode;
  updatedAt: string;
};

export type HeatDesignRevision = {
  id: string;
  at: string;
  actor?: string;
  summary: string;
  snapshotHash?: string;
};

export type HeatDesignProject = {
  id: string;
  name: string;
  customerName: string;
  address: string;
  postcode: string;
  propertyType: string;
  buildEra: string;
  occupants: number;
  currentFuel: "Gas" | "Oil" | "Electric" | "LPG";
  currentAnnualKwh: number;
  electricityUnitRate: number;
  gasUnitRate: number;
  designExternalTemp: number;
  flowTemperature: number;
  selectedHeatPumpId: string;
  rooms: HeatDesignRoom[];
  activeFloor: FloorLevel;
  selectedWallConstructionIds: string[];
  primaryWallConstructionId: string;
  selectedRadiatorTypeIds: string[];
  /** Heating system options included in the comparison report */
  reportOptionIds: string[];
  /** System chosen to design plant + pipework overlay */
  chosenSystemId?: string;
  /** Movable plant / pipework layout for the chosen system */
  heatingLayout?: HeatingSystemLayout | null;
  /** Preferred emitters when designing on plan */
  emitterMode: HeatingEmitterMode;
  /** Optional drawing underlay (photo / export) behind the room polygons */
  planUnderlay?: PlanUnderlay | null;
  /** Linked Core job (materials pushed into Heating design cost centre) */
  linkedJobId?: string;
  linkedJobRef?: string;
  /** Linked Core quote (materials pushed into Heating design cost centre) */
  linkedQuoteId?: string;
  linkedQuoteRef?: string;
  /** Linked Core tender (materials pushed into Heating design BoQ sheet) */
  linkedTenderId?: string;
  linkedTenderRef?: string;
  /** Linked Takeoff studio project (routes + fittings BOQ) */
  linkedTakeoffId?: string;
  linkedTakeoffRef?: string;
  cylinderLitres: number;
  dailyHotWaterLitres: number;
  outdoorUnitDistanceM: number;
  nearestNeighbourDistanceM: number;
  kitExtras: string[];
  /** Latest Ask Blake (live OpenAI or rule fallback) proposal for kit / guidance. */
  blakeProposal?: HeatDesignBlakeProposal | null;
  revisions?: HeatDesignRevision[];
  updatedAt: string;
};

export type RoomHeatLossResult = {
  watts: number;
  btu: number;
  radiatorOutputAtDeltaT50: number;
  deltaT: number;
  wallLoss: number;
  glazingLoss: number;
  floorLoss: number;
  ceilingLoss: number;
  ventilationLoss: number;
  targetTemp: number;
  volume: number;
  floorArea: number;
};

export type HeatPumpOption = {
  id: string;
  brand: string;
  model: string;
  capacityKwAt35: number;
  capacityKwAt45: number;
  capacityKwAt55: number;
  scopAt35: number;
  scopAt45: number;
  scopAt55: number;
  soundPowerDb: number;
  typicalInstalledFrom: number;
};

/** Where a kit unit cost came from — budget can be overwritten by supplier quote. */
export type KitPricingSource =
  | "blake-budget"
  | "rate-library"
  | "rule"
  | "catalogue"
  | "supplier"
  | "manual";

/** Commercial Price Ledger state — budget/guide are planning; firm is confirmed. */
export type KitPricingState = "budget" | "guide" | "rfq" | "firm";

export type KitLine = {
  id: string;
  category: string;
  description: string;
  qty: number;
  unitCost: number;
  required: boolean;
  unit?: string;
  /** blake-budget = live AI UK trade ballpark; replace when supplier quote lands. */
  pricingSource?: KitPricingSource;
  pricingNote?: string;
  /** Honest commercial state for Budget / Guide / RFQ / Firm chips. */
  pricingState?: KitPricingState;
  /** ISO timestamp when this unit cost was last stamped. */
  pricedAt?: string;
};

/** Last live / fallback Blake proposal stored on the Heat Design project. */
export type HeatDesignBlakeProposal = {
  at: string;
  summary: string;
  narrative: string;
  kitLines: KitLine[];
  clarifyingQuestions: Array<{ key: string; question: string; why: string }>;
  routeNotes: string[];
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
};

export type SystemDesignResult = {
  totalHeatLossW: number;
  totalHeatLossKw: number;
  dhwPeakKw: number;
  dhwDailyKwh: number;
  designLoadKw: number;
  selectedPump: HeatPumpOption | null;
  capacityAtFlowKw: number;
  scop: number;
  coveragePercent: number;
  estimatedAnnualHeatKwh: number;
  estimatedHpElectricityKwh: number;
  estimatedHpCost: number;
  estimatedCurrentCost: number;
  estimatedAnnualSaving: number;
  co2SavingKg: number;
  emitterUpgradeCount: number;
  soundOk: boolean;
  soundAssessmentDb: number;
  kit: KitLine[];
  kitTotal: number;
  materialsComplete: boolean;
  materialsNotes: string[];
};

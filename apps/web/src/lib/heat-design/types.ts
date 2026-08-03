/** Standalone heat-pump design lab — not wired into NeXa nav yet. */

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
  kind: "window" | "door";
  widthM: number;
  heightM: number;
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
};

export type HeatingPipeKind = "flow" | "return" | "primary" | "gas" | "oil" | "refrigerant" | "dhw";

export type HeatingPipeRun = {
  id: string;
  kind: HeatingPipeKind;
  label: string;
  points: PlanPoint[];
  floorLevel: FloorLevel;
};

/** Overlay design for a chosen heating system — plant positions + pipe routes on the floor plan. */
export type HeatingSystemLayout = {
  systemOptionId: string;
  plants: HeatingPlantItem[];
  pipes: HeatingPipeRun[];
  updatedAt: string;
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
  cylinderLitres: number;
  dailyHotWaterLitres: number;
  outdoorUnitDistanceM: number;
  nearestNeighbourDistanceM: number;
  kitExtras: string[];
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

export type KitLine = {
  id: string;
  category: string;
  description: string;
  qty: number;
  unitCost: number;
  required: boolean;
  unit?: string;
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

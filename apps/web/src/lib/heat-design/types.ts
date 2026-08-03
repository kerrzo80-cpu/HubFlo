/** Standalone heat-pump design lab — not wired into NeXa nav yet. */

export type HeatDesignRoom = {
  id: string;
  name: string;
  roomType: string;
  length: string;
  width: string;
  height: string;
  exteriorWalls: number;
  wallType: string;
  glazingType: string;
  windowArea: string;
  floorType: string;
  ceilingType: string;
  meanWaterTemperature: string;
  preferredRange: string;
  selectedRadiatorId?: string;
  /** Floor-plan canvas position (metres from origin). */
  planX: number;
  planY: number;
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
  /** Cylinder size litres — drives DHW calc */
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
};

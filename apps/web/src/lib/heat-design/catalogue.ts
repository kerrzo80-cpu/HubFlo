import type {
  HeatDesignRoom,
  HeatPumpOption,
  KitLine,
  RadiatorTypeOption,
  WallConstruction,
} from "./types";
import { bayWindowPolygon, rectPolygon } from "./geometry";

export const roomTypes = [
  { id: "Bathroom", targetTemp: 22, airChanges: 1.5 },
  { id: "Bedroom", targetTemp: 18, airChanges: 0.5 },
  { id: "Bedroom/En Suite", targetTemp: 18, airChanges: 0.8 },
  { id: "Dining Room", targetTemp: 21, airChanges: 0.5 },
  { id: "Hall", targetTemp: 18, airChanges: 1.0 },
  { id: "Kitchen", targetTemp: 18, airChanges: 1.5 },
  { id: "Kitchen/Diner", targetTemp: 21, airChanges: 1.0 },
  { id: "Landing", targetTemp: 18, airChanges: 1.0 },
  { id: "Living Room", targetTemp: 21, airChanges: 0.5 },
  { id: "Study", targetTemp: 21, airChanges: 0.5 },
  { id: "Utility Room", targetTemp: 18, airChanges: 1.0 },
  { id: "WC", targetTemp: 18, airChanges: 1.5 },
] as const;

export const wallTypes = [
  { id: "220mm solid brick plastered", uValue: 2.1 },
  { id: "105mm solid brick plastered", uValue: 3 },
  { id: "Brick cavity wall", uValue: 1.47 },
  { id: "Insulated brick cavity wall", uValue: 0.5 },
  { id: "Timber frame wall", uValue: 0.29 },
] as const;

export const glazingTypes = [
  { id: "Wood/PVCu Single Glazed", uValue: 5 },
  { id: "Wood/PVCu Double Glazed", uValue: 2.9 },
  { id: "Low E Double Glazed", uValue: 1.7 },
  { id: "Metal Frame Single Glazed", uValue: 5.8 },
  { id: "No External Windows Or Doors", uValue: 0 },
] as const;

export const floorTypes = [
  { id: "Heated room", uValue: 1.36, adjacentTemp: 21 },
  { id: "Timber floor over ventilated air gap", uValue: 0.82, adjacentTemp: -3 },
  { id: "Uninsulated solid floor on earth", uValue: 0.82, adjacentTemp: -3 },
  { id: "Solid concrete floor", uValue: 1.6, adjacentTemp: -3 },
] as const;

export const ceilingTypes = [
  { id: "Heated room", uValue: 1.62, adjacentTemp: 21 },
  { id: "Insulated roof space", uValue: 0.71, adjacentTemp: -3 },
  { id: "Uninsulated roof space", uValue: 2.3, adjacentTemp: -3 },
  { id: "Insulated flat roof", uValue: 0.7, adjacentTemp: -3 },
  { id: "Uninsulated flat roof", uValue: 2.19, adjacentTemp: -3 },
] as const;

export const radiatorCatalogue = [
  { id: "stelrad-compact-k1-600-800", supplierSku: "CC-K1-600-800", range: "Classic Compact", model: "K1 600 × 800", orientation: "Horizontal", outputWatts: 740, costRate: 92 },
  { id: "stelrad-compact-pplus-600-1000", supplierSku: "CC-PPLUS-600-1000", range: "Classic Compact", model: "P+ 600 × 1000", orientation: "Horizontal", outputWatts: 1180, costRate: 136 },
  { id: "stelrad-compact-k2-600-1000", supplierSku: "CC-K2-600-1000", range: "Classic Compact", model: "K2 600 × 1000", orientation: "Horizontal", outputWatts: 1680, costRate: 184 },
  { id: "stelrad-compact-k2-600-1200", supplierSku: "CC-K2-600-1200", range: "Classic Compact", model: "K2 600 × 1200", orientation: "Horizontal", outputWatts: 2010, costRate: 214 },
  { id: "stelrad-compact-k3-600-1200", supplierSku: "CC-K3-600-1200", range: "Classic Compact", model: "K3 600 × 1200", orientation: "Horizontal", outputWatts: 2720, costRate: 295 },
  { id: "stelrad-softline-k2-600-1000", supplierSku: "SL-K2-600-1000", range: "Softline Compact", model: "K2 600 × 1000", orientation: "Horizontal", outputWatts: 1625, costRate: 196 },
  { id: "stelrad-softline-k2-600-1400", supplierSku: "SL-K2-600-1400", range: "Softline Compact", model: "K2 600 × 1400", orientation: "Horizontal", outputWatts: 2275, costRate: 258 },
  { id: "stelrad-vertical-k2-1800-500", supplierSku: "V-K2-1800-500", range: "Vertical", model: "K2 1800 × 500", orientation: "Vertical", outputWatts: 1745, costRate: 312 },
  { id: "stelrad-vertical-k2-1800-600", supplierSku: "V-K2-1800-600", range: "Vertical", model: "K2 1800 × 600", orientation: "Vertical", outputWatts: 2095, costRate: 365 },
] as const;

export type RadiatorCatalogueItem = (typeof radiatorCatalogue)[number];

export const radiatorRanges = ["Any range", ...Array.from(new Set(radiatorCatalogue.map((r) => r.range)))];

export const heatPumpCatalogue: HeatPumpOption[] = [
  {
    id: "ashp-5kw",
    brand: "Demo",
    model: "Air Source 5 kW",
    capacityKwAt35: 5.2,
    capacityKwAt45: 4.6,
    capacityKwAt55: 3.9,
    scopAt35: 4.2,
    scopAt45: 3.6,
    scopAt55: 3.0,
    soundPowerDb: 54,
    typicalInstalledFrom: 8500,
  },
  {
    id: "ashp-7kw",
    brand: "Demo",
    model: "Air Source 7 kW",
    capacityKwAt35: 7.1,
    capacityKwAt45: 6.4,
    capacityKwAt55: 5.4,
    scopAt35: 4.1,
    scopAt45: 3.5,
    scopAt55: 2.9,
    soundPowerDb: 56,
    typicalInstalledFrom: 9800,
  },
  {
    id: "ashp-9kw",
    brand: "Demo",
    model: "Air Source 9 kW",
    capacityKwAt35: 9.0,
    capacityKwAt45: 8.1,
    capacityKwAt55: 6.9,
    scopAt35: 4.0,
    scopAt45: 3.4,
    scopAt55: 2.8,
    soundPowerDb: 58,
    typicalInstalledFrom: 11200,
  },
  {
    id: "ashp-12kw",
    brand: "Demo",
    model: "Air Source 12 kW",
    capacityKwAt35: 12.2,
    capacityKwAt45: 11.0,
    capacityKwAt55: 9.3,
    scopAt35: 3.9,
    scopAt45: 3.3,
    scopAt55: 2.7,
    soundPowerDb: 60,
    typicalInstalledFrom: 13500,
  },
  {
    id: "ashp-14kw",
    brand: "Demo",
    model: "Air Source 14 kW",
    capacityKwAt35: 14.0,
    capacityKwAt45: 12.6,
    capacityKwAt55: 10.6,
    scopAt35: 3.8,
    scopAt45: 3.2,
    scopAt55: 2.6,
    soundPowerDb: 61,
    typicalInstalledFrom: 14800,
  },
];

export const kitExtraOptions: Array<{ id: string; label: string; unitCost: number; category: string }> = [
  { id: "ufh-manifold", label: "UFH manifold + mixing set", unitCost: 420, category: "Emitters" },
  { id: "smart-controls", label: "Smart zoning controls pack", unitCost: 380, category: "Controls" },
  { id: "pv-diverter", label: "PV diverter for cylinder", unitCost: 290, category: "Electrical" },
  { id: "snow-stand", label: "Raised snow / flood stand", unitCost: 185, category: "Outdoor" },
];

export const propertyTypes = ["Detached", "Semi-detached", "Terraced", "Bungalow", "Flat"];
export const buildEras = ["Pre-1919", "1919–1944", "1945–1964", "1965–1990", "1991–2002", "2003–present"];

/** HeatPunk-style wall constructions with U-values. */
export const wallConstructions: WallConstruction[] = [
  { id: "cav-mw-100-wp", category: "cavity", label: "Insulated cavity", uValue: 0.45, thicknessMm: 275, layers: "mineral wool, 100mm block, wet plaster" },
  { id: "cav-none-100-wp", category: "cavity", label: "Uninsulated cavity", uValue: 0.87, thicknessMm: 275, layers: "No insulation, 100mm block, wet plaster" },
  { id: "cav-none-wp", category: "cavity", label: "Cavity, plaster only", uValue: 1.37, thicknessMm: 264, layers: "No insulation, wet plaster" },
  { id: "cav-mslab-wp", category: "cavity", label: "Mineral slab cavity", uValue: 0.56, thicknessMm: 267, layers: "mineral slab, wet plaster" },
  { id: "solid-double-brick", category: "solid", label: "Double brick", uValue: 2.11, thicknessMm: 241, layers: "Double brick, uninsulated" },
  { id: "cav-mw-125-pb", category: "cavity", label: "Deep cavity + PB", uValue: 0.41, thicknessMm: 300, layers: "mineral wool, 125mm block, plasterboard" },
  { id: "solid-105", category: "solid", label: "105mm solid brick", uValue: 3.0, thicknessMm: 125, layers: "105mm brick, plaster" },
  { id: "solid-220", category: "solid", label: "220mm solid brick", uValue: 2.1, thicknessMm: 240, layers: "220mm brick, plaster" },
  { id: "render-insulated", category: "rendered", label: "External render + EWI", uValue: 0.3, thicknessMm: 320, layers: "render, EWI, block, plaster" },
  { id: "clad-timber", category: "clad", label: "Timber clad frame", uValue: 0.29, thicknessMm: 280, layers: "timber clad, insulated frame, PB" },
  { id: "other-party", category: "other", label: "Party wall", uValue: 0.0, thicknessMm: 220, layers: "shared party wall (no heat loss)" },
];

export const wallConstructionCategories = [
  { id: "solid", label: "Solid walls" },
  { id: "cavity", label: "Cavity" },
  { id: "rendered", label: "Externally rendered" },
  { id: "clad", label: "Externally clad" },
  { id: "other", label: "Other walls" },
] as const;

export const radiatorTypeOptions: RadiatorTypeOption[] = [
  { id: "rad-k1", code: "K1", label: "one panel, one fins", panels: 1, fins: 1 },
  { id: "rad-k2", code: "K2", label: "two panels, two fins", panels: 2, fins: 2 },
  { id: "rad-k3", code: "K3", label: "three panels, three fins", panels: 3, fins: 3 },
  { id: "rad-pplus", code: "P+", label: "two panels, one fins", panels: 2, fins: 1 },
];

const ROOM_COLORS = ["#0f7a5a", "#c45c26", "#2f5d8c", "#7a4f9a", "#8a6d1d", "#1f6f6a", "#9a3b4a", "#4a6b2f"];

export function roomColor(index: number) {
  return ROOM_COLORS[index % ROOM_COLORS.length];
}

export function defaultExteriorFlags(count: number): [boolean, boolean, boolean, boolean] {
  // top, right, bottom, left
  if (count <= 0) return [false, false, false, false];
  if (count === 1) return [true, false, false, false];
  if (count === 2) return [true, true, false, false];
  if (count === 3) return [true, true, true, false];
  return [true, true, true, true];
}

export function makeBlankRoom(index: number): HeatDesignRoom {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const planX = col * 3.8;
  const planY = row * 3.5 + 0.8;
  const length = 3.5;
  const width = 3.2;
  const exteriorFlags = defaultExteriorFlags(2);
  const polygon = rectPolygon(planX, planY, length, width);
  return {
    id: `hd-room-${Date.now()}-${index}`,
    name: `Room ${index + 1}`,
    roomType: "Living Room",
    length: String(length),
    width: String(width),
    height: "2.4",
    exteriorWalls: 2,
    exteriorFlags,
    wallExterior: [true, true, false, false],
    polygon,
    wallType: "Brick cavity wall",
    glazingType: "Wood/PVCu Double Glazed",
    windowArea: "2.2",
    floorType: "Uninsulated solid floor on earth",
    ceilingType: "Insulated roof space",
    meanWaterTemperature: "45",
    preferredRange: "Any range",
    planX,
    planY,
    floorLevel: "ground",
    openings: [{ id: `op-${index}-0`, wallIndex: 0, t: 0.5, kind: "window", widthM: 1.2, heightM: 1.2 }],
  };
}

export function makeDemoProject(): import("./types").HeatDesignProject {
  const loungePoly = bayWindowPolygon(0.8, 1.2, 3.171, 3.5, 0.55, 0.42);
  const kitchenPoly = rectPolygon(4.1, 1.2, 3.2, 2.8);
  const rooms: HeatDesignRoom[] = [
    {
      ...makeBlankRoom(0),
      name: "Lounge",
      roomType: "Living Room",
      length: "3.171",
      width: "4.05",
      exteriorWalls: 5,
      exteriorFlags: [true, true, true, true],
      wallExterior: [true, true, true, true, true, true, false, true],
      polygon: loungePoly,
      windowArea: "3.6",
      planX: 0.8,
      planY: 0.65,
      openings: [
        { id: "op-lounge-bay", wallIndex: 2, t: 0.5, kind: "window", widthM: 1.2, heightM: 1.2 },
        { id: "op-lounge-w", wallIndex: 7, t: 0.5, kind: "window", widthM: 0.9, heightM: 1.2 },
      ],
    },
    {
      ...makeBlankRoom(1),
      name: "Kitchen",
      roomType: "Kitchen",
      length: "3.2",
      width: "2.8",
      exteriorWalls: 2,
      exteriorFlags: [true, true, false, false],
      wallExterior: [true, true, false, false],
      polygon: kitchenPoly,
      windowArea: "1.8",
      floorType: "Solid concrete floor",
      planX: 4.1,
      planY: 1.2,
      openings: [
        { id: "op-kit-n", wallIndex: 0, t: 0.5, kind: "window", widthM: 1.2, heightM: 1.0 },
        { id: "op-kit-e", wallIndex: 1, t: 0.55, kind: "door", widthM: 0.9, heightM: 2.0 },
      ],
    },
  ];

  return {
    id: `hd-project-${Date.now()}`,
    name: "Demo — Portlethen semi",
    customerName: "Sample Customer",
    address: "25 Hillside Drive, Portlethen",
    postcode: "AB12 4TG",
    propertyType: "Semi-detached",
    buildEra: "1965–1990",
    occupants: 3,
    currentFuel: "Gas",
    currentAnnualKwh: 12000,
    electricityUnitRate: 0.28,
    gasUnitRate: 0.07,
    designExternalTemp: -3,
    flowTemperature: 45,
    selectedHeatPumpId: "",
    rooms,
    activeFloor: "ground",
    selectedWallConstructionIds: ["cav-mw-100-wp", "cav-none-100-wp"],
    primaryWallConstructionId: "cav-mw-100-wp",
    selectedRadiatorTypeIds: ["rad-k1", "rad-k2", "rad-k3"],
    reportOptionIds: ["opt-ashp", "opt-gas", "opt-oil"],
    chosenSystemId: undefined,
    heatingLayout: null,
    emitterMode: "radiators",
    linkedJobId: undefined,
    linkedJobRef: undefined,
    cylinderLitres: 210,
    dailyHotWaterLitres: 150,
    outdoorUnitDistanceM: 3,
    nearestNeighbourDistanceM: 8,
    kitExtras: [],
    updatedAt: new Date().toISOString(),
  };
}

export function buildKitLines(input: {
  systemKind?: import("./systems").HeatingSystemKind;
  systemLabel?: string;
  pump?: HeatPumpOption | null;
  cylinderLitres: number;
  flowTemperature: number;
  emitterUpgradeCount: number;
  extras: string[];
  floorAreaM2?: number;
  exteriorWallAreaM2?: number;
  openingCount?: number;
  pipeRunM?: number;
  wallConstructionLabel?: string;
  radiatorLines?: Array<{ description: string; qty: number; unitCost: number }>;
  emitterMode?: "radiators" | "ufh" | "mixed";
  designLoadKw?: number;
}): KitLine[] {
  const kind = input.systemKind ?? "ashp";
  const floorArea = input.floorAreaM2 ?? 0;
  const exteriorWallArea = input.exteriorWallAreaM2 ?? 0;
  const pipeRunM = Math.max(12, Math.round(input.pipeRunM ?? floorArea * 1.1));
  const loadKw = input.designLoadKw ?? 0;
  const boilerKw = Math.max(12, Math.ceil(loadKw + 4));
  const lines: KitLine[] = [];

  if (kind === "ashp" || kind === "hybrid") {
    const pump = input.pump;
    lines.push({
      id: "kit-ashp",
      category: "Heat pump",
      description: pump ? `${pump.brand} ${pump.model}` : "Air source heat pump (TBC)",
      qty: 1,
      unitCost: pump ? Math.round(pump.typicalInstalledFrom * 0.55) : 4500,
      required: true,
    });
    if (kind === "hybrid") {
      lines.push({
        id: "kit-hybrid-boiler",
        category: "Boiler",
        description: `Hybrid peak gas boiler ~${boilerKw} kW`,
        qty: 1,
        unitCost: 1100 + boilerKw * 35,
        required: true,
      });
    }
    lines.push({
      id: "kit-cylinder",
      category: "Cylinder",
      description: `${input.cylinderLitres} L heat-pump ready cylinder`,
      qty: 1,
      unitCost: input.cylinderLitres >= 250 ? 1450 : input.cylinderLitres >= 200 ? 1180 : 980,
      required: true,
    });
    lines.push({
      id: "kit-buffer",
      category: "Hydraulics",
      description: input.flowTemperature <= 40 ? "50 L buffer / volumiser" : "Optional volumiser tee set",
      qty: 1,
      unitCost: input.flowTemperature <= 40 ? 320 : 95,
      required: true,
    });
    lines.push({
      id: "kit-electrics-ou",
      category: "Electrical",
      description: "Isolator, cable, outdoor unit supply allowance",
      qty: 1,
      unitCost: 390,
      required: true,
    });
  } else if (kind === "gas") {
    lines.push({
      id: "kit-gas-boiler",
      category: "Boiler",
      description: `Condensing gas boiler ~${boilerKw} kW @ ${input.flowTemperature}°C flow`,
      qty: 1,
      unitCost: 950 + boilerKw * 28,
      required: true,
    });
    lines.push({
      id: "kit-flue",
      category: "Flue",
      description: "Concentric flue kit + plume management allowance",
      qty: 1,
      unitCost: 220,
      required: true,
    });
    lines.push({
      id: "kit-gas-valve",
      category: "Gas",
      description: "Gas isolation / meter connection allowance",
      qty: 1,
      unitCost: 180,
      required: true,
    });
    lines.push({
      id: "kit-cylinder",
      category: "Cylinder",
      description: `${input.cylinderLitres} L unvented / system cylinder`,
      qty: 1,
      unitCost: input.cylinderLitres >= 250 ? 980 : input.cylinderLitres >= 200 ? 820 : 690,
      required: true,
    });
  } else if (kind === "oil") {
    lines.push({
      id: "kit-oil-boiler",
      category: "Boiler",
      description: `Condensing oil boiler ~${boilerKw} kW @ ${input.flowTemperature}°C flow`,
      qty: 1,
      unitCost: 1400 + boilerKw * 32,
      required: true,
    });
    lines.push({
      id: "kit-oil-tank",
      category: "Fuel",
      description: "Oil tank / bund connection allowance",
      qty: 1,
      unitCost: 850,
      required: true,
    });
    lines.push({
      id: "kit-flue",
      category: "Flue",
      description: "Oil flue kit + liner allowance",
      qty: 1,
      unitCost: 280,
      required: true,
    });
    lines.push({
      id: "kit-cylinder",
      category: "Cylinder",
      description: `${input.cylinderLitres} L system cylinder`,
      qty: 1,
      unitCost: input.cylinderLitres >= 250 ? 980 : 820,
      required: true,
    });
  } else if (kind === "lpg") {
    lines.push({
      id: "kit-lpg-boiler",
      category: "Boiler",
      description: `Condensing LPG boiler ~${boilerKw} kW @ ${input.flowTemperature}°C flow`,
      qty: 1,
      unitCost: 1050 + boilerKw * 30,
      required: true,
    });
    lines.push({
      id: "kit-lpg-tank",
      category: "Fuel",
      description: "LPG tank / bottle bank connection allowance",
      qty: 1,
      unitCost: 420,
      required: true,
    });
    lines.push({
      id: "kit-flue",
      category: "Flue",
      description: "Concentric flue kit",
      qty: 1,
      unitCost: 220,
      required: true,
    });
    lines.push({
      id: "kit-cylinder",
      category: "Cylinder",
      description: `${input.cylinderLitres} L system cylinder`,
      qty: 1,
      unitCost: input.cylinderLitres >= 250 ? 980 : 820,
      required: true,
    });
  } else {
    lines.push({
      id: "kit-electric-boiler",
      category: "Boiler",
      description: `Electric boiler ~${boilerKw} kW @ ${input.flowTemperature}°C flow`,
      qty: 1,
      unitCost: 800 + boilerKw * 40,
      required: true,
    });
    lines.push({
      id: "kit-electrics-eb",
      category: "Electrical",
      description: "High-load supply / isolator allowance",
      qty: 1,
      unitCost: 480,
      required: true,
    });
    lines.push({
      id: "kit-cylinder",
      category: "Cylinder",
      description: `${input.cylinderLitres} L cylinder`,
      qty: 1,
      unitCost: input.cylinderLitres >= 250 ? 980 : 820,
      required: true,
    });
  }

  lines.push({
    id: "kit-filter",
    category: "Hydraulics",
    description: "Magnetic filter + inhibitor pack",
    qty: 1,
    unitCost: 145,
    required: true,
  });
  lines.push({
    id: "kit-pipe",
    category: "Pipework",
    description: `Flow/return pipework & insulation (~${pipeRunM} m) @ ${input.flowTemperature}°C design`,
    qty: pipeRunM,
    unitCost: kind === "ashp" || kind === "hybrid" ? 18 : 14,
    unit: "m",
    required: true,
  });
  lines.push({
    id: "kit-controls",
    category: "Controls",
    description:
      kind === "ashp" || kind === "hybrid"
        ? "Weather compensation + room thermostat pack"
        : "Boiler controls / programmer + room thermostat pack",
    qty: 1,
    unitCost: kind === "ashp" || kind === "hybrid" ? 260 : 180,
    required: true,
  });

  if (input.wallConstructionLabel && exteriorWallArea > 0) {
    lines.push({
      id: "kit-wall-note",
      category: "Fabric",
      description: `External wall construction: ${input.wallConstructionLabel} (~${exteriorWallArea.toFixed(1)} m² heat-loss area)`,
      qty: 1,
      unitCost: 0,
      required: true,
    });
  }

  if ((input.openingCount ?? 0) > 0) {
    lines.push({
      id: "kit-openings",
      category: "Openings",
      description: "Window / door openings from floor plan",
      qty: input.openingCount!,
      unitCost: 0,
      required: true,
    });
  }

  const emitterMode = input.emitterMode ?? "radiators";
  if (emitterMode === "ufh") {
    const ufhArea = Math.max(8, Math.round(floorArea * 0.85));
    lines.push({
      id: "kit-ufh",
      category: "Emitters",
      description: `Underfloor heating manifolds + loops (~${ufhArea} m²)`,
      qty: ufhArea,
      unitCost: 42,
      unit: "m²",
      required: true,
    });
  } else if (input.radiatorLines?.length) {
    input.radiatorLines.forEach((line, index) => {
      lines.push({
        id: `kit-rad-${index}`,
        category: "Emitters",
        description: line.description,
        qty: line.qty,
        unitCost: line.unitCost,
        required: true,
      });
    });
    if (emitterMode === "mixed") {
      lines.push({
        id: "kit-ufh-mixed",
        category: "Emitters",
        description: "UFH allowance for wet rooms (mixed design)",
        qty: 1,
        unitCost: 680,
        required: true,
      });
    }
  } else if (input.emitterUpgradeCount > 0) {
    lines.push({
      id: "kit-rads",
      category: "Emitters",
      description: `Radiator upgrades (allowance × ${input.emitterUpgradeCount})`,
      qty: input.emitterUpgradeCount,
      unitCost: 220,
      required: true,
    });
  }

  for (const extraId of input.extras) {
    const extra = kitExtraOptions.find((item) => item.id === extraId);
    if (!extra) continue;
    lines.push({
      id: `kit-extra-${extra.id}`,
      category: extra.category,
      description: extra.label,
      qty: 1,
      unitCost: extra.unitCost,
      required: false,
    });
  }

  if (input.systemLabel) {
    lines.unshift({
      id: "kit-system-note",
      category: "System",
      description: `Design system: ${input.systemLabel} · ${input.flowTemperature}°C flow`,
      qty: 1,
      unitCost: 0,
      required: true,
    });
  }

  return lines;
}

/**
 * Pure takeoff rate library defaults + lookup (client-safe — no SQLite).
 * Persistence lives in takeoff-rate-library.ts (server only).
 */

export type TakeoffRateUnit = "m" | "nr" | "m2" | "run";

export type TakeoffRateEntry = {
  id: string;
  label: string;
  /** Case-insensitive substring / simple pattern tested against BOQ description. */
  match: string;
  unit: TakeoffRateUnit;
  unitCost: number;
  category: "pipe" | "fitting" | "fixture" | "other";
};

export type TakeoffAssemblyLine = {
  code: string;
  description: string;
  unit: TakeoffRateUnit;
  qtyPerPrimary: number;
  unitCost: number;
};

export type TakeoffAssemblyKit = {
  id: string;
  primaryCode: string;
  label: string;
  /** Match primary BOQ/description lines. */
  match: string;
  enabled: boolean;
  lines: TakeoffAssemblyLine[];
};

export type TakeoffRateLibrary = {
  version: 1;
  rates: TakeoffRateEntry[];
  assemblies: TakeoffAssemblyKit[];
  updatedAt: string;
};

export function defaultTakeoffRateLibrary(): TakeoffRateLibrary {
  return {
    version: 1,
    rates: [
      { id: "rate-cu-15", label: "15mm Copper", match: "15mm Copper|15 Cu", unit: "m", unitCost: 4.2, category: "pipe" },
      { id: "rate-cu-22", label: "22mm Copper", match: "22mm Copper|22 Cu", unit: "m", unitCost: 7.8, category: "pipe" },
      { id: "rate-cu-28", label: "28mm Copper", match: "28mm Copper|28 Cu", unit: "m", unitCost: 12.5, category: "pipe" },
      { id: "rate-cu-35", label: "35mm Copper", match: "35mm Copper|35 Cu", unit: "m", unitCost: 18, category: "pipe" },
      { id: "rate-hep-15", label: "15mm Hep2O", match: "15mm Hep|15 Hep", unit: "m", unitCost: 3.4, category: "pipe" },
      { id: "rate-hep-22", label: "22mm Hep2O", match: "22mm Hep|22 Hep", unit: "m", unitCost: 5.6, category: "pipe" },
      { id: "rate-hep-28", label: "28mm Hep2O", match: "28mm Hep|28 Hep", unit: "m", unitCost: 8.4, category: "pipe" },
      { id: "rate-waste-32", label: "32mm waste", match: "32mm Waste|32 waste", unit: "m", unitCost: 2.8, category: "pipe" },
      { id: "rate-waste-40", label: "40mm waste", match: "40mm Waste|40 waste", unit: "m", unitCost: 3.6, category: "pipe" },
      { id: "rate-waste-50", label: "50mm waste", match: "50mm Waste|50 waste", unit: "m", unitCost: 5.2, category: "pipe" },
      { id: "rate-soil-110", label: "110mm soil", match: "110mm Soil|110 soil", unit: "m", unitCost: 9.5, category: "pipe" },
      { id: "rate-elbow", label: "90° elbow", match: "90° elbow|elbow", unit: "nr", unitCost: 1.85, category: "fitting" },
      { id: "rate-coupling", label: "Coupling", match: "coupling", unit: "nr", unitCost: 1.35, category: "fitting" },
      { id: "rate-wc", label: "WC", match: "P-WC|WC pan|\\bWC\\b", unit: "nr", unitCost: 185, category: "fixture" },
      { id: "rate-whb", label: "WHB / basin", match: "P-WHB|Wash hand basin|\\bbasin\\b", unit: "nr", unitCost: 95, category: "fixture" },
      { id: "rate-bath", label: "Bath", match: "P-BATH|\\bbath\\b", unit: "nr", unitCost: 220, category: "fixture" },
      { id: "rate-shower", label: "Shower", match: "P-SHR|\\bshower\\b", unit: "nr", unitCost: 160, category: "fixture" },
      { id: "rate-rad", label: "Radiator", match: "P-RAD|\\bradiator\\b", unit: "nr", unitCost: 95, category: "fixture" },
      { id: "rate-sink", label: "Sink", match: "P-SINK|\\bsink\\b", unit: "nr", unitCost: 110, category: "fixture" },
      { id: "rate-boiler", label: "Boiler", match: "P-BOILER|\\bBoiler\\b", unit: "nr", unitCost: 1450, category: "fixture" },
      { id: "rate-ashp", label: "ASHP", match: "P-ASHP|\\bASHP\\b|heat pump", unit: "nr", unitCost: 4200, category: "fixture" },
      { id: "rate-cylinder", label: "Cylinder", match: "P-CYL|\\bCylinder\\b", unit: "nr", unitCost: 780, category: "fixture" },
      { id: "rate-manifold", label: "UFH manifold", match: "P-MANIFOLD|UFH manifold|\\bmanifold\\b", unit: "nr", unitCost: 320, category: "fixture" },
    ],
    assemblies: [
      {
        id: "asm-wc",
        primaryCode: "P-WC",
        label: "WC kit",
        match: "P-WC|WC pan|\\bWC\\b",
        enabled: true,
        lines: [
          { code: "P-WC-CIST", description: "WC cistern", unit: "nr", qtyPerPrimary: 1, unitCost: 65 },
          { code: "P-WC-SEAT", description: "WC seat", unit: "nr", qtyPerPrimary: 1, unitCost: 28 },
          { code: "P-WC-CONN", description: "WC pan connector", unit: "nr", qtyPerPrimary: 1, unitCost: 8.5 },
          { code: "P-WC-ISO", description: "WC cistern isolation valve", unit: "nr", qtyPerPrimary: 1, unitCost: 6.5 },
          { code: "P-WC-FLEX", description: "WC cistern flexi fill", unit: "nr", qtyPerPrimary: 1, unitCost: 4.5 },
        ],
      },
      {
        id: "asm-whb",
        primaryCode: "P-WHB",
        label: "WHB kit",
        match: "P-WHB|Wash hand basin|\\bbasin\\b",
        enabled: true,
        lines: [
          { code: "P-WHB-TAP", description: "Basin taps / mixer", unit: "nr", qtyPerPrimary: 1, unitCost: 45 },
          { code: "P-WHB-WASTE", description: "Basin waste", unit: "nr", qtyPerPrimary: 1, unitCost: 8 },
          { code: "P-WHB-ISO", description: "Basin isolation valves", unit: "nr", qtyPerPrimary: 2, unitCost: 6.5 },
        ],
      },
      {
        id: "asm-rad",
        primaryCode: "P-RAD",
        label: "Radiator kit",
        match: "P-RAD|\\bradiator\\b",
        enabled: true,
        lines: [
          { code: "P-RAD-TRV", description: "TRV", unit: "nr", qtyPerPrimary: 1, unitCost: 18 },
          { code: "P-RAD-LS", description: "Lockshield valve", unit: "nr", qtyPerPrimary: 1, unitCost: 9 },
          { code: "P-RAD-TAILS", description: "Radiator tails / copper", unit: "nr", qtyPerPrimary: 1, unitCost: 12 },
        ],
      },
      {
        id: "asm-boiler",
        primaryCode: "P-BOILER",
        label: "Boiler kit",
        match: "P-BOILER|\\bBoiler\\b",
        enabled: true,
        lines: [
          { code: "P-BOILER-FLUE", description: "Flue kit", unit: "nr", qtyPerPrimary: 1, unitCost: 95 },
          { code: "P-BOILER-MAG", description: "System filter / magnaclean", unit: "nr", qtyPerPrimary: 1, unitCost: 85 },
          { code: "P-BOILER-VALVES", description: "Boiler isolation / filling loop set", unit: "nr", qtyPerPrimary: 1, unitCost: 48 },
          { code: "P-BOILER-COND", description: "Condensate pipe / neutraliser", unit: "nr", qtyPerPrimary: 1, unitCost: 35 },
        ],
      },
      {
        id: "asm-ashp",
        primaryCode: "P-ASHP",
        label: "ASHP kit",
        match: "P-ASHP|\\bASHP\\b",
        enabled: true,
        lines: [
          { code: "P-ASHP-BASE", description: "Outdoor unit base / anti-vib mounts", unit: "nr", qtyPerPrimary: 1, unitCost: 120 },
          { code: "P-ASHP-FLEX", description: "Flexible hose kit", unit: "nr", qtyPerPrimary: 1, unitCost: 65 },
          { code: "P-ASHP-CONT", description: "Controls / wiring centre", unit: "nr", qtyPerPrimary: 1, unitCost: 180 },
          { code: "P-ASHP-GLYCOL", description: "Antifreeze / inhibitor pack", unit: "nr", qtyPerPrimary: 1, unitCost: 55 },
        ],
      },
      {
        id: "asm-cylinder",
        primaryCode: "P-CYL",
        label: "Cylinder kit",
        match: "P-CYL|\\bCylinder\\b",
        enabled: true,
        lines: [
          { code: "P-CYL-G3", description: "G3 discharge / tundish pack", unit: "nr", qtyPerPrimary: 1, unitCost: 75 },
          { code: "P-CYL-EXP", description: "Expansion vessel", unit: "nr", qtyPerPrimary: 1, unitCost: 85 },
          { code: "P-CYL-VALVE", description: "Inlet control group", unit: "nr", qtyPerPrimary: 1, unitCost: 95 },
          { code: "P-CYL-STAT", description: "Cylinder thermostat / sensor", unit: "nr", qtyPerPrimary: 1, unitCost: 28 },
        ],
      },
      {
        id: "asm-manifold",
        primaryCode: "P-MANIFOLD",
        label: "UFH manifold kit",
        match: "P-MANIFOLD|UFH manifold|\\bmanifold\\b",
        enabled: true,
        lines: [
          { code: "P-UFH-ACT", description: "Manifold actuators (set)", unit: "nr", qtyPerPrimary: 1, unitCost: 95 },
          { code: "P-UFH-CAB", description: "Manifold cabinet", unit: "nr", qtyPerPrimary: 1, unitCost: 110 },
          { code: "P-UFH-BLEND", description: "Blending / pumpset", unit: "nr", qtyPerPrimary: 1, unitCost: 220 },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function cloneDefaultTakeoffRateLibrary(): TakeoffRateLibrary {
  return JSON.parse(JSON.stringify(defaultTakeoffRateLibrary())) as TakeoffRateLibrary;
}

function matchHay(hay: string, pattern: string): boolean {
  const parts = pattern.split("|").map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    try {
      if (new RegExp(part, "i").test(hay)) return true;
    } catch {
      if (hay.toLowerCase().includes(part.toLowerCase())) return true;
    }
  }
  return false;
}

export function lookupLibraryRate(
  description: string,
  unit: string,
  library: TakeoffRateLibrary = defaultTakeoffRateLibrary(),
): number {
  const hay = description.trim();
  for (const row of library.rates) {
    if (row.unit !== unit && unit !== "run") continue;
    if (!(row.unitCost > 0)) continue;
    if (matchHay(hay, row.match) || matchHay(hay, row.label)) return row.unitCost;
  }
  return 0;
}

export type MaterialLine = {
  id: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  markupPercent: number;
  supplierRequired: boolean;
  /** Price Ledger: budget | guide | rfq | firm */
  pricingState?: "budget" | "guide" | "rfq" | "firm";
  pricingSource?: string;
  pricingNote?: string;
  pricedAt?: string;
};

/** Expand enabled assembly kits from primary fixture counts already on the BOQ. */
export function expandTakeoffAssemblies<T extends MaterialLine>(
  lines: T[],
  library: TakeoffRateLibrary = defaultTakeoffRateLibrary(),
): T[] {
  const extras: T[] = [];
  const existingKeys = new Set(lines.map((line) => `${line.description}|${line.unit}`.toLowerCase()));

  for (const kit of library.assemblies) {
    if (!kit.enabled) continue;
    let primaryQty = 0;
    for (const line of lines) {
      if (line.unit !== "nr") continue;
      if (matchHay(line.description, kit.match) || matchHay(line.description, kit.primaryCode)) {
        primaryQty += line.quantity || 0;
      }
    }
    if (!(primaryQty > 0)) continue;

    for (const part of kit.lines) {
      const qty = Number((primaryQty * (part.qtyPerPrimary || 1)).toFixed(2));
      if (!(qty > 0)) continue;
      const description = `Takeoff · ${part.description}`;
      const key = `${description}|${part.unit}`.toLowerCase();
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      extras.push({
        id: `studio-asm-${kit.id}-${part.code}`,
        section: "Assemblies",
        description,
        quantity: qty,
        unit: part.unit,
        unitCost: part.unitCost || 0,
        markupPercent: 0,
        supplierRequired: false,
      } as T);
    }
  }

  return [...lines, ...extras];
}

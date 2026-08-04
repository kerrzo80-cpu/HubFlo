/** Construction quantity takeoff skill — primary/secondary architecture from the Contractor OS workflow. */

export type TakeoffTradeId =
  | "architectural"
  | "structural"
  | "mechanical"
  | "electrical"
  | "plumbing"
  | "heating"
  | "civil";

export type TakeoffSkillStep =
  | "drawings"
  | "analyse"
  | "scope"
  | "plan"
  | "measure"
  | "review"
  | "boq";

export type TakeoffMeasureMethod =
  | "text-tag-count"
  | "schedule-extract"
  | "explicit-dimension"
  | "vector-length"
  | "vision-area"
  | "vision-count"
  | "derived-formula";

export type TakeoffConfidence = "High" | "Medium" | "Low";

export type TakeoffQuantityKind = "primary" | "secondary";

export type TakeoffDrawingSheet = {
  id: string;
  documentId: string;
  fileName: string;
  page?: number;
  title: string;
  discipline: string;
  sheetNumber?: string;
  revision?: string;
  notes: string[];
  hasSelectableText?: boolean;
  reliability: TakeoffConfidence;
};

export type TakeoffDrawingIndex = {
  status: "idle" | "running" | "ready" | "error";
  summary: string;
  sheets: TakeoffDrawingSheet[];
  objectHints: string[];
  completedAt?: string;
  error?: string;
};

export type TakeoffAssemblyItem = {
  id: string;
  kind: TakeoffQuantityKind;
  code: string;
  description: string;
  unit: string;
  /** For secondary rows: which primary they derive from */
  derivedFromPrimaryId?: string;
  /** Formula / ratio explanation, e.g. "slab area × depth" or "15 m cable per outlet" */
  derivation?: string;
  method: TakeoffMeasureMethod;
  expectedConfidence: TakeoffConfidence;
  included: boolean;
  notes?: string;
};

export type TakeoffMeasuredQuantity = {
  id: string;
  assemblyId: string;
  kind: TakeoffQuantityKind;
  code: string;
  description: string;
  quantity: number;
  unit: string;
  method: TakeoffMeasureMethod;
  confidence: TakeoffConfidence;
  sourceSheetIds: string[];
  derivation?: string;
  sanityCheck?: {
    ok: boolean;
    detail: string;
  };
  notes?: string;
  /** Text-tag hits used for markup / audit (page coords in PDF space). */
  tagMatches?: Array<{
    documentId: string;
    fileName: string;
    pageNumber: number;
    text: string;
    x: number;
    y: number;
    pageWidth?: number;
    pageHeight?: number;
    /** Office excluded this hit on the overlay review */
    excluded?: boolean;
  }>;
};

export type TakeoffSkillScope = {
  trade: TakeoffTradeId;
  focusLabels: string[];
  outputFormats: Array<"excel-boq" | "marked-pdf" | "quote-push">;
  notes: string;
};

export type TakeoffSkillWorkflow = {
  step: TakeoffSkillStep;
  drawingIndex: TakeoffDrawingIndex;
  scope: TakeoffSkillScope;
  assemblies: TakeoffAssemblyItem[];
  planApproved: boolean;
  planSummary: string;
  measured: TakeoffMeasuredQuantity[];
  measureSummary: string;
  sanitySummary: string;
  updatedAt?: string;
};

export const TAKEOFF_TRADES: Array<{ id: TakeoffTradeId; label: string; blurb: string }> = [
  { id: "plumbing", label: "Plumbing", blurb: "Hot/cold, sanitary, waste, soil stacks" },
  { id: "heating", label: "Heating / mechanical", blurb: "Boilers, radiators, pipework, UFH" },
  { id: "mechanical", label: "Mechanical plant", blurb: "Plant, flues, ventilation, condensates" },
  { id: "electrical", label: "Electrical", blurb: "Outlets, lights, cable tray, containment" },
  { id: "architectural", label: "Architectural", blurb: "Floor areas, rooms, finishes" },
  { id: "structural", label: "Structural / concrete", blurb: "Slabs, footings, steel members" },
  { id: "civil", label: "Civil", blurb: "Drainage, external works, paving" },
];

export const TAKEOFF_SKILL_STEPS: Array<{ id: TakeoffSkillStep; label: string; detail: string }> = [
  { id: "drawings", label: "Drawings", detail: "Upload the drawing set into this project folder" },
  { id: "analyse", label: "Analyse", detail: "Index sheets into a structured drawing map" },
  { id: "scope", label: "Scope", detail: "Choose trade and what to take off" },
  { id: "plan", label: "Plan", detail: "Primary vs secondary assemblies — review before measuring" },
  { id: "measure", label: "Measure", detail: "Count / extract using the most reliable method" },
  { id: "review", label: "Review", detail: "Confidence scores and sanity checks" },
  { id: "boq", label: "BOQ", detail: "Bill of quantities and push into Core quote" },
];

type TradeTemplate = {
  focusOptions: string[];
  assemblies: Array<Omit<TakeoffAssemblyItem, "id" | "included"> & { included?: boolean }>;
};

const TRADE_TEMPLATES: Record<TakeoffTradeId, TradeTemplate> = {
  plumbing: {
    focusOptions: [
      "WCs",
      "Basins / WHBs",
      "Baths",
      "Showers",
      "Sinks",
      "Hot & cold pipe + fittings",
      "Waste / soil",
      "Isolation valves",
    ],
    assemblies: [
      {
        kind: "primary",
        code: "P-WC",
        description: "WCs (pans)",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
        notes: "Count WC / pan tags only — not basins or baths",
      },
      {
        kind: "secondary",
        code: "P-WC-CONN",
        description: "WC pan connector",
        unit: "nr",
        derivedFromPrimaryId: "P-WC",
        derivation: "1 pan connector per WC",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-WC-ISO",
        description: "WC cistern isolation valve",
        unit: "nr",
        derivedFromPrimaryId: "P-WC",
        derivation: "1 isolation valve per WC",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-WHB",
        description: "Wash hand basins / WHBs",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-WHB-TAP",
        description: "Basin taps / mixer (pair or mono)",
        unit: "nr",
        derivedFromPrimaryId: "P-WHB",
        derivation: "1 tap set per basin",
        method: "derived-formula",
        expectedConfidence: "High",
        notes: "Not a mystery kit — this is the basin tapware allowance",
      },
      {
        kind: "secondary",
        code: "P-WHB-WASTE",
        description: "Basin waste + bottle trap",
        unit: "nr",
        derivedFromPrimaryId: "P-WHB",
        derivation: "1 waste + trap per basin",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-WHB-ISO",
        description: "Basin isolation valves",
        unit: "nr",
        derivedFromPrimaryId: "P-WHB",
        derivation: "2 isolation valves per basin",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-BATH",
        description: "Baths",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-BATH-TAP",
        description: "Bath taps / mixer",
        unit: "nr",
        derivedFromPrimaryId: "P-BATH",
        derivation: "1 tap set per bath",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-BATH-WASTE",
        description: "Bath waste / trap",
        unit: "nr",
        derivedFromPrimaryId: "P-BATH",
        derivation: "1 waste per bath",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-BATH-ISO",
        description: "Bath isolation valves",
        unit: "nr",
        derivedFromPrimaryId: "P-BATH",
        derivation: "2 isolation valves per bath",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-SHR",
        description: "Showers",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-SHR-VALVE",
        description: "Shower valve / mixer",
        unit: "nr",
        derivedFromPrimaryId: "P-SHR",
        derivation: "1 shower valve per shower",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-SHR-TRAP",
        description: "Shower waste / trap",
        unit: "nr",
        derivedFromPrimaryId: "P-SHR",
        derivation: "1 trap per shower",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-SINK",
        description: "Kitchen / utility sinks",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-SINK-TAP",
        description: "Sink mixer tap",
        unit: "nr",
        derivedFromPrimaryId: "P-SINK",
        derivation: "1 mixer per sink",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-SINK-WASTE",
        description: "Sink waste + trap",
        unit: "nr",
        derivedFromPrimaryId: "P-SINK",
        derivation: "1 waste + trap per sink",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-APPL",
        description: "Appliance points (WM / DW / fridge ice only)",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "Medium",
        notes: "Only tagged appliance feeds — not every hot/cold label on the drawing",
      },
      {
        kind: "primary",
        code: "P-PIPE-HC",
        description: "Hot & cold pipework (measured / scheduled)",
        unit: "m",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
        notes: "Prefer stated lengths. If unknown, derive from appliances + sanitary later.",
      },
      {
        kind: "secondary",
        code: "P-ELBOW",
        description: "Elbows / bends (hot & cold)",
        unit: "nr",
        derivedFromPrimaryId: "P-PIPE-HC",
        derivation: "1.4 elbows per metre of H/C pipe",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
      {
        kind: "secondary",
        code: "P-TEE",
        description: "Tees (hot & cold)",
        unit: "nr",
        derivedFromPrimaryId: "P-PIPE-HC",
        derivation: "0.35 tees per metre of H/C pipe",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
      {
        kind: "secondary",
        code: "P-COUP",
        description: "Couplings / connectors (hot & cold)",
        unit: "nr",
        derivedFromPrimaryId: "P-PIPE-HC",
        derivation: "0.5 couplings per metre of H/C pipe",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
      {
        kind: "secondary",
        code: "P-PIPE-FROM-PTS",
        description: "H/C pipe allowance from sanitary + appliances",
        unit: "m",
        derivedFromPrimaryId: "P-WHB",
        derivation: "8 m pipe per basin (office adjusts)",
        method: "derived-formula",
        expectedConfidence: "Low",
        included: false,
        notes: "Optional fallback when pipe metres are not on the drawing — leave off if P-PIPE-HC is measured",
      },
      {
        kind: "primary",
        code: "P-SVP",
        description: "Soil / vent stacks (SVP)",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-WASTE",
        description: "Waste runs (where tagged / scheduled)",
        unit: "m",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
      },
    ],
  },
  heating: {
    focusOptions: [
      "Radiators / emitters",
      "Boiler / plant",
      "Heating pipework",
      "UFH manifolds",
      "Flue packages",
    ],
    assemblies: [
      {
        kind: "primary",
        code: "H-RAD",
        description: "Radiators / emitters",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "H-VALVE",
        description: "TRV / lockshield pairs",
        unit: "nr",
        derivedFromPrimaryId: "H-RAD",
        derivation: "1 TRV + 1 lockshield per radiator",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "H-BOILER",
        description: "Boiler / heat source",
        unit: "nr",
        method: "schedule-extract",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "H-PIPE",
        description: "Heating flow/return route length (where dimensioned)",
        unit: "m",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
      },
      {
        kind: "secondary",
        code: "H-FITTING",
        description: "Heating fittings allowance",
        unit: "nr",
        derivedFromPrimaryId: "H-PIPE",
        derivation: "1.8 fittings per metre of pipe",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
    ],
  },
  mechanical: {
    focusOptions: ["Plant schedule", "Flues", "Ventilation", "Condensate", "Valves"],
    assemblies: [
      {
        kind: "primary",
        code: "M-PLANT",
        description: "Plant items from schedule / tags",
        unit: "nr",
        method: "schedule-extract",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "M-FLUE",
        description: "Flue packages",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "M-COND",
        description: "Condensate run allowance",
        unit: "m",
        derivedFromPrimaryId: "M-PLANT",
        derivation: "8 m condensate per plant item",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
    ],
  },
  electrical: {
    focusOptions: ["Power outlets", "Lighting", "Cable tray", "Containment", "Distribution boards"],
    assemblies: [
      {
        kind: "primary",
        code: "E-SOCKET",
        description: "Power outlets / sockets",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
        notes: "Count tags — do not measure each cable run individually",
      },
      {
        kind: "secondary",
        code: "E-CABLE",
        description: "Cable allowance to outlets",
        unit: "m",
        derivedFromPrimaryId: "E-SOCKET",
        derivation: "15 m cable per outlet",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
      {
        kind: "primary",
        code: "E-LIGHT",
        description: "Light fittings",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "E-TRAY",
        description: "Cable tray / containment length",
        unit: "m",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
      },
    ],
  },
  architectural: {
    focusOptions: ["Floor / slab area", "Room schedule", "Wall areas", "Openings", "Finishes"],
    assemblies: [
      {
        kind: "primary",
        code: "A-AREA",
        description: "Floor / slab area",
        unit: "m2",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
        notes: "Prefer stated length × width on drawing over vision scale measure",
      },
      {
        kind: "secondary",
        code: "A-SCREED",
        description: "Screed / finish volume",
        unit: "m3",
        derivedFromPrimaryId: "A-AREA",
        derivation: "area × stated depth",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "A-ROOM",
        description: "Rooms from schedule / tags",
        unit: "nr",
        method: "schedule-extract",
        expectedConfidence: "High",
      },
    ],
  },
  structural: {
    focusOptions: ["Slab area", "Footings count", "Concrete volume", "Steel members", "Reinforcement"],
    assemblies: [
      {
        kind: "primary",
        code: "S-SLAB",
        description: "Slab area",
        unit: "m2",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
      },
      {
        kind: "secondary",
        code: "S-SLAB-VOL",
        description: "Slab concrete volume",
        unit: "m3",
        derivedFromPrimaryId: "S-SLAB",
        derivation: "slab area × depth from section / note",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "S-FOOT",
        description: "Footings / pads (text tags)",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "S-FOOT-VOL",
        description: "Footing concrete volume",
        unit: "m3",
        derivedFromPrimaryId: "S-FOOT",
        derivation: "count × footing type volume from schedule",
        method: "derived-formula",
        expectedConfidence: "High",
      },
    ],
  },
  civil: {
    focusOptions: ["Drainage runs", "Manholes", "Paving area", "External services"],
    assemblies: [
      {
        kind: "primary",
        code: "C-MH",
        description: "Manholes / inspection chambers",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "C-DRAIN",
        description: "Drainage run length",
        unit: "m",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
      },
      {
        kind: "primary",
        code: "C-PAVE",
        description: "Paving / hardstanding area",
        unit: "m2",
        method: "explicit-dimension",
        expectedConfidence: "Medium",
      },
    ],
  },
};

export function createDefaultTakeoffSkill(): TakeoffSkillWorkflow {
  return {
    step: "drawings",
    drawingIndex: {
      status: "idle",
      summary: "",
      sheets: [],
      objectHints: [],
    },
    scope: {
      trade: "plumbing",
      focusLabels: [],
      outputFormats: ["excel-boq", "quote-push"],
      notes: "",
    },
    assemblies: [],
    planApproved: false,
    planSummary: "",
    measured: [],
    measureSummary: "",
    sanitySummary: "",
  };
}

export function focusOptionsForTrade(trade: TakeoffTradeId): string[] {
  return TRADE_TEMPLATES[trade].focusOptions;
}

function focusMatchesAssembly(
  item: { code: string; description: string; notes?: string },
  focusLabels: string[],
): boolean {
  if (!focusLabels.length) return true;
  const hay = `${item.code} ${item.description} ${item.notes || ""}`.toLowerCase();
  return focusLabels.some((label) => {
    const lower = label.toLowerCase();
    if (lower.includes("wc") && item.code.startsWith("P-WC")) return true;
    if ((lower.includes("basin") || lower.includes("whb")) && item.code.startsWith("P-WHB")) return true;
    if (lower.includes("bath") && item.code.startsWith("P-BATH")) return true;
    if (lower.includes("shower") && item.code.startsWith("P-SHR")) return true;
    if (lower.includes("sink") && item.code.startsWith("P-SINK")) return true;
    if ((lower.includes("pipe") || lower.includes("fitting") || lower.includes("hot")) && (
      item.code.startsWith("P-PIPE") || item.code === "P-ELBOW" || item.code === "P-TEE" || item.code === "P-COUP" || item.code === "P-APPL"
    )) return true;
    if ((lower.includes("waste") || lower.includes("soil") || lower.includes("isolation")) && (
      item.code.startsWith("P-SVP") || item.code.startsWith("P-WASTE") || item.code.includes("-ISO")
    )) return true;
    const token = lower.split(/[^a-z0-9]+/).find((part) => part.length >= 3) || "";
    return Boolean(token) && (
      hay.includes(token) ||
      lower.includes(item.code.toLowerCase()) ||
      item.code.toLowerCase().includes(token.slice(0, 3))
    );
  });
}

export function buildAssembliesForScope(scope: TakeoffSkillScope): TakeoffAssemblyItem[] {
  const template = TRADE_TEMPLATES[scope.trade];
  const stamp = Date.now();

  const primaries = template.assemblies.filter((item) => item.kind === "primary");
  const idByCode = new Map<string, string>();
  const primaryIncludedByCode = new Map<string, boolean>();
  for (const [index, item] of primaries.entries()) {
    idByCode.set(item.code, `${item.code}-${stamp}-${index}`);
    primaryIncludedByCode.set(
      item.code,
      item.included ?? focusMatchesAssembly(item, scope.focusLabels),
    );
  }

  return template.assemblies.map((item, index) => {
    const id = item.kind === "primary"
      ? (idByCode.get(item.code) ?? `${item.code}-${stamp}-${index}`)
      : `${item.code}-${stamp}-${index}`;
    const parentCode = item.kind === "secondary" ? item.derivedFromPrimaryId : undefined;
    const focusHit = item.kind === "secondary" && parentCode
      ? (primaryIncludedByCode.get(parentCode) ?? false)
      : focusMatchesAssembly(item, scope.focusLabels);
    return {
      kind: item.kind,
      code: item.code,
      description: item.description,
      unit: item.unit,
      method: item.method,
      expectedConfidence: item.expectedConfidence,
      notes: item.notes,
      derivation: item.derivation,
      id,
      included: item.included ?? focusHit,
      derivedFromPrimaryId: parentCode ? idByCode.get(parentCode) : undefined,
    };
  });
}

export function methodLabel(method: TakeoffMeasureMethod): string {
  switch (method) {
    case "text-tag-count":
      return "Text / tag count";
    case "schedule-extract":
      return "Schedule extract";
    case "explicit-dimension":
      return "Explicit dimension";
    case "vector-length":
      return "Vector length";
    case "vision-area":
      return "Vision area (lower confidence)";
    case "vision-count":
      return "Vision count (lower confidence)";
    case "derived-formula":
      return "Derived from primary";
    default:
      return method;
  }
}

export function confidenceRank(method: TakeoffMeasureMethod): TakeoffConfidence {
  switch (method) {
    case "text-tag-count":
    case "schedule-extract":
    case "derived-formula":
      return "High";
    case "explicit-dimension":
    case "vector-length":
      return "Medium";
    case "vision-area":
    case "vision-count":
      return "Low";
    default:
      return "Medium";
  }
}

/** Derive secondary quantities from measured primaries using simple ratio parsing. */
export function deriveSecondaryQuantity(
  assembly: TakeoffAssemblyItem,
  primaryQty: number,
): number {
  const text = (assembly.derivation || "").toLowerCase();
  if (text.includes("×") || text.includes("x depth") || text.includes("× depth")) {
    return 0;
  }
  // First number is the multiplier: "2 isolation valves per basin", "1.4 elbows per metre"
  const firstNum = text.match(/(\d+(?:\.\d+)?)/);
  if (firstNum) {
    return Math.round(primaryQty * Number(firstNum[1]) * 100) / 100;
  }
  if (assembly.unit === "nr") return primaryQty;
  return primaryQty;
}

export function boqRowsFromMeasured(measured: TakeoffMeasuredQuantity[]) {
  return measured.map((row) => ({
    id: row.id,
    source: "Takeoff" as const,
    section: row.kind === "primary" ? "Primary quantities" : "Secondary quantities",
    description: `${row.code} · ${row.description}`,
    quantity: row.quantity,
    unit: row.unit,
    supplierRequired: false,
    unitCost: 0,
    markupPercent: 30,
    confidence: row.confidence,
    method: row.method,
  }));
}

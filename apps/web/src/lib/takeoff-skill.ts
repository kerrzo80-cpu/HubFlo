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
  /** Text-tag hits used for markup / audit (page coords). */
  tagMatches?: Array<{
    documentId: string;
    fileName: string;
    pageNumber: number;
    text: string;
    x: number;
    y: number;
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
      "Sanitary fittings count",
      "Hot & cold pipe runs",
      "Waste / soil stacks",
      "Valves & isolation",
      "Plant connections",
    ],
    assemblies: [
      {
        kind: "primary",
        code: "P-SAN",
        description: "Sanitary fittings (basins, WCs, baths, showers)",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
        notes: "Prefer counting labels / tags on the drawing over vision symbol recognition",
      },
      {
        kind: "secondary",
        code: "P-SAN-TAP",
        description: "Tap / waste kits for sanitary fittings",
        unit: "nr",
        derivedFromPrimaryId: "P-SAN",
        derivation: "1 kit per sanitary fitting",
        method: "derived-formula",
        expectedConfidence: "High",
      },
      {
        kind: "primary",
        code: "P-OUTLET",
        description: "Hot / cold outlets & appliance points",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
      },
      {
        kind: "secondary",
        code: "P-PIPE-HC",
        description: "Hot & cold pipework allowance",
        unit: "m",
        derivedFromPrimaryId: "P-OUTLET",
        derivation: "12 m pipe per outlet (adjustable ratio)",
        method: "derived-formula",
        expectedConfidence: "Medium",
      },
      {
        kind: "primary",
        code: "P-STACK",
        description: "Soil / waste stacks",
        unit: "nr",
        method: "text-tag-count",
        expectedConfidence: "High",
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

export function buildAssembliesForScope(scope: TakeoffSkillScope): TakeoffAssemblyItem[] {
  const template = TRADE_TEMPLATES[scope.trade];
  const focus = new Set(scope.focusLabels.map((label) => label.toLowerCase()));
  const stamp = Date.now();

  const primaries = template.assemblies.filter((item) => item.kind === "primary");
  const idByCode = new Map<string, string>();
  for (const [index, item] of primaries.entries()) {
    idByCode.set(item.code, `${item.code}-${stamp}-${index}`);
  }

  return template.assemblies.map((item, index) => {
    const id = item.kind === "primary"
      ? (idByCode.get(item.code) ?? `${item.code}-${stamp}-${index}`)
      : `${item.code}-${stamp}-${index}`;
    const focusHit =
      focus.size === 0 ||
      [...focus].some((label) => {
        const token = label.split(/\s+/)[0]?.toLowerCase() ?? "";
        return (
          item.description.toLowerCase().includes(token) ||
          label.includes(item.code.toLowerCase()) ||
          item.code.toLowerCase().includes(token.slice(0, 3))
        );
      });
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
      derivedFromPrimaryId: item.derivedFromPrimaryId
        ? idByCode.get(item.derivedFromPrimaryId)
        : undefined,
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
  const ratioMatch = text.match(/(\d+(?:\.\d+)?)\s*m/);
  if (ratioMatch && assembly.unit === "m") {
    return Math.round(primaryQty * Number(ratioMatch[1]) * 100) / 100;
  }
  const eachMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kit|trv|lockshield|fitting|pair)?/i);
  if (text.includes("per") && eachMatch) {
    return Math.round(primaryQty * Number(eachMatch[1]) * 100) / 100;
  }
  if (text.includes("×") || text.includes("x depth") || text.includes("× depth")) {
    // depth unknown — leave 0 for office to fill unless noted
    return 0;
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

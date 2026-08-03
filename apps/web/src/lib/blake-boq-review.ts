import type { TakeoffLabourAllowance, TakeoffMaterialAllowance, TakeoffProject } from "@/lib/takeoff-data";

export type BlakeBoqAncillarySuggestion = {
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  supplierRequired: boolean;
  rationale: string;
};

export type BlakeBoqLabourSuggestion = {
  role: string;
  hoursPerUnit: number;
  unitBasis: string;
  hours: number;
  costRate: number;
  notes: string;
};

export type BlakeBoqLineReview = {
  parentMaterialId: string;
  parentDescription: string;
  parentQuantity: number;
  parentUnit: string;
  section: string;
  ancillaries: BlakeBoqAncillarySuggestion[];
  labour: BlakeBoqLabourSuggestion[];
  drawingNotes: string[];
  skippedRestate: boolean;
};

export type BlakeBoqReviewDraft = {
  summary: string;
  confidence: "Low" | "Medium" | "High";
  reviews: BlakeBoqLineReview[];
  questions: string[];
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeUnit(unit: string) {
  const lower = unit.trim().toLowerCase();
  if (["m", "lm", "lin.m", "lin m", "metre", "metres", "meter", "meters"].includes(lower)) return "m";
  if (["nr", "no", "no.", "each", "ea", "item"].includes(lower)) return "Nr";
  if (["sum", "item", "allowance", "ls"].includes(lower)) return "sum";
  return unit.trim() || "item";
}

/** Rule-of-thumb Blake review when OpenAI is offline or as a baseline. */
export function buildHeuristicBlakeBoqReview(materials: TakeoffMaterialAllowance[]): BlakeBoqReviewDraft {
  const billLines = materials.filter((line) => !line.parentMaterialId);
  const reviews: BlakeBoqLineReview[] = billLines.map((line) => {
    const unit = normalizeUnit(line.unit);
    const qty = Math.max(0, line.quantity);
    const haystack = `${line.description} ${line.section}`.toLowerCase();
    const ancillaries: BlakeBoqAncillarySuggestion[] = [];
    const labour: BlakeBoqLabourSuggestion[] = [];
    const drawingNotes: string[] = [];

    // Never restate the parent quantity — only derive ancillaries / labour.
    if (/(gutter|rainwater|half round|pvc gutter)/i.test(haystack) && unit === "m" && qty > 0) {
      const clips = Math.max(1, Math.ceil(qty / 1));
      ancillaries.push({
        description: "Gutter support clips / fascia brackets",
        quantity: clips,
        unit: "Nr",
        unitCost: 0,
        supplierRequired: true,
        rationale: `Rule of thumb ~1 clip per metre on ${qty}m gutters (confirm spacing on drawing).`,
      });
      if (!/stop end/i.test(haystack)) {
        drawingNotes.push("Confirm stop ends / corners / outlets already on separate bill items before adding more.");
      }
      labour.push({
        role: "Roofer / plumber labour",
        hoursPerUnit: 0.15,
        unitBasis: "m",
        hours: round2(qty * 0.15),
        costRate: 38,
        notes: "Install gutters at ~0.15 hrs per metre including clips and joints.",
      });
    } else if (/(downpipe|rainwater pipe|rwp)/i.test(haystack) && unit === "m" && qty > 0) {
      ancillaries.push({
        description: "Downpipe pipe clips / brackets",
        quantity: Math.max(2, Math.ceil(qty / 1.8)),
        unit: "Nr",
        unitCost: 0,
        supplierRequired: true,
        rationale: `~1 bracket per 1.8m on ${qty}m downpipe (check storey heights on elevation).`,
      });
      labour.push({
        role: "Roofer / plumber labour",
        hoursPerUnit: 0.2,
        unitBasis: "m",
        hours: round2(qty * 0.2),
        costRate: 38,
        notes: "Fix downpipes at ~0.2 hrs per metre including brackets.",
      });
    } else if (/(sheet lead|code 5|valley|sideslip|flashing)/i.test(haystack) && unit === "m" && qty > 0) {
      ancillaries.push({
        description: "Lead clips / soakers / sealant allowance",
        quantity: Math.max(1, Math.ceil(qty / 2)),
        unit: "Nr",
        unitCost: 0,
        supplierRequired: true,
        rationale: "Ancillary fixings for sheet lead — do not restate lead length.",
      });
      labour.push({
        role: "Roof plumber labour",
        hoursPerUnit: 0.75,
        unitBasis: "m",
        hours: round2(qty * 0.75),
        costRate: 42,
        notes: "Dress and fix sheet lead at ~0.75 hrs per metre.",
      });
    } else if (/(pipe|copper|flow and return|manifold)/i.test(haystack) && unit === "m" && qty > 0) {
      ancillaries.push({
        description: "Pipe clips / brackets",
        quantity: Math.max(2, Math.ceil(qty / 1.2)),
        unit: "Nr",
        unitCost: 0,
        supplierRequired: true,
        rationale: `Clips for ${qty}m pipework — spacing from drawing/spec.`,
      });
      labour.push({
        role: "Engineer labour",
        hoursPerUnit: 0.25,
        unitBasis: "m",
        hours: round2(qty * 0.25),
        costRate: 38,
        notes: "Install pipework at ~0.25 hrs per metre including clips and joints.",
      });
    } else if (unit === "Nr" && qty > 0 && /(fit and fix|supply and install|install)/i.test(haystack)) {
      const hoursPer = /(shower|bath|wc|basin|jacuzzi)/i.test(haystack) ? 1.5 : 0.75;
      labour.push({
        role: "Engineer labour",
        hoursPerUnit: hoursPer,
        unitBasis: "Nr",
        hours: round2(qty * hoursPer),
        costRate: 38,
        notes: `Install allowance ${hoursPer} hrs each for ${qty} Nr — confirm against drawing complexity.`,
      });
      drawingNotes.push("Check drawing for isolation valves, wastes and traps already billed separately.");
    } else if (unit === "sum" || /prime cost|allow for|testing|protecting|design and install/i.test(haystack)) {
      labour.push({
        role: "Engineer labour",
        hoursPerUnit: 1,
        unitBasis: "sum",
        hours: /testing|protecting|profit/i.test(haystack) ? 2 : 8,
        costRate: 38,
        notes: "Sum item — set man-hours after drawing review; starter allowance only.",
      });
      drawingNotes.push("Sum/PC items need drawing + spec review before firm hours.");
    } else if (qty > 0) {
      labour.push({
        role: "Engineer labour",
        hoursPerUnit: unit === "m" ? 0.2 : 0.5,
        unitBasis: unit,
        hours: round2(qty * (unit === "m" ? 0.2 : 0.5)),
        costRate: 38,
        notes: `Starter labour rate against ${qty} ${unit} — refine from drawing.`,
      });
    }

    return {
      parentMaterialId: line.id,
      parentDescription: line.description,
      parentQuantity: line.quantity,
      parentUnit: line.unit,
      section: line.section,
      ancillaries,
      labour,
      drawingNotes,
      skippedRestate: true,
    };
  });

  const withSuggestions = reviews.filter((review) => review.ancillaries.length || review.labour.length);
  return {
    summary: `Blake reviewed ${billLines.length} bill line(s) and drafted ancillaries/labour for ${withSuggestions.length}. Parent bill quantities were not restated.`,
    confidence: "Medium",
    reviews,
    questions: [
      "Confirm clip/bracket spacing against the elevation and plan.",
      "Confirm whether stop ends, outlets and bends are already separate bill items.",
      "Adjust hours/metre where access or height makes the work slower.",
    ],
  };
}

export function blakeReviewsToAllowances(
  projectId: string,
  draft: BlakeBoqReviewDraft,
  options?: { includeParentIds?: string[] },
): { materials: TakeoffMaterialAllowance[]; labour: TakeoffLabourAllowance[] } {
  const include = options?.includeParentIds?.length
    ? new Set(options.includeParentIds)
    : null;
  const materials: TakeoffMaterialAllowance[] = [];
  const labour: TakeoffLabourAllowance[] = [];

  draft.reviews.forEach((review, reviewIndex) => {
    if (include && !include.has(review.parentMaterialId)) return;

    review.ancillaries.forEach((item, index) => {
      materials.push({
        id: `blake-ancillary-${projectId}-${review.parentMaterialId}-${index}`,
        section: review.section || "Blake ancillaries",
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unitCost,
        markupPercent: 30,
        supplierRequired: item.supplierRequired,
        preferredSupplier: "",
        parentMaterialId: review.parentMaterialId,
        blakeNote: item.rationale,
      });
    });

    review.labour.forEach((item, index) => {
      labour.push({
        id: `blake-labour-${projectId}-${review.parentMaterialId}-${index}`,
        section: review.section || "Installation",
        role: item.role,
        hours: item.hours,
        costRate: item.costRate,
        markupPercent: 45,
        notes: [
          item.notes,
          item.hoursPerUnit > 0 ? `${item.hoursPerUnit} hrs/${item.unitBasis}` : "",
          `Linked to: ${review.parentDescription}`,
        ].filter(Boolean).join(" · "),
        linkedMaterialId: review.parentMaterialId,
        hoursPerUnit: item.hoursPerUnit,
        unitBasis: item.unitBasis,
      });
    });
  });

  return { materials, labour };
}

export function mergeBlakeBoqSuggestions(
  project: TakeoffProject,
  materials: TakeoffMaterialAllowance[],
  labour: TakeoffLabourAllowance[],
  parentIds: string[],
): Pick<TakeoffProject, "materialAllowances" | "labourAllowances" | "review"> {
  const parentSet = new Set(parentIds);
  const keptMaterials = project.materialAllowances.filter((line) => {
    if (!line.parentMaterialId) return true;
    if (!line.id.startsWith("blake-ancillary-")) return true;
    return !parentSet.has(line.parentMaterialId);
  });
  const keptLabour = project.labourAllowances.filter((line) => {
    if (!line.linkedMaterialId || !line.id.startsWith("blake-labour-")) return true;
    return !parentSet.has(line.linkedMaterialId);
  });

  return {
    materialAllowances: [...keptMaterials, ...materials],
    labourAllowances: [...keptLabour, ...labour],
    review: {
      ...project.review,
      riskFlags: Array.from(new Set([
        ...project.review.riskFlags,
        "Blake BOQ review added ancillaries and labour — confirm against drawings before quote",
      ])),
      officeNotes: project.review.officeNotes || "Blake reviewed bill items for ancillaries and man-hours.",
    },
  };
}

export function billMaterialsForBlakeReview(project: TakeoffProject) {
  return project.materialAllowances.filter((line) => !line.parentMaterialId);
}

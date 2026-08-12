/**
 * Blake route & equipment proposer (v1).
 * Place plant answers → proposed heating plant pins + stub routes on the sheet/BOQ.
 */

import { manhattanRoute } from "@/lib/heat-design/layout";
import {
  ensureServiceClassifications,
  isAiStudioGeometry,
  studioId,
  type StudioGeometry,
  type StudioPoint,
  type StudioState,
} from "@/lib/takeoff-studio";
import {
  appendLinearWithAutoFittings,
  pipeSpecById,
  DEFAULT_STUDIO_PIPE_SPEC_ID,
} from "@/lib/takeoff-studio-pipe";

export type BlakePlantKind = "boiler" | "ashp";
export type BlakeEmitterMode = "radiators" | "ufh" | "mixed";

export type BlakeProposeAnswers = {
  plantKind: BlakePlantKind;
  emitterMode: BlakeEmitterMode;
  includeCylinder: boolean;
};

export type BlakeProposeRequest = BlakeProposeAnswers & {
  documentId: string;
  page: number;
  pageWidth: number;
  pageHeight: number;
  /** Plant location in studio page pixels. Defaults near bottom-centre of page. */
  plantPoint?: StudioPoint;
  /** Optional AI / measured emitter targets (overrides stub fan-out). */
  emitterPoints?: StudioPoint[];
  pipeSpecId?: string;
  replaceExistingProposal?: boolean;
  /** Prefixed onto summary when live AI guided placement. */
  aiNarrative?: string;
  aiQuestions?: string[];
};

export type BlakeProposeResult = {
  studio: StudioState;
  summary: string;
  equipment: string[];
  routeCount: number;
  questions: string[];
};

export const PLANT_CLASS_DEFS = [
  {
    id: "cls-ai-P-BOILER",
    kind: "count" as const,
    name: "Boiler",
    colour: "#c2410c",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Gas / system / combi boiler",
  },
  {
    id: "cls-ai-P-ASHP",
    kind: "count" as const,
    name: "ASHP",
    colour: "#0f766e",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Air source heat pump",
  },
  {
    id: "cls-ai-P-CYL",
    kind: "count" as const,
    name: "Cylinder",
    colour: "#1d4ed8",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Hot water cylinder",
  },
  {
    id: "cls-ai-P-MANIFOLD",
    kind: "count" as const,
    name: "UFH manifold",
    colour: "#7c3aed",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Underfloor heating manifold",
  },
  {
    id: "cls-ai-P-RAD",
    kind: "count" as const,
    name: "Radiator",
    colour: "#b45309",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Radiator / emitter",
  },
  // Boiler / plant ancillaries — same heating layer so they sit in Draw as with the plant pins
  {
    id: "cls-count-flue-terminal",
    kind: "count" as const,
    name: "Flue terminal",
    colour: "#9a3412",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Flue terminal / plume kit",
  },
  {
    id: "cls-count-condensate-pump",
    kind: "count" as const,
    name: "Condensate pump",
    colour: "#57534e",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Condensate lift pump",
  },
  {
    id: "cls-count-condensate-trap",
    kind: "count" as const,
    name: "Condensate trap",
    colour: "#44403c",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Condensate trap / neutraliser",
  },
  {
    id: "cls-count-boiler-gas-cock",
    kind: "count" as const,
    name: "Boiler gas cock",
    colour: "#ca8a04",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Appliance gas isolation",
  },
  {
    id: "cls-count-boiler-isolation",
    kind: "count" as const,
    name: "Boiler isolation set",
    colour: "#bf4f14",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Flow / return isolation pair",
  },
  {
    id: "cls-count-prv-discharge",
    kind: "count" as const,
    name: "PRV discharge / tundish",
    colour: "#a16207",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "PRV discharge via tundish",
  },
  {
    id: "cls-count-outdoor-sensor",
    kind: "count" as const,
    name: "Outdoor sensor",
    colour: "#0e7490",
    unit: "nr" as const,
    layer: "heating" as const,
    notes: "Weather compensation sensor",
  },
];

const PROPOSE_NOTE = "proposed · Blake route & equipment proposer";

export function isBlakeProposalGeometry(geo: StudioGeometry): boolean {
  return geo.id.startsWith("ai-propose-");
}

export function ensurePlantClassifications(studio: StudioState): StudioState {
  const base = ensureServiceClassifications(studio);
  const classifications = [...base.classifications];
  let changed = false;
  for (const def of PLANT_CLASS_DEFS) {
    if (classifications.some((cls) => cls.id === def.id)) continue;
    classifications.push({ ...def });
    changed = true;
  }
  if (!changed) return base;
  return { ...base, classifications, updatedAt: new Date().toISOString() };
}

function defaultPlantPoint(pageWidth: number, pageHeight: number): StudioPoint {
  return {
    x: Math.max(40, pageWidth * 0.22),
    y: Math.max(40, pageHeight * 0.72),
  };
}

function stripExistingProposal(studio: StudioState): StudioState {
  const removedIds = new Set(
    studio.geometries.filter((geo) => isBlakeProposalGeometry(geo)).map((geo) => geo.id),
  );
  return {
    ...studio,
    geometries: studio.geometries.filter((geo) => {
      if (isBlakeProposalGeometry(geo)) return false;
      if (geo.kind === "count" && geo.autoGenerated && geo.linkedLinearId && removedIds.has(geo.linkedLinearId)) {
        return false;
      }
      return true;
    }),
    updatedAt: new Date().toISOString(),
  };
}

function plantLabel(kind: BlakePlantKind) {
  return kind === "ashp" ? "ASHP" : "Boiler";
}

function plantClassId(kind: BlakePlantKind) {
  return kind === "ashp" ? "cls-ai-P-ASHP" : "cls-ai-P-BOILER";
}

function pushCount(
  geometries: StudioGeometry[],
  input: {
    classId: string;
    point: StudioPoint;
    documentId: string;
    page: number;
    label: string;
  },
) {
  geometries.push({
    id: `ai-propose-plant-${studioId("pin")}`,
    classificationId: input.classId,
    kind: "count",
    documentId: input.documentId,
    page: input.page,
    point: { ...input.point },
    source: "ai",
    reviewStatus: "pending",
    notes: `${PROPOSE_NOTE} · ${input.label}`,
    sourceText: input.label,
  });
}

function buildStubTargets(
  plant: StudioPoint,
  mode: BlakeEmitterMode,
  pageWidth: number,
  pageHeight: number,
): StudioPoint[] {
  const clamp = (p: StudioPoint): StudioPoint => ({
    x: Math.min(pageWidth - 24, Math.max(24, p.x)),
    y: Math.min(pageHeight - 24, Math.max(24, p.y)),
  });
  if (mode === "ufh") {
    return [
      clamp({ x: plant.x + pageWidth * 0.28, y: plant.y - pageHeight * 0.18 }),
      clamp({ x: plant.x + pageWidth * 0.42, y: plant.y - pageHeight * 0.08 }),
      clamp({ x: plant.x + pageWidth * 0.35, y: plant.y + pageHeight * 0.05 }),
    ];
  }
  if (mode === "mixed") {
    return [
      clamp({ x: plant.x + pageWidth * 0.25, y: plant.y - pageHeight * 0.22 }),
      clamp({ x: plant.x + pageWidth * 0.4, y: plant.y - pageHeight * 0.1 }),
      clamp({ x: plant.x + pageWidth * 0.18, y: plant.y - pageHeight * 0.05 }),
      clamp({ x: plant.x + pageWidth * 0.38, y: plant.y + pageHeight * 0.08 }),
    ];
  }
  return [
    clamp({ x: plant.x + pageWidth * 0.22, y: plant.y - pageHeight * 0.2 }),
    clamp({ x: plant.x + pageWidth * 0.38, y: plant.y - pageHeight * 0.12 }),
    clamp({ x: plant.x + pageWidth * 0.3, y: plant.y + pageHeight * 0.06 }),
    clamp({ x: plant.x + pageWidth * 0.48, y: plant.y - pageHeight * 0.02 }),
  ];
}

function followUpQuestions(answers: BlakeProposeAnswers): string[] {
  const qs: string[] = [];
  if (answers.emitterMode === "radiators" || answers.emitterMode === "mixed") {
    qs.push("How many radiators (or which rooms) should Blake size next?");
  }
  if (answers.emitterMode === "ufh" || answers.emitterMode === "mixed") {
    qs.push("Which rooms are UFH vs radiators, and roughly what floor area?");
  }
  if (answers.plantKind === "ashp") {
    qs.push("Is the ASHP outdoor unit position fixed, and do you need a buffer vessel?");
  } else {
    qs.push("Combi, system, or regular boiler — and is flue position constrained?");
  }
  if (answers.includeCylinder) {
    qs.push("Cylinder capacity (e.g. 150 / 210 / 250 L) and unvented vs thermal store?");
  }
  qs.push("Confirm scale on the sheet so proposed metres are quote-ready.");
  return qs;
}

/** Apply a thin Blake proposal onto studio geometries (plant + stub routes + kits). */
export function applyBlakeProposal(studio: StudioState, request: BlakeProposeRequest): BlakeProposeResult {
  let next = ensurePlantClassifications(studio);
  if (request.replaceExistingProposal !== false) {
    next = stripExistingProposal(next);
  }

  const plant = request.plantPoint || defaultPlantPoint(request.pageWidth, request.pageHeight);
  const includeManifold = request.emitterMode === "ufh" || request.emitterMode === "mixed";
  const equipment: string[] = [plantLabel(request.plantKind)];
  const geometries = [...next.geometries];

  pushCount(geometries, {
    classId: plantClassId(request.plantKind),
    point: plant,
    documentId: request.documentId,
    page: request.page,
    label: plantLabel(request.plantKind),
  });

  let hub = { ...plant };
  if (request.includeCylinder) {
    const cylinderPoint = {
      x: Math.min(request.pageWidth - 24, plant.x + 70),
      y: Math.max(24, plant.y - 40),
    };
    pushCount(geometries, {
      classId: "cls-ai-P-CYL",
      point: cylinderPoint,
      documentId: request.documentId,
      page: request.page,
      label: "Cylinder",
    });
    equipment.push("Cylinder");
    hub = cylinderPoint;
  }

  if (includeManifold) {
    const manifoldPoint = {
      x: Math.min(request.pageWidth - 24, hub.x + 90),
      y: Math.max(24, hub.y - 20),
    };
    pushCount(geometries, {
      classId: "cls-ai-P-MANIFOLD",
      point: manifoldPoint,
      documentId: request.documentId,
      page: request.page,
      label: "UFH manifold",
    });
    equipment.push("UFH manifold");
    hub = manifoldPoint;
  }

  const targets =
    request.emitterPoints?.length
      ? request.emitterPoints.map((point) => ({
          x: Math.min(request.pageWidth - 24, Math.max(24, point.x)),
          y: Math.min(request.pageHeight - 24, Math.max(24, point.y)),
        }))
      : buildStubTargets(hub, request.emitterMode, request.pageWidth, request.pageHeight);
  if (request.emitterMode === "radiators" || request.emitterMode === "mixed") {
    for (const [index, target] of targets.entries()) {
      if (request.emitterMode === "mixed" && index >= 2) break;
      pushCount(geometries, {
        classId: "cls-ai-P-RAD",
        point: target,
        documentId: request.documentId,
        page: request.page,
        label: `Radiator ${index + 1}`,
      });
    }
    equipment.push(
      request.emitterMode === "mixed"
        ? `${Math.min(2, targets.length)} radiator placeholders`
        : `${targets.length} radiator placeholders`,
    );
  }

  next = {
    ...next,
    geometries,
    activeDocumentId: request.documentId,
    activePage: request.page,
    activeLayerId: "heating",
    activeClassificationId: plantClassId(request.plantKind),
    tool: "select",
    updatedAt: new Date().toISOString(),
  };

  const heatingSpec = pipeSpecById(request.pipeSpecId || next.activePipeSpecId || DEFAULT_STUDIO_PIPE_SPEC_ID);
  const dhwSpec = pipeSpecById("cu-22");
  let routeCount = 0;

  const addRoute = (
    classId: string,
    points: StudioPoint[],
    label: string,
    spec: { id: string; material: string; diameter: string; stockLengthM: number },
  ) => {
    if (points.length < 2) return;
    const linear: Extract<StudioGeometry, { kind: "linear" }> = {
      id: `ai-propose-pipe-${studioId("run")}`,
      classificationId: classId,
      kind: "linear",
      documentId: request.documentId,
      page: request.page,
      points,
      source: "ai",
      reviewStatus: "pending",
      notes: `${PROPOSE_NOTE} · ${label}`,
      material: spec.material,
      diameter: spec.diameter,
      stockLengthM: spec.stockLengthM,
      pipeSpecId: spec.id,
    };
    next = appendLinearWithAutoFittings(next, linear);
    routeCount += 1;
  };

  // Plant → cylinder / manifold primary links
  if (request.includeCylinder) {
    const cyl = next.geometries.find(
      (geo) => geo.kind === "count" && geo.classificationId === "cls-ai-P-CYL" && isBlakeProposalGeometry(geo),
    );
    if (cyl && cyl.kind === "count") {
      addRoute(
        "cls-ai-P-PIPE-H",
        manhattanRoute(plant, cyl.point, true),
        "DHW primary / flow to cylinder",
        dhwSpec,
      );
      addRoute(
        "cls-ai-P-PIPE-C",
        manhattanRoute(plant, { x: cyl.point.x - 18, y: cyl.point.y + 18 }, false),
        "Cold feed toward cylinder",
        dhwSpec,
      );
    }
  }

  const radTargets = targets.filter((_, index) =>
    request.emitterMode === "mixed" ? index < 2 : request.emitterMode === "radiators",
  );
  const ufhTargets = request.emitterMode === "ufh"
    ? targets
    : request.emitterMode === "mixed"
      ? targets.slice(2)
      : [];

  for (const [index, target] of radTargets.entries()) {
    addRoute(
      "cls-linear-heating-flow",
      manhattanRoute(hub, target, index % 2 === 0),
      `Heating flow stub ${index + 1}`,
      heatingSpec,
    );
    addRoute(
      "cls-linear-heating-return",
      manhattanRoute(
        { x: target.x + 14, y: target.y + 14 },
        { x: hub.x + 12, y: hub.y + 12 },
        index % 2 === 1,
      ),
      `Heating return stub ${index + 1}`,
      heatingSpec,
    );
  }

  for (const [index, target] of ufhTargets.entries()) {
    addRoute(
      "cls-linear-ufh",
      manhattanRoute(hub, target, index % 2 === 0),
      `UFH loop stub ${index + 1}`,
      heatingSpec,
    );
  }

  const modeLabel =
    request.emitterMode === "ufh"
      ? "UFH"
      : request.emitterMode === "mixed"
        ? "mixed rads + UFH"
        : "radiators";
  const baseSummary = `Proposed ${plantLabel(request.plantKind)} layout · ${modeLabel} · ${routeCount} route stub(s) · ${equipment.join(", ")}. Edit on sheet — BOQ updates live.`;
  const summary = request.aiNarrative?.trim()
    ? `${request.aiNarrative.trim()} · ${routeCount} route stub(s).`
    : baseSummary;
  const questions = [
    ...(request.aiQuestions || []),
    ...followUpQuestions(request),
  ].filter((q, index, all) => q && all.indexOf(q) === index).slice(0, 10);

  return {
    studio: next,
    summary,
    equipment,
    routeCount,
    questions,
  };
}

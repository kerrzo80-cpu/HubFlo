/**
 * Heat Design layout → Takeoff Studio (sized pipes + plant pins + fittings).
 */

import {
  ensurePlantClassifications,
  PLANT_CLASS_DEFS,
} from "@/lib/takeoff-blake-propose";
import {
  createDefaultStudioState,
  ensureServiceClassifications,
  studioId,
  type StudioGeometry,
  type StudioState,
} from "@/lib/takeoff-studio";
import { appendLinearWithAutoFittings } from "@/lib/takeoff-studio-pipe";

import { applyBlakePipeSizing, summariseHeatingFittings } from "./blake-route";
import type {
  HeatDesignProject,
  HeatingPlantKind,
  HeatingPipeKind,
  HeatingSystemLayout,
} from "./types";

export const HEAT_DESIGN_PLAN_DOC_ID = "heat-design-plan";

/** 1 m on plan = 100 studio units so takeoff bend/coupling math stays stable. */
export const HEAT_DESIGN_M_TO_UNITS = 100;

function classForPipeKind(kind: HeatingPipeKind): string {
  switch (kind) {
    case "flow":
      return "cls-linear-heating-flow";
    case "return":
      return "cls-linear-heating-return";
    case "dhw":
      return "cls-ai-P-PIPE-H";
    case "gas":
      return "cls-linear-gas";
    case "primary":
    case "refrigerant":
    case "oil":
    default:
      return "cls-linear-heating-flow";
  }
}

function classForPlant(kind: HeatingPlantKind): string | null {
  if (kind === "boiler" || kind === "electric_boiler") return "cls-ai-P-BOILER";
  if (kind === "outdoor_unit") return "cls-ai-P-ASHP";
  if (kind === "cylinder" || kind === "buffer") return "cls-ai-P-CYL";
  if (kind === "manifold") return "cls-ai-P-MANIFOLD";
  return null;
}

function toStudioPoint(xM: number, yM: number) {
  return { x: xM * HEAT_DESIGN_M_TO_UNITS, y: yM * HEAT_DESIGN_M_TO_UNITS };
}

export function heatingLayoutToStudio(
  layout: HeatingSystemLayout,
  options: { projectName?: string } = {},
): { studio: StudioState; fittings: ReturnType<typeof summariseHeatingFittings> } {
  const sized = applyBlakePipeSizing(layout);
  const fittings = summariseHeatingFittings(sized);
  let studio = ensurePlantClassifications(ensureServiceClassifications(createDefaultStudioState()));

  studio = {
    ...studio,
    activeDocumentId: HEAT_DESIGN_PLAN_DOC_ID,
    activePage: 1,
    activeLayerId: "heating",
    tool: "select",
    scales: [
      {
        documentId: HEAT_DESIGN_PLAN_DOC_ID,
        page: 1,
        metresPerUnit: 1 / HEAT_DESIGN_M_TO_UNITS,
        label: "Heat design plan (m)",
      },
    ],
    geometries: [],
    updatedAt: new Date().toISOString(),
  };

  // Ensure plant class names exist even if ensurePlant was a no-op on empty merge.
  for (const def of PLANT_CLASS_DEFS) {
    if (!studio.classifications.some((cls) => cls.id === def.id)) {
      studio = {
        ...studio,
        classifications: [...studio.classifications, { ...def }],
      };
    }
  }

  const plantGeometries: StudioGeometry[] = [];
  for (const plant of sized.plants) {
    const classId = classForPlant(plant.kind);
    if (!classId) continue;
    plantGeometries.push({
      id: `ai-propose-plant-${studioId("hd")}`,
      classificationId: classId,
      kind: "count",
      documentId: HEAT_DESIGN_PLAN_DOC_ID,
      page: 1,
      point: toStudioPoint(plant.x, plant.y),
      source: "ai",
      notes: `proposed · Heat Design · ${plant.label}`,
      sourceText: plant.label,
    });
  }

  for (const emitter of sized.emitters) {
    if (emitter.kind !== "radiator") continue;
    plantGeometries.push({
      id: `ai-propose-plant-${studioId("rad")}`,
      classificationId: "cls-ai-P-RAD",
      kind: "count",
      documentId: HEAT_DESIGN_PLAN_DOC_ID,
      page: 1,
      point: toStudioPoint(emitter.x, emitter.y),
      source: "ai",
      notes: `proposed · Heat Design · ${emitter.label}`,
      sourceText: emitter.label,
    });
  }

  studio = { ...studio, geometries: [...plantGeometries] };

  for (const pipe of sized.pipes) {
    if (pipe.points.length < 2) continue;
    const linear: Extract<StudioGeometry, { kind: "linear" }> = {
      id: `ai-propose-pipe-${studioId("hd")}`,
      classificationId: classForPipeKind(pipe.kind),
      kind: "linear",
      documentId: HEAT_DESIGN_PLAN_DOC_ID,
      page: 1,
      points: pipe.points.map((point) => toStudioPoint(point.x, point.y)),
      source: "ai",
      notes: `proposed · Heat Design · ${pipe.label} · ${pipe.diameterMm || 22}mm`,
      material: pipe.material || "Copper",
      diameter: `${pipe.diameterMm || 22}mm`,
      stockLengthM: 3,
      pipeSpecId: pipe.pipeSpecId || "cu-22",
    };
    studio = appendLinearWithAutoFittings(studio, linear);
  }

  void options.projectName;
  return { studio, fittings };
}

export function reducerMaterialAllowances(
  fittings: ReturnType<typeof summariseHeatingFittings>,
  projectId: string,
) {
  return fittings.reducers.map((row) => ({
    id: `studio-mat-${projectId}-reducer-${row.fromMm}-${row.toMm}`,
    section: "Fittings",
    description: `Takeoff · ${row.fromMm}×${row.toMm} mm copper reducer`,
    quantity: row.count,
    unit: "nr",
    unitCost: row.fromMm === 28 && row.toMm === 15 ? 4.5 : 3.2,
    markupPercent: 0,
    supplierRequired: false,
  }));
}

export function heatDesignTakeoffDescription(project: HeatDesignProject, fittings: ReturnType<typeof summariseHeatingFittings>) {
  return [
    `Heat Design → Takeoff · ${project.name}`,
    project.chosenSystemId ? `System: ${project.chosenSystemId}` : null,
    `Emitters: ${project.emitterMode || project.heatingLayout?.emitterMode || "radiators"}`,
    `Pipework ≈ ${fittings.totalMetres} m · ${fittings.totalElbows} elbows · ${fittings.totalCouplings} couplings · ${fittings.totalReducers} reducers`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Studio pipe sizes + auto elbows / stock-length couplings. */

import {
  classificationLayer,
  listStudioLayers,
  polygonArea,
  polylineLength,
  scaleForPage,
  studioId,
  STUDIO_SERVICE_LAYERS,
  type StudioGeometry,
  type StudioPoint,
  type StudioServiceLayerId,
  type StudioState,
} from "@/lib/takeoff-studio";

export type StudioPipeSpec = {
  id: string;
  label: string;
  material: string;
  diameter: string;
  /** Straight stick length for coupling spacing (copper default 3 m). */
  stockLengthM: number;
  autoElbows: boolean;
  autoCouplings: boolean;
};

export const STUDIO_PIPE_SPECS: StudioPipeSpec[] = [
  { id: "cu-15", label: "15 Cu", material: "Copper", diameter: "15mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "cu-22", label: "22 Cu", material: "Copper", diameter: "22mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "cu-28", label: "28 Cu", material: "Copper", diameter: "28mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "cu-35", label: "35 Cu", material: "Copper", diameter: "35mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "hep-15", label: "15 Hep", material: "Hep2O", diameter: "15mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "hep-22", label: "22 Hep", material: "Hep2O", diameter: "22mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "hep-28", label: "28 Hep", material: "Hep2O", diameter: "28mm", stockLengthM: 3, autoElbows: true, autoCouplings: true },
  { id: "waste-32", label: "32 waste", material: "Waste pipe", diameter: "32mm", stockLengthM: 3, autoElbows: true, autoCouplings: false },
  { id: "waste-40", label: "40 waste", material: "Waste pipe", diameter: "40mm", stockLengthM: 3, autoElbows: true, autoCouplings: false },
  { id: "waste-50", label: "50 waste", material: "Waste pipe", diameter: "50mm", stockLengthM: 3, autoElbows: true, autoCouplings: false },
  { id: "soil-110", label: "110 soil", material: "Soil pipe", diameter: "110mm", stockLengthM: 3, autoElbows: true, autoCouplings: false },
];

export const DEFAULT_STUDIO_PIPE_SPEC_ID = "cu-22";

export const FITTING_ELBOW_CLASS_ID = "cls-fit-90-elbow";
export const FITTING_COUPLING_CLASS_ID = "cls-fit-coupling";

export function pipeSpecById(id?: string | null): StudioPipeSpec {
  return STUDIO_PIPE_SPECS.find((spec) => spec.id === id) || STUDIO_PIPE_SPECS.find((spec) => spec.id === DEFAULT_STUDIO_PIPE_SPEC_ID)!;
}

export function ensureFittingClassifications(studio: StudioState): StudioState {
  const classifications = [...studio.classifications];
  let changed = false;
  const defs = [
    { id: FITTING_ELBOW_CLASS_ID, name: "90° elbows", colour: "#5b6b7a" },
    { id: FITTING_COUPLING_CLASS_ID, name: "Couplings", colour: "#8a9aa5" },
  ] as const;
  for (const def of defs) {
    if (!classifications.some((cls) => cls.id === def.id)) {
      classifications.push({
        id: def.id,
        kind: "count",
        name: def.name,
        colour: def.colour,
        unit: "nr",
        layer: "general",
        notes: "Auto fittings from pipe runs",
      });
      changed = true;
    }
  }
  return changed ? { ...studio, classifications, updatedAt: new Date().toISOString() } : studio;
}

/**
 * Bends that count as 90° elbows.
 * Mobile finger taps are rarely perfect — accept ~55–125° and short corner legs.
 */
export function isRightAngleBend(previous: StudioPoint, bend: StudioPoint, next: StudioPoint) {
  const firstX = previous.x - bend.x;
  const firstY = previous.y - bend.y;
  const secondX = next.x - bend.x;
  const secondY = next.y - bend.y;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);
  if (firstLength < 4 || secondLength < 4) return false;
  const cosine = Math.abs((firstX * secondX + firstY * secondY) / (firstLength * secondLength));
  // cos(55°) ≈ 0.57 — still rejects shallow wiggles / near-straight taps
  return cosine <= 0.55;
}

/** Live estimate while Length draft is open (before Done run). */
export function previewFittingsForDraft(
  points: StudioPoint[],
  options: { metresPerUnit?: number; stockLengthM?: number; autoElbows?: boolean; autoCouplings?: boolean } = {},
): { elbows: number; couplings: number; metres: number | null } {
  const metresPerUnit = options.metresPerUnit || 0;
  const metres = metresPerUnit > 0 ? polylineLength(points) * metresPerUnit : null;
  const elbows = options.autoElbows === false ? 0 : elbowPointsAlongRun(points).length;
  const couplings =
    options.autoCouplings === false || !(metresPerUnit > 0)
      ? 0
      : couplingPointsAlongRun(points, metresPerUnit, options.stockLengthM || 3).length;
  return { elbows, couplings, metres };
}

export function elbowPointsAlongRun(points: StudioPoint[]): StudioPoint[] {
  if (points.length < 3) return [];
  const elbows: StudioPoint[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const bend = points[index];
    const next = points[index + 1];
    if (!previous || !bend || !next) continue;
    if (isRightAngleBend(previous, bend, next)) elbows.push({ ...bend });
  }
  return elbows;
}

export function pointAtDistanceAlongRun(points: StudioPoint[], targetUnits: number): StudioPoint | null {
  if (points.length < 2 || targetUnits <= 0) return null;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (segment <= 0) continue;
    if (travelled + segment >= targetUnits) {
      const t = (targetUnits - travelled) / segment;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    travelled += segment;
  }
  return null;
}

export function couplingPointsAlongRun(
  points: StudioPoint[],
  metresPerUnit: number,
  stockLengthM = 3,
): StudioPoint[] {
  if (!(metresPerUnit > 0) || points.length < 2) return [];
  const lengthM = polylineLength(points) * metresPerUnit;
  const stock = Math.max(1, stockLengthM);
  const count = Math.max(0, Math.ceil(Math.max(0, lengthM - 0.001) / stock) - 1);
  if (!count) return [];
  const unitsPerMetre = 1 / metresPerUnit;
  const couplings: StudioPoint[] = [];
  for (let index = 1; index <= count; index += 1) {
    const point = pointAtDistanceAlongRun(points, index * stock * unitsPerMetre);
    if (point) couplings.push(point);
  }
  return couplings;
}

export type StudioFittingKind = "90-elbow" | "coupling";

export function buildAutoFittingsForLinear(
  studio: StudioState,
  linear: Extract<StudioGeometry, { kind: "linear" }>,
): StudioGeometry[] {
  const material = (linear.material || "").toLowerCase();
  const diameter = (linear.diameter || "").toLowerCase();
  if (!material || diameter === "tbc") return [];

  const spec = STUDIO_PIPE_SPECS.find(
    (row) => row.material.toLowerCase() === material && row.diameter.toLowerCase() === diameter,
  );
  const autoElbows = spec?.autoElbows ?? (material.includes("copper") || material.includes("hep"));
  const autoCouplings = spec?.autoCouplings ?? (material.includes("copper") || material.includes("hep"));
  const stockLengthM = linear.stockLengthM || spec?.stockLengthM || 3;

  const fittings: StudioGeometry[] = [];
  if (autoElbows) {
    for (const [index, point] of elbowPointsAlongRun(linear.points).entries()) {
      fittings.push({
        id: `${linear.id}-elbow-${index}`,
        classificationId: FITTING_ELBOW_CLASS_ID,
        kind: "count",
        documentId: linear.documentId,
        page: linear.page,
        point,
        source: "manual",
        sourceText: `${linear.diameter || ""} ${linear.material || ""} 90° elbow`.trim(),
        fittingKind: "90-elbow",
        linkedLinearId: linear.id,
        material: linear.material,
        diameter: linear.diameter,
        autoGenerated: true,
      });
    }
  }

  if (autoCouplings) {
    const scale = scaleForPage(studio, linear.documentId, linear.page);
    const mpu = scale?.metresPerUnit || 0;
    if (mpu > 0) {
      for (const [index, point] of couplingPointsAlongRun(linear.points, mpu, stockLengthM).entries()) {
        fittings.push({
          id: `${linear.id}-coupling-${index}`,
          classificationId: FITTING_COUPLING_CLASS_ID,
          kind: "count",
          documentId: linear.documentId,
          page: linear.page,
          point,
          source: "manual",
          sourceText: `${linear.diameter || ""} ${linear.material || ""} coupling · every ${stockLengthM}m`.trim(),
          fittingKind: "coupling",
          linkedLinearId: linear.id,
          material: linear.material,
          diameter: linear.diameter,
          autoGenerated: true,
        });
      }
    }
  }

  return fittings;
}

/** Finish a pipe run: store size on the linear and regenerate its auto fittings. */
export function appendLinearWithAutoFittings(
  studio: StudioState,
  linear: Extract<StudioGeometry, { kind: "linear" }>,
): StudioState {
  const withClasses = ensureFittingClassifications(studio);
  // Replace same-id linear (vertex edit / re-fit) and drop its old auto fittings.
  const withoutOld = withClasses.geometries.filter(
    (geo) =>
      geo.id !== linear.id
      && !(geo.kind === "count" && geo.autoGenerated && geo.linkedLinearId === linear.id),
  );
  const fittings = buildAutoFittingsForLinear(withClasses, linear);
  return {
    ...withClasses,
    geometries: [...withoutOld, linear, ...fittings],
    updatedAt: new Date().toISOString(),
  };
}

export function removeLinearAndFittings(studio: StudioState, linearId: string): StudioState {
  return {
    ...studio,
    geometries: studio.geometries.filter((geo) => {
      if (geo.id === linearId) return false;
      if (geo.kind === "count" && geo.linkedLinearId === linearId) return false;
      return true;
    }),
    updatedAt: new Date().toISOString(),
  };
}

/** Move/edit a pipe run's vertices and regenerate sized fittings. */
export function updateLinearPointsWithFittings(
  studio: StudioState,
  linearId: string,
  points: StudioPoint[],
  options: { acceptAsManual?: boolean } = {},
): StudioState {
  if (points.length < 2) return studio;
  const existing = studio.geometries.find((geo) => geo.id === linearId && geo.kind === "linear");
  if (!existing || existing.kind !== "linear") return studio;
  const editedNote = "Edited on sheet";
  const nextNotes = options.acceptAsManual
    ? (existing.notes?.includes(editedNote)
      ? existing.notes
      : [existing.notes, editedNote].filter(Boolean).join(" · "))
    : existing.notes;
  const nextLinear: Extract<StudioGeometry, { kind: "linear" }> = {
    ...existing,
    points: points.map((point) => ({ ...point })),
    source: options.acceptAsManual ? "manual" : existing.source,
    notes: nextNotes,
  };
  return appendLinearWithAutoFittings(studio, nextLinear);
}

export type StudioBoqSection = "Pipework" | "Fittings" | "Counts" | "Areas";

export type StudioBoqRow = {
  id: string;
  layerId: StudioServiceLayerId;
  layerLabel: string;
  section: StudioBoqSection;
  description: string;
  quantity: number;
  unit: string;
};

function layerLabelFor(layerId: StudioServiceLayerId, studio?: StudioState) {
  if (studio) {
    const match = listStudioLayers(studio).find((row) => row.id === layerId);
    if (match) return match.label;
  }
  return STUDIO_SERVICE_LAYERS.find((row) => row.id === layerId)?.label || layerId;
}

function layerForGeometry(studio: StudioState, geo: StudioGeometry): StudioServiceLayerId {
  if (geo.kind === "count" && geo.autoGenerated && geo.linkedLinearId) {
    const parent = studio.geometries.find((row) => row.id === geo.linkedLinearId);
    if (parent) {
      const parentCls = studio.classifications.find((row) => row.id === parent.classificationId);
      if (parentCls) return classificationLayer(parentCls);
    }
  }
  const cls = studio.classifications.find((row) => row.id === geo.classificationId);
  return cls ? classificationLayer(cls) : "general";
}

/**
 * Full takeoff BOQ: pipe metres by size/service, fittings by size, plus counts/areas.
 * Pass a service layer to get that layer only; `all` = master total.
 */
export function summariseStudioBoq(
  studio: StudioState,
  layerFilter: StudioServiceLayerId | "all" = "all",
): StudioBoqRow[] {
  type Acc = { description: string; quantity: number; layerId: StudioServiceLayerId; section: StudioBoqSection; unit: string };
  const groups = new Map<string, Acc>();

  const bump = (
    key: string,
    layerId: StudioServiceLayerId,
    section: StudioBoqSection,
    description: string,
    quantity: number,
    unit: string,
  ) => {
    if (!(quantity > 0)) return;
    if (layerFilter !== "all" && layerId !== layerFilter) return;
    const current = groups.get(key) || { description, quantity: 0, layerId, section, unit };
    current.quantity += quantity;
    groups.set(key, current);
  };

  for (const geo of studio.geometries) {
    const layerId = layerForGeometry(studio, geo);
    const scale = scaleForPage(studio, geo.documentId, geo.page);
    const mpu = scale?.metresPerUnit || 0;
    const cls = studio.classifications.find((row) => row.id === geo.classificationId);

    if (geo.kind === "linear") {
      const metres = polylineLength(geo.points) * mpu;
      const sized = Boolean(geo.material || geo.diameter);
      const baseDescription = sized
        ? `${geo.diameter || ""} ${geo.material || "Pipe"} · ${cls?.name || "Pipe run"}`.replace(/\s+/g, " ").trim()
        : (cls?.name || "Pipe run");
      if (metres > 0) {
        const key = `pipe|${layerId}|${geo.material || ""}|${geo.diameter || ""}|${cls?.id || "run"}`;
        bump(key, layerId, "Pipework", baseDescription, metres, "m");
      }
      // Unscaled runs are not BOQ lines (avoids fake "1 run" / "0 run" junk). Call out via countUnscaledStudioLinears.
      continue;
    }

    if (geo.kind === "count" && geo.autoGenerated && geo.fittingKind) {
      const label = geo.fittingKind === "90-elbow" ? "90° elbow" : "Coupling";
      const description = `${geo.diameter || ""} ${geo.material || ""} ${label}`.replace(/\s+/g, " ").trim();
      const key = `fit|${layerId}|${geo.material || ""}|${geo.diameter || ""}|${geo.fittingKind}`;
      bump(key, layerId, "Fittings", description, 1, "nr");
      continue;
    }

    if (geo.kind === "count") {
      const description = cls?.name || "Count";
      const key = `count|${layerId}|${cls?.id || geo.classificationId}`;
      bump(key, layerId, "Counts", description, 1, "nr");
      continue;
    }

    if (geo.kind === "area" && geo.closed) {
      const area = polygonArea(geo.points) * mpu * mpu;
      if (!(area > 0)) continue;
      const description = cls?.name || "Area";
      const key = `area|${layerId}|${cls?.id || geo.classificationId}`;
      bump(key, layerId, "Areas", description, area, "m2");
    }
  }

  const sectionOrder: StudioBoqSection[] = ["Pipework", "Fittings", "Counts", "Areas"];
  return [...groups.entries()]
    .map(([key, row]) => ({
      id: key,
      layerId: row.layerId,
      layerLabel: layerLabelFor(row.layerId, studio),
      section: row.section,
      description: row.description,
      quantity: row.unit === "nr" ? row.quantity : Number(row.quantity.toFixed(2)),
      unit: row.unit,
    }))
    .sort((a, b) => {
      const sectionDiff = sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section);
      if (sectionDiff !== 0) return sectionDiff;
      if (a.layerLabel !== b.layerLabel) return a.layerLabel.localeCompare(b.layerLabel);
      return a.description.localeCompare(b.description);
    });
}

/** Pipework + fittings only (Core push materials). Never includes unscaled placeholder runs. */
export function summariseStudioPipeBoq(studio: StudioState): Array<{
  id: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
}> {
  return summariseStudioBoq(studio, "all")
    .filter((row) => row.section === "Pipework" || row.section === "Fittings")
    .filter((row) => row.unit !== "run" && row.quantity > 0)
    .map((row) => ({
      id: row.id,
      section: row.section,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
    }));
}

/** Linears that exist on the sheet but cannot become metres until scale is set. */
export function countUnscaledStudioLinears(
  studio: StudioState,
  layerFilter: StudioServiceLayerId | "all" = "all",
): number {
  return summariseUnscaledStudioLinears(studio, layerFilter).count;
}

/** Pages/docs that still block metres — for Push warnings. */
export function summariseUnscaledStudioLinears(
  studio: StudioState,
  layerFilter: StudioServiceLayerId | "all" = "all",
): { count: number; pageLabels: string[] } {
  let count = 0;
  const pages = new Map<string, number>();
  for (const geo of studio.geometries) {
    if (geo.kind !== "linear") continue;
    const layerId = layerForGeometry(studio, geo);
    if (layerFilter !== "all" && layerId !== layerFilter) continue;
    const scale = scaleForPage(studio, geo.documentId, geo.page);
    const mpu = scale?.metresPerUnit || 0;
    if (mpu > 0) continue;
    if (polylineLength(geo.points) <= 0) continue;
    count += 1;
    const key = `${geo.documentId}::${geo.page}`;
    pages.set(key, (pages.get(key) || 0) + 1);
  }
  const pageLabels = [...pages.entries()]
    .map(([key, runs]) => {
      const page = key.split("::")[1] || "?";
      return `page ${page} (${runs})`;
    })
    .slice(0, 4);
  return { count, pageLabels };
}

export function createLinearId() {
  return studioId("geo");
}

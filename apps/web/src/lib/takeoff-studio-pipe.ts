/** Studio pipe sizes + auto elbows / stock-length couplings. */

import {
  polylineLength,
  scaleForPage,
  studioId,
  type StudioGeometry,
  type StudioPoint,
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
  const withoutOld = withClasses.geometries.filter(
    (geo) => !(geo.kind === "count" && geo.autoGenerated && geo.linkedLinearId === linear.id),
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

/** BOQ-friendly rows: pipe metres by size + elbows/couplings by size. */
export function summariseStudioPipeBoq(studio: StudioState): Array<{
  id: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
}> {
  const pipeGroups = new Map<string, { description: string; metres: number }>();
  const fitGroups = new Map<string, { description: string; count: number; section: string }>();

  for (const geo of studio.geometries) {
    if (geo.kind === "linear" && (geo.material || geo.diameter)) {
      const scale = scaleForPage(studio, geo.documentId, geo.page);
      const mpu = scale?.metresPerUnit || 0;
      const metres = polylineLength(geo.points) * mpu;
      if (!(metres > 0)) continue;
      const cls = studio.classifications.find((row) => row.id === geo.classificationId);
      const key = `${geo.material || "Pipe"}|${geo.diameter || "Ø?"}|${cls?.name || "run"}`;
      const current = pipeGroups.get(key) || {
        description: `${geo.diameter || ""} ${geo.material || "Pipe"} · ${cls?.name || "Pipe run"}`.replace(/\s+/g, " ").trim(),
        metres: 0,
      };
      current.metres += metres;
      pipeGroups.set(key, current);
      continue;
    }
    if (geo.kind === "count" && geo.autoGenerated && geo.fittingKind) {
      const label = geo.fittingKind === "90-elbow" ? "90° elbow" : "Coupling";
      const key = `${geo.material || ""}|${geo.diameter || ""}|${geo.fittingKind}`;
      const current = fitGroups.get(key) || {
        description: `${geo.diameter || ""} ${geo.material || ""} ${label}`.replace(/\s+/g, " ").trim(),
        count: 0,
        section: "Fittings",
      };
      current.count += 1;
      fitGroups.set(key, current);
    }
  }

  const rows: Array<{ id: string; section: string; description: string; quantity: number; unit: string }> = [];
  for (const [key, row] of pipeGroups) {
    rows.push({
      id: `pipe-${key}`,
      section: "Pipework",
      description: row.description,
      quantity: Number(row.metres.toFixed(2)),
      unit: "m",
    });
  }
  for (const [key, row] of fitGroups) {
    rows.push({
      id: `fit-${key}`,
      section: row.section,
      description: row.description,
      quantity: row.count,
      unit: "nr",
    });
  }
  return rows;
}

export function createLinearId() {
  return studioId("geo");
}

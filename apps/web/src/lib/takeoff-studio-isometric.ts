/**
 * Simple isometric (2.5D) preview of completed Studio Length runs.
 * Plan polylines + rise/drop metres → projected SVG paths (no WebGL).
 */

import {
  polylineLength,
  resolveLinearDrop,
  type StudioGeometry,
  type StudioState,
} from "@/lib/takeoff-studio";
import { dropUnitOffsetsAlongRun, pointAtDistanceAlongRun } from "@/lib/takeoff-studio-pipe";

export type IsoVec3 = { x: number; y: number; z: number };
export type IsoVec2 = { x: number; y: number };

export type IsoRoutePreview = {
  id: string;
  label: string;
  colour: string;
  /** Main run polyline in screen space (open path). */
  planPath: string;
  /** Vertical drop stubs (each a short path). */
  dropPaths: string[];
  metres: number;
  dropCount: number;
  verticalM: number;
};

export type IsoPreviewScene = {
  routes: IsoRoutePreview[];
  viewBox: string;
  width: number;
  height: number;
};

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** Classic isometric projection — X right, Y into page, Z up. */
export function projectIso(point: IsoVec3): IsoVec2 {
  return {
    x: (point.x - point.y) * COS30,
    y: (point.x + point.y) * SIN30 - point.z,
  };
}

function pathFromScreen(points: IsoVec2[]): string {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

function routeLabel(linear: Extract<StudioGeometry, { kind: "linear" }>): string {
  const bits = [linear.diameter, linear.material].filter(Boolean);
  return bits.length ? bits.join(" ") : "Length run";
}

function colourFor(
  studio: StudioState,
  linear: Extract<StudioGeometry, { kind: "linear" }>,
): string {
  return studio.classifications.find((row) => row.id === linear.classificationId)?.colour || "#1998cf";
}

/**
 * Build one isometric route: ceiling-height main run with vertical drops to z=0.
 * Plan units stay in PDF space; vertical uses metres scaled so 1 m ≈ typical plan span style.
 */
export function buildIsoRoute(
  studio: StudioState,
  linear: Extract<StudioGeometry, { kind: "linear" }>,
  metresPerUnit: number,
  metresToPlanUnits: number,
): IsoRoutePreview | null {
  if (linear.points.length < 2) return null;
  const drop = resolveLinearDrop(linear);
  const heightPerDrop = drop.dropHeightM > 0 ? drop.dropHeightM : drop.verticalM;
  const zCeiling = Math.max(0, heightPerDrop) * metresToPlanUnits;
  const planUnits = polylineLength(linear.points);
  const planM = metresPerUnit > 0 ? planUnits * metresPerUnit : 0;
  const metres = planM + drop.verticalM;

  const ceilingPlan: IsoVec3[] = linear.points.map((point) => ({
    x: point.x,
    y: point.y,
    z: zCeiling,
  }));
  const planPath = pathFromScreen(ceilingPlan.map(projectIso));

  const dropPaths: string[] = [];
  const offsets = dropUnitOffsetsAlongRun(planUnits, drop.elbowCount);
  for (const offset of offsets) {
    const at = pointAtDistanceAlongRun(linear.points, offset);
    if (!at) continue;
    const top: IsoVec3 = { x: at.x, y: at.y, z: zCeiling };
    const bottom: IsoVec3 = { x: at.x, y: at.y, z: 0 };
    dropPaths.push(pathFromScreen([projectIso(top), projectIso(bottom)]));
  }

  // Total-override (single elbow, no count) still shows one vertical at the end.
  if (!offsets.length && drop.verticalM > 0) {
    const end = linear.points[linear.points.length - 1]!;
    const top: IsoVec3 = { x: end.x, y: end.y, z: zCeiling || drop.verticalM * metresToPlanUnits };
    const bottom: IsoVec3 = { x: end.x, y: end.y, z: 0 };
    dropPaths.push(pathFromScreen([projectIso(top), projectIso(bottom)]));
  }

  return {
    id: linear.id,
    label: routeLabel(linear),
    colour: colourFor(studio, linear),
    planPath,
    dropPaths,
    metres,
    dropCount: drop.elbowCount,
    verticalM: drop.verticalM,
  };
}

export function buildIsoPreviewScene(
  studio: StudioState,
  options: {
    documentId: string;
    page: number;
    metresPerUnit: number;
    padding?: number;
  },
): IsoPreviewScene | null {
  const linears = studio.geometries.filter(
    (geo): geo is Extract<StudioGeometry, { kind: "linear" }> =>
      geo.kind === "linear" &&
      geo.documentId === options.documentId &&
      geo.page === options.page &&
      geo.points.length >= 2,
  );
  if (!linears.length) return null;

  // Scale 1 metre of vertical to ~8% of the widest plan span (readable stub height).
  let maxSpan = 80;
  for (const linear of linears) {
    const xs = linear.points.map((p) => p.x);
    const ys = linear.points.map((p) => p.y);
    maxSpan = Math.max(maxSpan, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  const metresToPlanUnits =
    options.metresPerUnit > 0 ? 1 / options.metresPerUnit : Math.max(12, maxSpan * 0.08);

  const routes = linears
    .map((linear) => buildIsoRoute(studio, linear, options.metresPerUnit, metresToPlanUnits))
    .filter((row): row is IsoRoutePreview => Boolean(row));
  if (!routes.length) return null;

  const allPoints: IsoVec2[] = [];
  for (const route of routes) {
    for (const token of `${route.planPath} ${route.dropPaths.join(" ")}`.matchAll(/[-\d.]+,[-\d.]+/g)) {
      const [x, y] = token[0]!.split(",").map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) allPoints.push({ x: x!, y: y! });
    }
  }
  if (!allPoints.length) return null;

  const pad = options.padding ?? 24;
  const minX = Math.min(...allPoints.map((p) => p.x)) - pad;
  const minY = Math.min(...allPoints.map((p) => p.y)) - pad;
  const maxX = Math.max(...allPoints.map((p) => p.x)) + pad;
  const maxY = Math.max(...allPoints.map((p) => p.y)) + pad;
  const width = Math.max(120, maxX - minX);
  const height = Math.max(80, maxY - minY);

  return {
    routes,
    viewBox: `${minX.toFixed(2)} ${minY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)}`,
    width,
    height,
  };
}

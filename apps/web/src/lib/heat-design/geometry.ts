import type { HeatDesignRoom, PlanOpening, PlanPoint } from "./types";
import { numberFromInput } from "./calc-number";

export function dist(a: PlanPoint, b: PlanPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polygonArea(points: PlanPoint[]) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonBounds(points: PlanPoint[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function rectPolygon(planX: number, planY: number, length: number, width: number): PlanPoint[] {
  return [
    { x: planX, y: planY },
    { x: planX + length, y: planY },
    { x: planX + length, y: planY + width },
    { x: planX, y: planY + width },
  ];
}

export function roomPolygon(room: HeatDesignRoom): PlanPoint[] {
  if (room.polygon && room.polygon.length >= 3) return room.polygon;
  return rectPolygon(
    room.planX ?? 0,
    room.planY ?? 0,
    numberFromInput(room.length, 3.5),
    numberFromInput(room.width, 3.2),
  );
}

export function roomWallExterior(room: HeatDesignRoom, edgeCount: number): boolean[] {
  if (room.wallExterior && room.wallExterior.length === edgeCount) return room.wallExterior;
  if (room.exteriorFlags && edgeCount === 4) return [...room.exteriorFlags];
  return Array.from({ length: edgeCount }, (_, i) => i < (room.exteriorWalls || 2));
}

export function edgeLengths(points: PlanPoint[]) {
  return points.map((p, i) => dist(p, points[(i + 1) % points.length]!));
}

export function exteriorPerimeter(points: PlanPoint[], exterior: boolean[]) {
  return edgeLengths(points).reduce((sum, len, i) => sum + (exterior[i] ? len : 0), 0);
}

export function syncRoomFromPolygon(room: HeatDesignRoom, polygon: PlanPoint[]): HeatDesignRoom {
  const bounds = polygonBounds(polygon);
  const exterior = roomWallExterior(room, polygon.length);
  // Keep exterior flags aligned to edge count when growing/shrinking
  let wallExterior = exterior;
  if (wallExterior.length !== polygon.length) {
    wallExterior = Array.from({ length: polygon.length }, (_, i) => exterior[i] ?? true);
  }
  const openings = (room.openings ?? [])
    .map((opening) => ({
      ...opening,
      wallIndex: Math.min(opening.wallIndex ?? (opening as { wall?: number }).wall ?? 0, polygon.length - 1),
    }))
    .filter((opening) => opening.wallIndex >= 0 && opening.wallIndex < polygon.length);

  return {
    ...room,
    polygon,
    wallExterior,
    planX: bounds.minX,
    planY: bounds.minY,
    length: bounds.width.toFixed(3),
    width: bounds.height.toFixed(3),
    exteriorWalls: wallExterior.filter(Boolean).length,
    exteriorFlags:
      polygon.length === 4
        ? [wallExterior[0]!, wallExterior[1]!, wallExterior[2]!, wallExterior[3]!]
        : room.exteriorFlags ?? [true, true, false, false],
    openings,
  };
}

export function insertVertexOnEdge(polygon: PlanPoint[], edgeIndex: number, t = 0.5): PlanPoint[] {
  const a = polygon[edgeIndex]!;
  const b = polygon[(edgeIndex + 1) % polygon.length]!;
  const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const next = [...polygon];
  next.splice(edgeIndex + 1, 0, point);
  return next;
}

export function translatePolygon(polygon: PlanPoint[], dx: number, dy: number): PlanPoint[] {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Demo bay / alcove: rectangular room with a projecting bay on the top edge. */
export function bayWindowPolygon(planX: number, planY: number, length: number, width: number, bayDepth = 0.6, bayWidthRatio = 0.45): PlanPoint[] {
  const bayW = length * bayWidthRatio;
  const bayStart = planX + (length - bayW) / 2;
  const bayEnd = bayStart + bayW;
  return [
    { x: planX, y: planY },
    { x: bayStart, y: planY },
    { x: bayStart, y: planY - bayDepth },
    { x: bayEnd, y: planY - bayDepth },
    { x: bayEnd, y: planY },
    { x: planX + length, y: planY },
    { x: planX + length, y: planY + width },
    { x: planX, y: planY + width },
  ];
}

/** L-shaped hall / room (clockwise). `arm` is the cut-out size from the bottom-right. */
export function lShapePolygon(
  planX: number,
  planY: number,
  length: number,
  width: number,
  armLength = 1.4,
  armWidth = 1.4,
): PlanPoint[] {
  const cutX = planX + length - armLength;
  const cutY = planY + width - armWidth;
  return [
    { x: planX, y: planY },
    { x: planX + length, y: planY },
    { x: planX + length, y: cutY },
    { x: cutX, y: cutY },
    { x: cutX, y: planY + width },
    { x: planX, y: planY + width },
  ];
}

/** Project a point onto an edge; returns 0–1 parameter along the edge. */
export function edgeParam(a: PlanPoint, b: PlanPoint, point: PlanPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  return Math.min(0.9, Math.max(0.1, t));
}

export function openingOnEdge(points: PlanPoint[], opening: PlanOpening) {
  const i = opening.wallIndex ?? 0;
  const a = points[i]!;
  const b = points[(i + 1) % points.length]!;
  const len = dist(a, b) || 1;
  const half = Math.min(opening.widthM / 2, len * 0.4);
  const t = Math.min(0.85, Math.max(0.15, opening.t));
  const cx = a.x + (b.x - a.x) * t;
  const cy = a.y + (b.y - a.y) * t;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return {
    x1: cx - ux * half,
    y1: cy - uy * half,
    x2: cx + ux * half,
    y2: cy + uy * half,
    cx,
    cy,
    nx: -uy,
    ny: ux,
  };
}

/**
 * Deterministic UFH circuit generation for Heat Design.
 * Serpentine (default) / rectangular spiral patterns, manifold assignment, tails, BoQ metres.
 * Geometric estimate only — not MCS / BS EN certificate software.
 */

import { calculateRoomHeatLoss } from "./calc";
import { dist, pointInPolygon, polygonArea, polygonBounds, roomPolygon } from "./geometry";
import type {
  FloorLevel,
  HeatDesignProject,
  HeatDesignRoom,
  HeatingEmitterItem,
  HeatingPipeDiameterMm,
  HeatingPipeKind,
  HeatingPipeRun,
  HeatingPlantItem,
  HeatingSystemLayout,
  PlanPoint,
} from "./types";

export type UfhPattern = "serpentine" | "spiral";
export type UfhSpacingMm = 100 | 150 | 200 | 300;

export type UfhCircuitResult = {
  roomId: string;
  roomName: string;
  manifoldId: string;
  manifoldLabel: string;
  pattern: UfhPattern;
  spacingMm: UfhSpacingMm;
  areaM2: number;
  designWm2: number;
  requiredW: number;
  loopPoints: PlanPoint[];
  loopLengthM: number;
  tailLengthM: number;
  headerPoint: PlanPoint;
};

export type UfhDesignSummary = {
  roomCount: number;
  heatedAreaM2: number;
  circuitCount: number;
  ufhPipeM: number;
  tailPipeM: number;
  primaryPipeM: number;
  totalPipeM: number;
  manifoldCount: number;
  totalLoadW: number;
  totalLoadKw: number;
  suggestedBoilerKw: number;
  suggestedCylinderL: number;
  spacingUsedMm: UfhSpacingMm[];
  circuits: UfhCircuitResult[];
  notes: string[];
  calibrated: boolean;
};

const MAX_CIRCUIT_M = 110;
const WALL_CLEARANCE_M = 0.15;

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function roomCentroidOf(room: HeatDesignRoom): PlanPoint {
  const polygon = roomPolygon(room);
  if (!polygon.length) return { x: 0, y: 0 };
  return polygon.reduce(
    (acc, p) => ({ x: acc.x + p.x / polygon.length, y: acc.y + p.y / polygon.length }),
    { x: 0, y: 0 },
  );
}

function manhattanRoute(from: PlanPoint, to: PlanPoint, preferHorizontalFirst = true): PlanPoint[] {
  if (Math.abs(from.x - to.x) < 0.08 || Math.abs(from.y - to.y) < 0.08) {
    return [
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    ];
  }
  const elbow = preferHorizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return [
    { x: from.x, y: from.y },
    elbow,
    { x: to.x, y: to.y },
  ];
}

function sizeTierForPipe(kind: HeatingPipeKind, label: string): {
  diameterMm: HeatingPipeDiameterMm;
  pipeSpecId: string;
  material: string;
} {
  const text = `${kind} ${label}`.toLowerCase();
  if (kind === "primary" || kind === "refrigerant") {
    return { diameterMm: 28, pipeSpecId: "cu-28", material: "Copper" };
  }
  if (/ufh loop/i.test(text)) {
    return { diameterMm: 15, pipeSpecId: "pex-16", material: "PEX" };
  }
  if (kind === "flow" || kind === "return") {
    return { diameterMm: 15, pipeSpecId: "cu-15", material: "Copper" };
  }
  return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
}

export function polylineLengthM(points: PlanPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += dist(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Prefer tighter centres when specific output (W/m²) is higher. */
export function spacingMmForWm2(wm2: number): UfhSpacingMm {
  if (wm2 >= 110) return 100;
  if (wm2 >= 90) return 150;
  if (wm2 >= 65) return 200;
  return 300;
}

export function assignNearestManifold(
  room: HeatDesignRoom,
  manifolds: HeatingPlantItem[],
  overrides?: Record<string, string>,
): HeatingPlantItem | null {
  if (!manifolds.length) return null;
  const forcedId = overrides?.[room.id];
  if (forcedId) {
    const forced = manifolds.find((row) => row.id === forcedId);
    if (forced) return forced;
  }
  const c = roomCentroidOf(room);
  let best: HeatingPlantItem | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const manifold of manifolds) {
    const d = dist(c, { x: manifold.x, y: manifold.y });
    if (d < bestDist) {
      best = manifold;
      bestDist = d;
    }
  }
  return best;
}

/** Clip a horizontal scan line to segments that lie inside the polygon. */
function horizontalSegmentsInPolygon(
  polygon: PlanPoint[],
  y: number,
  minX: number,
  maxX: number,
): Array<{ x1: number; x2: number }> {
  const hits: number[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      const t = (y - a.y) / (b.y - a.y || 1e-9);
      hits.push(a.x + t * (b.x - a.x));
    }
  }
  hits.sort((left, right) => left - right);
  const segments: Array<{ x1: number; x2: number }> = [];
  for (let i = 0; i + 1 < hits.length; i += 2) {
    const x1 = Math.max(minX, hits[i]!);
    const x2 = Math.min(maxX, hits[i + 1]!);
    if (x2 - x1 > 0.08) segments.push({ x1, x2 });
  }
  // Fallback for tall skinny rooms / numerical miss: sample midpoints.
  if (!segments.length) {
    const mid = (minX + maxX) / 2;
    if (pointInPolygon({ x: mid, y }, polygon)) {
      let left = mid;
      let right = mid;
      while (left - 0.05 >= minX && pointInPolygon({ x: left - 0.05, y }, polygon)) left -= 0.05;
      while (right + 0.05 <= maxX && pointInPolygon({ x: right + 0.05, y }, polygon)) right += 0.05;
      if (right - left > 0.08) segments.push({ x1: left, x2: right });
    }
  }
  return segments;
}

function insetBounds(polygon: PlanPoint[], clearanceM: number) {
  const box = polygonBounds(polygon);
  return {
    minX: box.minX + clearanceM,
    maxX: box.maxX - clearanceM,
    minY: box.minY + clearanceM,
    maxY: box.maxY - clearanceM,
    width: Math.max(0, box.width - clearanceM * 2),
    height: Math.max(0, box.height - clearanceM * 2),
  };
}

/**
 * Serpentine (meander) UFH path inside a room polygon.
 * Horizontal runs at `spacingM`, ends connected into a continuous loop path
 * (supply end near the edge closest to the manifold header preference).
 */
export function generateSerpentineCircuit(
  polygon: PlanPoint[],
  spacingM: number,
  clearanceM = WALL_CLEARANCE_M,
): PlanPoint[] {
  if (polygon.length < 3 || !(spacingM > 0.05)) return [];
  const box = insetBounds(polygon, clearanceM);
  if (box.width < 0.35 || box.height < 0.35) return [];

  const runs: PlanPoint[][] = [];
  const startY = box.minY + spacingM / 2;
  let row = 0;
  for (let y = startY; y <= box.maxY - spacingM / 4; y += spacingM) {
    const segments = horizontalSegmentsInPolygon(polygon, y, box.minX, box.maxX);
    for (const seg of segments) {
      const leftFirst = row % 2 === 0;
      runs.push(
        leftFirst
          ? [
              { x: seg.x1, y },
              { x: seg.x2, y },
            ]
          : [
              { x: seg.x2, y },
              { x: seg.x1, y },
            ],
      );
      row += 1;
    }
  }

  if (!runs.length) return [];

  const path: PlanPoint[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i]!;
    if (!path.length) {
      path.push(...run);
      continue;
    }
    const last = path[path.length - 1]!;
    const nextStart = run[0]!;
    // Vertical connector between serpentine rows.
    if (dist(last, nextStart) > 0.02) {
      path.push({ x: last.x, y: nextStart.y });
      if (Math.abs(last.x - nextStart.x) > 0.02) path.push({ ...nextStart });
    }
    path.push(...run.slice(1));
  }

  return simplifyPolyline(path, 0.02);
}

/** Rectangular counterflow spiral for rect-like rooms (Uponor / LoopCAD spiral option). */
export function generateSpiralCircuit(
  polygon: PlanPoint[],
  spacingM: number,
  clearanceM = WALL_CLEARANCE_M,
): PlanPoint[] {
  if (polygon.length < 3 || !(spacingM > 0.05)) return [];
  const box = insetBounds(polygon, clearanceM);
  if (box.width < spacingM * 2 || box.height < spacingM * 2) {
    return generateSerpentineCircuit(polygon, spacingM, clearanceM);
  }

  const path: PlanPoint[] = [];
  let left = box.minX;
  let right = box.maxX;
  let top = box.minY;
  let bottom = box.maxY;
  let guard = 0;
  while (right - left > spacingM && bottom - top > spacingM && guard < 80) {
    path.push({ x: left, y: top });
    path.push({ x: right, y: top });
    path.push({ x: right, y: bottom });
    path.push({ x: left, y: bottom });
    path.push({ x: left, y: top + spacingM });
    left += spacingM;
    right -= spacingM;
    top += spacingM;
    bottom -= spacingM;
    guard += 1;
  }
  // Only keep spiral points that remain inside the heated polygon.
  const clipped = path.filter((point) => pointInPolygon(point, polygon));
  if (clipped.length < 4) return generateSerpentineCircuit(polygon, spacingM, clearanceM);
  return simplifyPolyline(clipped, 0.02);
}

function simplifyPolyline(points: PlanPoint[], minStepM: number): PlanPoint[] {
  if (points.length < 2) return points;
  const out: PlanPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    if (dist(out[out.length - 1]!, points[i]!) >= minStepM) out.push(points[i]!);
  }
  return out;
}

function makePipe(
  kind: HeatingPipeKind,
  label: string,
  points: PlanPoint[],
  floorLevel: FloorLevel,
): HeatingPipeRun {
  const tier = sizeTierForPipe(kind, label);
  return {
    id: uid(`pipe-${kind}`),
    kind,
    label,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    floorLevel,
    diameterMm: tier.diameterMm,
    pipeSpecId: tier.pipeSpecId,
    material: kind === "flow" && /ufh loop/i.test(label) ? "PEX" : tier.material,
  };
}

function roomLoadWatts(project: HeatDesignProject, room: HeatDesignRoom): { watts: number; areaM2: number; wm2: number } {
  const loss = calculateRoomHeatLoss(
    { ...room, meanWaterTemperature: String(project.flowTemperature) },
    project.designExternalTemp,
  );
  const areaM2 = Math.max(0.1, loss.floorArea || polygonArea(roomPolygon(room)));
  const watts = Math.max(0, loss.watts);
  return { watts, areaM2, wm2: watts / areaM2 };
}

function primaryPipeMetres(pipes: HeatingPipeRun[]): number {
  return pipes
    .filter((pipe) => pipe.kind === "primary" || pipe.kind === "refrigerant" || pipe.kind === "gas" || pipe.kind === "oil")
    .reduce((sum, pipe) => sum + polylineLengthM(pipe.points), 0);
}

/**
 * Build UFH circuits + tails for heated rooms, keep primary plant network, replace emitter stubs.
 */
export function buildUfhCircuitsOnLayout(
  project: HeatDesignProject,
  baseLayout: HeatingSystemLayout,
  options: {
    pattern?: UfhPattern;
    spacingOverrideMm?: UfhSpacingMm;
    manifoldOverrides?: Record<string, string>;
    defaultWm2?: number;
  } = {},
): { layout: HeatingSystemLayout; summary: UfhDesignSummary; circuits: UfhCircuitResult[] } {
  const floor: FloorLevel = project.activeFloor ?? "ground";
  const pattern = options.pattern ?? "serpentine";
  const manifolds = baseLayout.plants.filter((plant) => plant.kind === "manifold");
  const heatedRooms = project.rooms.filter((room) => (room.floorLevel ?? "ground") === floor);
  const circuits: UfhCircuitResult[] = [];
  const ufhPipes: HeatingPipeRun[] = [];
  const emitters: HeatingEmitterItem[] = [];

  // Keep plant primaries / fuel / refrigerant; drop old emitter stubs and prior UFH loops.
  const plantPipes = baseLayout.pipes.filter((pipe) => {
    const label = pipe.label.toLowerCase();
    if (/ufh loop|ufh flow|ufh return|ufh tail|flow →|return ←|flow ·|return ·/i.test(label)) return false;
    if (pipe.kind === "flow" || pipe.kind === "return") {
      // Keep F&R companions that are plant mains (manifold labels from appendPlantNetworkPipes).
      return /manifold|cylinder|boiler|primary|branch|spine|main/i.test(label);
    }
    return true;
  });

  for (const room of heatedRooms) {
    const { watts, areaM2, wm2 } = roomLoadWatts(project, room);
    const designWm2 = watts > 0 ? wm2 : options.defaultWm2 ?? 70;
    const spacingMm = options.spacingOverrideMm ?? spacingMmForWm2(designWm2);
    const spacingM = spacingMm / 1000;
    const polygon = roomPolygon(room);
    const loopPoints =
      pattern === "spiral"
        ? generateSpiralCircuit(polygon, spacingM)
        : generateSerpentineCircuit(polygon, spacingM);

    if (loopPoints.length < 2) continue;

    let chunks: PlanPoint[][] = [loopPoints];
    const totalLen = polylineLengthM(loopPoints);
    if (totalLen > MAX_CIRCUIT_M) {
      // Split long rooms into sequential chunks under the circuit length limit.
      chunks = [];
      let current: PlanPoint[] = [loopPoints[0]!];
      let len = 0;
      for (let i = 1; i < loopPoints.length; i += 1) {
        const step = dist(loopPoints[i - 1]!, loopPoints[i]!);
        if (len + step > MAX_CIRCUIT_M && current.length > 1) {
          chunks.push(current);
          current = [loopPoints[i - 1]!, loopPoints[i]!];
          len = step;
        } else {
          current.push(loopPoints[i]!);
          len += step;
        }
      }
      if (current.length > 1) chunks.push(current);
    }

    const manifold = assignNearestManifold(room, manifolds, options.manifoldOverrides);
    const box = polygonBounds(polygon);

    chunks.forEach((chunk, index) => {
      const headerPoint = chunk[0]!;
      const loopLengthM = polylineLengthM(chunk);
      let tailPoints: PlanPoint[] = [];
      let tailLengthM = 0;
      let manifoldId = "";
      let manifoldLabel = "Unassigned";

      if (manifold) {
        manifoldId = manifold.id;
        manifoldLabel = manifold.label || "Manifold";
        const toManifold = { x: manifold.x, y: manifold.y };
        const flowTail = manhattanRoute(toManifold, headerPoint, true);
        const returnEnd = chunk[chunk.length - 1]!;
        const returnTail = manhattanRoute(returnEnd, toManifold, false);
        tailPoints = flowTail;
        tailLengthM = polylineLengthM(flowTail) + polylineLengthM(returnTail);
        const suffix = chunks.length > 1 ? ` ${index + 1}` : "";
        ufhPipes.push(
          makePipe("flow", `UFH tail flow · ${room.name || "Room"}${suffix}`, flowTail, floor),
          makePipe("return", `UFH tail return · ${room.name || "Room"}${suffix}`, returnTail, floor),
        );
      }

      const suffix = chunks.length > 1 ? ` ${index + 1}` : "";
      ufhPipes.push(makePipe("flow", `UFH loop · ${room.name || "Room"}${suffix}`, chunk, floor));

      circuits.push({
        roomId: room.id,
        roomName: room.name || "Room",
        manifoldId,
        manifoldLabel,
        pattern,
        spacingMm,
        areaM2: areaM2 / chunks.length,
        designWm2,
        requiredW: watts / chunks.length,
        loopPoints: chunk,
        loopLengthM,
        tailLengthM,
        headerPoint,
      });
    });

    emitters.push({
      id: uid("ufh"),
      kind: "ufh",
      label: `UFH · ${room.name || "Room"}`,
      roomId: room.id,
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2,
      widthM: Math.max(1, box.width - 0.5),
      depthM: Math.max(0.8, box.height - 0.5),
      rotationDeg: 0,
      floorLevel: floor,
      outputWatts: watts,
    });
  }

  const layout: HeatingSystemLayout = {
    ...baseLayout,
    pipes: [...plantPipes, ...ufhPipes],
    emitters,
    emitterMode: "ufh",
    updatedAt: new Date().toISOString(),
  };

  const summary = summariseUfhDesign(project, layout, circuits);
  return { layout, summary, circuits };
}

export function summariseUfhDesign(
  project: HeatDesignProject,
  layout: HeatingSystemLayout,
  circuits: UfhCircuitResult[],
): UfhDesignSummary {
  const ufhPipeM = circuits.reduce((sum, row) => sum + row.loopLengthM, 0);
  const tailPipeM = circuits.reduce((sum, row) => sum + row.tailLengthM, 0);
  const primaryPipeM = primaryPipeMetres(layout.pipes);
  const heatedAreaM2 = circuits.reduce((sum, row) => sum + row.areaM2, 0);
  const totalLoadW = circuits.reduce((sum, row) => sum + row.requiredW, 0);
  const totalLoadKw = totalLoadW / 1000;
  const manifoldCount = layout.plants.filter((p) => p.kind === "manifold").length;
  const suggestedBoilerKw = Math.max(12, Math.ceil((totalLoadKw + 2) * 2) / 2);
  const suggestedCylinderL =
    project.cylinderLitres || Math.max(150, Math.round((project.occupants || 3) * 50 / 10) * 10 + 60);
  const spacingUsedMm = [...new Set(circuits.map((row) => row.spacingMm))] as UfhSpacingMm[];
  const calibrated = Boolean(project.planUnderlay?.scale?.calibrated);
  const notes: string[] = [
    "Geometric UFH design + room heat-loss estimate — not an MCS certificate.",
    calibrated
      ? "Drawing scale is calibrated — areas and pipe lengths are in real metres."
      : "Scale not calibrated — set a known length on the underlay before trusting metre totals.",
  ];
  if (!manifoldCount) notes.push("Place at least one manifold before generating tails.");
  if (!circuits.length) notes.push("Draw heated rooms, then Generate UFH.");
  if (circuits.some((row) => row.loopLengthM > MAX_CIRCUIT_M * 0.95)) {
    notes.push(`Long circuits were split near ${MAX_CIRCUIT_M} m (typical UFH limit).`);
  }

  return {
    roomCount: new Set(circuits.map((row) => row.roomId)).size,
    heatedAreaM2: Number(heatedAreaM2.toFixed(2)),
    circuitCount: circuits.length,
    ufhPipeM: Number(ufhPipeM.toFixed(1)),
    tailPipeM: Number(tailPipeM.toFixed(1)),
    primaryPipeM: Number(primaryPipeM.toFixed(1)),
    totalPipeM: Number((ufhPipeM + tailPipeM + primaryPipeM).toFixed(1)),
    manifoldCount,
    totalLoadW: Math.round(totalLoadW),
    totalLoadKw: Number(totalLoadKw.toFixed(2)),
    suggestedBoilerKw,
    suggestedCylinderL,
    spacingUsedMm,
    circuits,
    notes,
    calibrated,
  };
}

/** Workflow checklist for the UFH design mode. */
export function ufhWorkflowStatus(project: HeatDesignProject): {
  scale: boolean;
  rooms: boolean;
  plant: boolean;
  circuits: boolean;
  kit: boolean;
  steps: Array<{ id: string; label: string; done: boolean; hint: string }>;
} {
  // Allow progress without underlay (drawn plan only) — scale step done if no underlay or calibrated.
  const scaleDone = !project.planUnderlay || Boolean(project.planUnderlay.scale?.calibrated);
  const rooms = project.rooms.length > 0;
  const plant = (project.heatingLayout?.plants?.length ?? 0) > 0;
  const circuits = (project.heatingLayout?.pipes ?? []).some((pipe) => /ufh loop/i.test(pipe.label));
  const kit = circuits && (project.heatingLayout?.pipes?.length ?? 0) > 0;
  const steps = [
    {
      id: "scale",
      label: "Scale",
      done: scaleDone,
      hint: project.planUnderlay
        ? "Click two ends of a known dimension, enter metres, Apply"
        : "Optional underlay — or draw rooms in metres",
    },
    {
      id: "rooms",
      label: "Rooms",
      done: rooms,
      hint: "Draw heated rooms so area and load update Plan totals",
    },
    {
      id: "plant",
      label: "Plant",
      done: plant,
      hint: "Place boiler / cylinder / manifold on the plan",
    },
    {
      id: "ufh",
      label: "Generate UFH",
      done: circuits,
      hint: "Auto serpentine circuits + tails to nearest manifold",
    },
    {
      id: "kit",
      label: "Kit / BoQ",
      done: kit,
      hint: "Review pipe metres, then Defined kit → Send to Takeoff",
    },
  ];
  return { scale: scaleDone, rooms, plant, circuits, kit, steps };
}

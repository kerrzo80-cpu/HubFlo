import { pickRadiatorForRoom } from "./calc";
import { dist, polygonBounds, roomPolygon, roomWallExterior } from "./geometry";
import { heatingSystemOptions, type HeatingSystemKind } from "./systems";
import { buildUfhCircuitsOnLayout } from "./ufh-circuits";
import type {
  FloorLevel,
  HeatDesignProject,
  HeatDesignRoom,
  HeatingEmitterItem,
  HeatingEmitterMode,
  HeatingPipeKind,
  HeatingPipeRun,
  HeatingPlantItem,
  HeatingPlantKind,
  HeatingSystemLayout,
  PlanPoint,
} from "./types";

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function roomCentroid(room: HeatDesignRoom) {
  const polygon = roomPolygon(room);
  if (!polygon.length) return { x: 0, y: 0 };
  return polygon.reduce(
    (acc, p) => ({ x: acc.x + p.x / polygon.length, y: acc.y + p.y / polygon.length }),
    { x: 0, y: 0 },
  );
}

function plantRoomPreference(roomType: string) {
  const t = roomType.toLowerCase();
  if (t.includes("utility") || t.includes("plant")) return 0;
  if (t.includes("kitchen")) return 1;
  if (t.includes("garage")) return 2;
  if (t.includes("hall") || t.includes("cupboard")) return 3;
  return 9;
}

export function pickPlantRoom(rooms: HeatDesignProject["rooms"], floor: FloorLevel = "ground") {
  const onFloor = rooms.filter((room) => (room.floorLevel ?? "ground") === floor);
  const pool = onFloor.length ? onFloor : rooms;
  return [...pool].sort((a, b) => plantRoomPreference(a.roomType) - plantRoomPreference(b.roomType))[0] ?? null;
}

type EdgeInfo = {
  index: number;
  a: PlanPoint;
  b: PlanPoint;
  mid: PlanPoint;
  len: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  outward: number;
  exterior: boolean;
};

function edgesOf(room: HeatDesignRoom): EdgeInfo[] {
  const polygon = roomPolygon(room);
  const exterior = roomWallExterior(room, polygon.length);
  const c = roomCentroid(room);
  return polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length]!;
    const len = dist(a, b) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const toMid = { x: mid.x - c.x, y: mid.y - c.y };
    const outward = toMid.x * nx + toMid.y * ny >= 0 ? 1 : -1;
    return {
      index,
      a,
      b,
      mid,
      len,
      ux,
      uy,
      nx,
      ny,
      outward,
      exterior: Boolean(exterior[index]),
    };
  });
}

function pointOnEdge(edge: EdgeInfo, t: number, insetInward = 0): PlanPoint {
  const along = {
    x: edge.a.x + (edge.b.x - edge.a.x) * t,
    y: edge.a.y + (edge.b.y - edge.a.y) * t,
  };
  return {
    x: along.x - edge.nx * insetInward * edge.outward,
    y: along.y - edge.ny * insetInward * edge.outward,
  };
}

/** Outdoor plant just outside an exterior wall — kept close so it stays on the canvas. */
export function outdoorAnchor(room: HeatDesignRoom, offsetM: number): PlanPoint {
  const edges = edgesOf(room).filter((e) => e.exterior);
  const pool = edges.length ? edges : edgesOf(room);
  // Prefer the lowest (south) exterior edge so OU sits below the building on plan
  const edge = [...pool].sort((a, b) => b.mid.y - a.mid.y || b.len - a.len)[0]!;
  const capped = Math.min(Math.max(0.9, offsetM), 1.6);
  return {
    x: edge.mid.x + edge.nx * capped * edge.outward,
    y: edge.mid.y + edge.ny * capped * edge.outward,
  };
}

/** Lay plant along the longest usable wall inside the plant room, spaced clearly. */
function plantBaySlots(room: HeatDesignRoom, count: number): PlanPoint[] {
  const edges = edgesOf(room);
  // Prefer an exterior wall so flue / primary pipe leave cleanly; fall back to longest wall
  const exterior = edges.filter((e) => e.exterior && e.len >= 1.4);
  const edge = [...(exterior.length ? exterior : edges)].sort((a, b) => b.len - a.len)[0]!;
  const inset = Math.min(0.55, edge.len * 0.18);
  const usable = Math.max(0.8, edge.len - inset * 2);
  const slots: PlanPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = inset / edge.len + ((i + 0.5) / count) * (usable / edge.len);
    slots.push(pointOnEdge(edge, Math.min(0.88, Math.max(0.12, t)), 0.55));
  }
  return slots;
}

/** Orthogonal route via one elbow — prefers staying near the building envelope. */
export function manhattanRoute(from: PlanPoint, to: PlanPoint, preferHorizontalFirst = true): PlanPoint[] {
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

/** Service spine route: drop to a corridor Y, run across, then up — keeps pipes tidy. */
export function spineRoute(from: PlanPoint, to: PlanPoint, spineY: number, laneOffset = 0): PlanPoint[] {
  const fy = from.y + laneOffset;
  const ty = to.y + laneOffset;
  const sy = spineY + laneOffset;
  const points: PlanPoint[] = [{ x: from.x, y: from.y }];
  if (Math.abs(from.y - sy) > 0.05) points.push({ x: from.x, y: sy });
  if (Math.abs(from.x - to.x) > 0.05) points.push({ x: to.x, y: sy });
  if (Math.abs(ty - sy) > 0.05) points.push({ x: to.x, y: ty });
  else if (points[points.length - 1]!.x !== to.x || points[points.length - 1]!.y !== to.y) {
    points.push({ x: to.x, y: to.y });
  }
  // Deduplicate consecutive points
  return points.filter((p, i) => i === 0 || dist(p, points[i - 1]!) > 0.02);
}

function makePlant(
  kind: HeatingPlantKind,
  label: string,
  point: PlanPoint,
  floorLevel: FloorLevel,
  size?: { widthM: number; depthM: number },
  placedByUser?: boolean,
): HeatingPlantItem {
  return {
    id: uid(`plant-${kind}`),
    kind,
    label,
    x: point.x,
    y: point.y,
    floorLevel,
    widthM: size?.widthM,
    depthM: size?.depthM,
    placedByUser: placedByUser || undefined,
  };
}

/** Group related plant kinds so “one boiler” / “one cylinder” stays unique on plan. */
export function plantRole(kind: HeatingPlantKind): string {
  if (kind === "boiler" || kind === "electric_boiler") return "boiler";
  if (kind === "cylinder" || kind === "buffer") return "cylinder";
  if (kind === "manifold") return "manifold";
  if (kind === "outdoor_unit") return "outdoor_unit";
  if (kind === "oil_tank" || kind === "lpg_tank") return "fuel_tank";
  return kind;
}

export function defaultPlantLabel(kind: HeatingPlantKind, cylinderLitres = 210): string {
  switch (kind) {
    case "boiler":
      return "Gas boiler";
    case "electric_boiler":
      return "Electric boiler";
    case "outdoor_unit":
      return "Outdoor unit";
    case "cylinder":
      return `${cylinderLitres || 210}L cylinder`;
    case "buffer":
      return "Buffer / volumiser";
    case "manifold":
      return "Heating manifold";
    case "oil_tank":
      return "Oil tank";
    case "lpg_tank":
      return "LPG tank";
    default:
      return "Plant";
  }
}

export function plantFootprint(kind: HeatingPlantKind) {
  return plantSizes(kind);
}

/**
 * Drop / click-place plant. Replaces any existing plant in the same role so the plan stays sane,
 * except manifolds — engineers often place two (UFH + rads / upstairs + downstairs).
 * Does not redraw pipes — call seedHeatingLayout with preservePlants after the engineer is happy.
 */
export function placePlantOnLayout(
  layout: HeatingSystemLayout | null | undefined,
  kind: HeatingPlantKind,
  x: number,
  y: number,
  floorLevel: FloorLevel,
  options: {
    label?: string;
    systemOptionId?: string;
    emitterMode?: HeatingEmitterMode;
    cylinderLitres?: number;
  } = {},
): HeatingSystemLayout {
  const size = plantSizes(kind);
  const role = plantRole(kind);
  const manifoldIndex =
    role === "manifold" ? (layout?.plants ?? []).filter((row) => plantRole(row.kind) === "manifold").length + 1 : 0;
  const plant = makePlant(
    kind,
    options.label ||
      (manifoldIndex > 1
        ? `Heating manifold ${manifoldIndex}`
        : defaultPlantLabel(kind, options.cylinderLitres)),
    { x, y },
    floorLevel,
    size,
    true,
  );
  const previous =
    role === "manifold"
      ? [...(layout?.plants ?? [])]
      : (layout?.plants ?? []).filter((row) => plantRole(row.kind) !== role);
  return {
    systemOptionId: layout?.systemOptionId || options.systemOptionId || "opt-ashp",
    plants: [...previous, plant],
    pipes: layout?.pipes ?? [],
    emitters: layout?.emitters ?? [],
    emitterMode: layout?.emitterMode ?? options.emitterMode ?? "radiators",
    updatedAt: new Date().toISOString(),
  };
}

export function removePlantFromLayout(layout: HeatingSystemLayout, plantId: string): HeatingSystemLayout {
  return {
    ...layout,
    plants: layout.plants.filter((plant) => plant.id !== plantId),
    updatedAt: new Date().toISOString(),
  };
}

export type SeedHeatingLayoutOptions = {
  /** Engineer plant positions to keep while redrawing emitters + pipe routes. */
  preservePlants?: HeatingPlantItem[] | null;
  /**
   * When true, never invent boiler / cylinder / manifold / OU the engineer did not place.
   * Defaults to true whenever any preserved plant is `placedByUser`.
   * Pass false to force a full auto plant kit (e.g. Design on plan from a blank).
   */
  onlyUserPlants?: boolean;
};

export type HeatingPipeSizeTier = {
  diameterMm: 15 | 22 | 28;
  pipeSpecId: string;
  material: string;
};

/** Blake size policy: mains 28 · branches 22 · rad/UFH tails 15. */
export function sizeTierForPipe(kind: HeatingPipeKind, label: string): HeatingPipeSizeTier {
  const text = `${kind} ${label}`.toLowerCase();
  if (kind === "primary" || kind === "refrigerant") {
    return { diameterMm: 28, pipeSpecId: "cu-28", material: "Copper" };
  }
  if (kind === "gas" || kind === "oil") {
    return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
  }
  if (kind === "dhw") {
    return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
  }
  // Flow/return: tails to emitters are 15; anything labelled branch/spine/main steps up.
  if (/\b(main|spine|branch|riser)\b/.test(text)) {
    return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
  }
  if (kind === "flow" || kind === "return") {
    return { diameterMm: 15, pipeSpecId: "cu-15", material: "Copper" };
  }
  return { diameterMm: 22, pipeSpecId: "cu-22", material: "Copper" };
}

function makePipe(
  kind: HeatingPipeKind,
  label: string,
  points: PlanPoint[],
  floorLevel: FloorLevel,
  size?: HeatingPipeSizeTier,
): HeatingPipeRun {
  const tier = size || sizeTierForPipe(kind, label);
  return {
    id: uid(`pipe-${kind}`),
    kind,
    label,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    floorLevel,
    diameterMm: tier.diameterMm,
    pipeSpecId: tier.pipeSpecId,
    material: tier.material,
  };
}

function plantSizes(kind: HeatingPlantKind) {
  if (kind === "outdoor_unit") return { widthM: 1.05, depthM: 0.42 };
  if (kind === "cylinder" || kind === "buffer") return { widthM: 0.55, depthM: 0.55 };
  if (kind === "oil_tank" || kind === "lpg_tank") return { widthM: 1.2, depthM: 0.7 };
  if (kind === "manifold") return { widthM: 0.5, depthM: 0.18 };
  return { widthM: 0.48, depthM: 0.32 };
}

function pickPreservedPlant(
  preserved: HeatingPlantItem[],
  kind: HeatingPlantKind,
  floor: FloorLevel,
): HeatingPlantItem | null {
  const role = plantRole(kind);
  const onFloor = preserved.filter((plant) => (plant.floorLevel ?? "ground") === floor);
  const pool = onFloor.length ? onFloor : preserved;
  return pool.find((plant) => plantRole(plant.kind) === role) ?? null;
}

function reuseOrMakePlant(
  preserved: HeatingPlantItem[],
  kind: HeatingPlantKind,
  label: string,
  slot: PlanPoint,
  floor: FloorLevel,
): HeatingPlantItem {
  const existing = pickPreservedPlant(preserved, kind, floor);
  if (!existing) return makePlant(kind, label, slot, floor, plantSizes(kind));
  const size = plantSizes(kind);
  return {
    ...existing,
    kind,
    label: existing.placedByUser && existing.label ? existing.label : label,
    x: existing.x,
    y: existing.y,
    floorLevel: floor,
    widthM: existing.widthM ?? size.widthM,
    depthM: existing.depthM ?? size.depthM,
    placedByUser: existing.placedByUser,
  };
}

function kindForOption(optionId: string): HeatingSystemKind {
  return heatingSystemOptions.find((item) => item.id === optionId)?.kind ?? "ashp";
}

function prefersUfh(room: HeatDesignRoom, flowTemperature: number, mode: HeatingEmitterMode) {
  if (mode === "radiators") return false;
  if (mode === "ufh") return true;
  const type = room.roomType.toLowerCase();
  const floor = (room.floorType || "").toLowerCase();
  const wet =
    type.includes("bath") ||
    type.includes("kitchen") ||
    type.includes("utility") ||
    type.includes("hall") ||
    floor.includes("concrete") ||
    floor.includes("solid");
  return wet && flowTemperature <= 45;
}

/** Place radiator under a window, else on the longest exterior wall. */
function radiatorPlacement(room: HeatDesignRoom): { point: PlanPoint; widthM: number; rotationDeg: number; wallIndex: number } {
  const polygon = roomPolygon(room);
  const edges = edgesOf(room);
  const openings = room.openings ?? [];
  const window = openings.find((o) => o.kind === "window");
  let edge = edges.filter((e) => e.exterior).sort((a, b) => b.len - a.len)[0] ?? edges[0]!;
  let t = 0.5;
  if (window) {
    const wi = window.wallIndex ?? window.wall ?? 0;
    edge = edges[wi] ?? edge;
    t = window.t;
  }
  const widthM = Math.min(1.4, Math.max(0.7, edge.len * 0.35));
  const point = pointOnEdge(edge, t, 0.28);
  const rotationDeg = (Math.atan2(edge.uy, edge.ux) * 180) / Math.PI;
  return { point, widthM, rotationDeg, wallIndex: edge.index };
}

function ufhZone(room: HeatDesignRoom): { point: PlanPoint; widthM: number; depthM: number } {
  const box = polygonBounds(roomPolygon(room));
  const pad = 0.35;
  return {
    point: { x: box.minX + box.width / 2, y: box.minY + box.height / 2 },
    widthM: Math.max(1.2, box.width - pad * 2),
    depthM: Math.max(1.0, box.height - pad * 2),
  };
}

function buildEmitters(
  project: HeatDesignProject,
  floor: FloorLevel,
  mode: HeatingEmitterMode,
): HeatingEmitterItem[] {
  const heated = project.rooms.filter((room) => (room.floorLevel ?? "ground") === floor);
  const emitters: HeatingEmitterItem[] = [];
  for (const room of heated) {
    if (prefersUfh(room, project.flowTemperature, mode)) {
      const zone = ufhZone(room);
      emitters.push({
        id: uid("ufh"),
        kind: "ufh",
        label: `UFH · ${room.name || "Room"}`,
        roomId: room.id,
        x: zone.point.x,
        y: zone.point.y,
        widthM: zone.widthM,
        depthM: zone.depthM,
        rotationDeg: 0,
        floorLevel: floor,
      });
      continue;
    }
    const rad = pickRadiatorForRoom(
      { ...room, meanWaterTemperature: String(project.flowTemperature) },
      project.designExternalTemp,
    );
    const place = radiatorPlacement(room);
    const label = rad
      ? `${rad.model} · ${rad.outputWatts}W`
      : `Radiator · ${room.name || "Room"}`;
    emitters.push({
      id: uid("rad"),
      kind: "radiator",
      label,
      roomId: room.id,
      x: place.point.x,
      y: place.point.y,
      widthM: place.widthM,
      depthM: 0.14,
      rotationDeg: place.rotationDeg,
      floorLevel: floor,
      radiatorId: rad?.id,
      outputWatts: rad?.outputWatts,
    });
  }
  return emitters;
}

function serviceSpineY(rooms: HeatDesignRoom[], plantRoom: HeatDesignRoom): number {
  let maxY = 0;
  for (const room of rooms) {
    const box = polygonBounds(roomPolygon(room));
    maxY = Math.max(maxY, box.maxY);
  }
  const plantBox = polygonBounds(roomPolygon(plantRoom));
  // Corridor just inside / along the south of the plant room
  return Math.min(plantBox.maxY - 0.35, maxY - 0.25);
}

function reusePreservedPlants(preserved: HeatingPlantItem[], floor: FloorLevel): HeatingPlantItem[] {
  const onFloor = preserved.filter((plant) => (plant.floorLevel ?? "ground") === floor);
  const pool = onFloor.length ? onFloor : preserved;
  return pool.map((plant) => {
    const size = plantSizes(plant.kind);
    return {
      ...plant,
      floorLevel: plant.floorLevel ?? floor,
      widthM: plant.widthM ?? size.widthM,
      depthM: plant.depthM ?? size.depthM,
    };
  });
}

/** Human-readable notes of what the seeded network actually connected — for Blake UI. */
export function describeHeatingLayoutNotes(layout: HeatingSystemLayout | null | undefined): string[] {
  if (!layout) return [];
  const notes: string[] = [];
  const plantLabels = layout.plants.map((p) => p.label || p.kind.replace(/_/g, " "));
  if (plantLabels.length) {
    notes.push(`Plant on plan: ${plantLabels.join(", ")}.`);
  }
  const emitters = layout.emitters ?? [];
  if (emitters.length) {
    const rads = emitters.filter((e) => e.kind === "radiator").length;
    const ufh = emitters.filter((e) => e.kind === "ufh").length;
    const bits: string[] = [];
    if (rads) bits.push(`${rads} radiator${rads === 1 ? "" : "s"}`);
    if (ufh) bits.push(`${ufh} UFH zone${ufh === 1 ? "" : "s"}`);
    notes.push(`Emitters: ${bits.join(" + ") || `${emitters.length} emitters`}.`);
  } else if (layout.plants.length) {
    notes.push("No room polygons — primary / flow–return drawn plant-to-plant only.");
  }
  const ufhLoops = (layout.pipes || []).filter((p) => /ufh loop/i.test(p.label)).length;
  if (ufhLoops) {
    notes.push(`${ufhLoops} UFH circuit${ufhLoops === 1 ? "" : "s"} drawn inside room polygons.`);
  }
  const labels = (layout.pipes || [])
    .map((p) => p.label)
    .filter(Boolean)
    .slice(0, 10);
  if (labels.length) {
    notes.push(`Routes: ${labels.join("; ")}.`);
  } else {
    notes.push("No pipe runs were generated — place boiler / cylinder / manifold (or draw rooms), then ask again.");
  }
  notes.push("Geometric draft only — not an MCS / full hydraulic certificate.");
  return notes;
}

/**
 * Always draw a usable heating network when plant and/or rooms exist.
 * Preserves engineer plant; invents full plant kit only when nothing was placed.
 */
export function ensureDesignLayout(
  project: HeatDesignProject,
  options: SeedHeatingLayoutOptions & {
    systemOptionId?: string;
    emitterMode?: HeatingEmitterMode;
  } = {},
): HeatingSystemLayout | null {
  const systemOptionId =
    options.systemOptionId || project.chosenSystemId || project.heatingLayout?.systemOptionId || "";
  if (!systemOptionId) return null;
  const hasPlant = (options.preservePlants?.length || project.heatingLayout?.plants?.length || 0) > 0;
  const hasRooms = (project.rooms?.length || 0) > 0;
  if (!hasPlant && !hasRooms) return null;
  const emitterMode =
    options.emitterMode || project.emitterMode || project.heatingLayout?.emitterMode || "radiators";
  return seedHeatingLayout(project, systemOptionId, emitterMode, {
    preservePlants: options.preservePlants ?? project.heatingLayout?.plants,
    onlyUserPlants: options.onlyUserPlants,
  });
}

/** Primary / fuel pipes that connect placed plant pieces (works with or without rooms). */
function appendPlantNetworkPipes(
  pipes: HeatingPipeRun[],
  plants: HeatingPlantItem[],
  kind: HeatingSystemKind,
  floor: FloorLevel,
  plantRoom: HeatDesignRoom | undefined,
): void {
  const cylinder = plants.find((p) => p.kind === "cylinder" || p.kind === "buffer");
  const manifolds = plants.filter((p) => p.kind === "manifold");
  const boiler = plants.find((p) => p.kind === "boiler" || p.kind === "electric_boiler");
  const ou = plants.find((p) => p.kind === "outdoor_unit" || p.kind === "oil_tank" || p.kind === "lpg_tank");
  const source = cylinder ?? boiler;

  if (ou && cylinder && (kind === "ashp" || kind === "hybrid")) {
    // Keep refrigerant on a short L: OU → wall line → cylinder
    const entry = { x: cylinder.x, y: ou.y };
    pipes.push(
      makePipe(
        "refrigerant",
        "Refrigerant / primary",
        [
          { x: ou.x, y: ou.y },
          entry,
          { x: cylinder.x, y: cylinder.y },
        ],
        floor,
      ),
    );
  }
  if (ou && boiler && (kind === "oil" || kind === "lpg")) {
    pipes.push(
      makePipe(
        kind === "oil" ? "oil" : "gas",
        kind === "oil" ? "Oil feed" : "LPG supply",
        manhattanRoute({ x: ou.x, y: ou.y }, { x: boiler.x, y: boiler.y }, true),
        floor,
      ),
    );
  }
  if (kind === "gas" && boiler) {
    const meter = plantRoom
      ? outdoorAnchor(plantRoom, 0.5)
      : { x: boiler.x - 0.9, y: boiler.y + 0.65 };
    pipes.push(makePipe("gas", "Gas supply", manhattanRoute(meter, { x: boiler.x, y: boiler.y }, true), floor));
  }
  if (boiler && cylinder) {
    pipes.push(
      makePipe(
        "primary",
        "Boiler → cylinder",
        manhattanRoute({ x: boiler.x, y: boiler.y }, { x: cylinder.x, y: cylinder.y }, false),
        floor,
      ),
    );
  }

  if (source && manifolds.length) {
    const fromLabel = cylinder ? "Cylinder" : "Boiler";
    manifolds.forEach((manifold, index) => {
      const suffix = manifolds.length > 1 ? ` ${index + 1}` : "";
      const from = { x: source.x, y: source.y };
      const to = { x: manifold.x, y: manifold.y };
      pipes.push(
        makePipe(
          "primary",
          `${fromLabel} → manifold${suffix}`,
          manhattanRoute(from, to, true),
          floor,
        ),
      );
      // Visible F&R companions (offset enough to read next to primary on PDF underlays).
      pipes.push(
        makePipe(
          "flow",
          `Flow · manifold${suffix}`,
          manhattanRoute({ x: from.x - 0.12, y: from.y - 0.08 }, { x: to.x - 0.12, y: to.y - 0.08 }, true),
          floor,
        ),
        makePipe(
          "return",
          `Return · manifold${suffix}`,
          manhattanRoute({ x: to.x + 0.12, y: to.y + 0.08 }, { x: from.x + 0.12, y: from.y + 0.08 }, false),
          floor,
        ),
      );
    });
  } else if (boiler && !cylinder && !manifolds.length) {
    // Lone boiler: small primary stub so Route pipes never looks empty.
    pipes.push(
      makePipe(
        "primary",
        "Boiler primary stub",
        [
          { x: boiler.x, y: boiler.y },
          { x: boiler.x + 0.45, y: boiler.y },
          { x: boiler.x + 0.45, y: boiler.y + 0.35 },
        ],
        floor,
      ),
    );
  }
}

/**
 * Seed a designed heating layout: spaced plant, outdoor unit kept on-canvas,
 * radiators / UFH in each room, and tidy spine pipe routes.
 *
 * When engineer-placed plant is present, routes only around those pieces —
 * Blake / Route pipes must not surprise-add a cylinder or OU the user never placed.
 * Plant-to-plant mains still draw when rooms are missing (PDF underlay / plant-first).
 */
export function seedHeatingLayout(
  project: HeatDesignProject,
  systemOptionId: string,
  emitterMode: HeatingEmitterMode = project.emitterMode ?? "radiators",
  options: SeedHeatingLayoutOptions = {},
): HeatingSystemLayout {
  const kind = kindForOption(systemOptionId);
  const floor: FloorLevel = project.activeFloor ?? "ground";
  const plantRoom = pickPlantRoom(project.rooms, floor) ?? project.rooms[0];
  const plants: HeatingPlantItem[] = [];
  const pipes: HeatingPipeRun[] = [];
  const preserved = options.preservePlants ?? [];
  const onlyUserPlants =
    options.onlyUserPlants === true
    || (options.onlyUserPlants !== false && preserved.some((plant) => plant.placedByUser));

  // No rooms and no plant to preserve — nothing to route.
  if (!plantRoom && !preserved.length) {
    return {
      systemOptionId,
      plants: [],
      pipes,
      emitters: [],
      emitterMode,
      updatedAt: new Date().toISOString(),
    };
  }

  // Plant-first / PDF underlay: keep engineer plant and draw mains even without room polygons.
  if (!plantRoom) {
    plants.push(...reusePreservedPlants(preserved, floor));
    appendPlantNetworkPipes(pipes, plants, kind, floor, undefined);
    return {
      systemOptionId,
      plants,
      pipes,
      emitters: [],
      emitterMode,
      updatedAt: new Date().toISOString(),
    };
  }

  const outdoorDist = Math.min(1.5, Math.max(1.0, project.outdoorUnitDistanceM || 1.5));
  const outdoor = outdoorAnchor(plantRoom, outdoorDist);
  const emitters = buildEmitters(project, floor, emitterMode);
  const spineY = serviceSpineY(
    project.rooms.filter((r) => (r.floorLevel ?? "ground") === floor),
    plantRoom,
  );

  if (onlyUserPlants && preserved.length) {
    plants.push(...reusePreservedPlants(preserved, floor));
  } else {
    const indoorKinds: Array<{ kind: HeatingPlantKind; label: string }> = [];
    if (kind === "ashp") {
      indoorKinds.push(
        { kind: "cylinder", label: `${project.cylinderLitres || 210}L cylinder` },
        { kind: "manifold", label: "Heating manifold" },
      );
    } else if (kind === "hybrid") {
      indoorKinds.push(
        { kind: "boiler", label: "Gas boiler (peak)" },
        { kind: "cylinder", label: `${project.cylinderLitres || 210}L cylinder` },
        { kind: "manifold", label: "Heating manifold" },
      );
    } else if (kind === "gas" || kind === "electric") {
      indoorKinds.push(
        {
          kind: kind === "electric" ? "electric_boiler" : "boiler",
          label: kind === "electric" ? "Electric boiler" : "Gas boiler",
        },
        { kind: "cylinder", label: `${project.cylinderLitres || 210}L cylinder` },
        { kind: "manifold", label: "Heating manifold" },
      );
    } else {
      indoorKinds.push(
        { kind: "boiler", label: kind === "oil" ? "Oil boiler" : "LPG boiler" },
        { kind: "cylinder", label: `${project.cylinderLitres || 210}L cylinder` },
        { kind: "manifold", label: "Heating manifold" },
      );
    }

    const slots = plantBaySlots(plantRoom, indoorKinds.length);
    indoorKinds.forEach((item, index) => {
      const slot = slots[index] ?? roomCentroid(plantRoom);
      plants.push(reuseOrMakePlant(preserved, item.kind, item.label, slot, floor));
    });

    if (kind === "ashp" || kind === "hybrid") {
      plants.push(reuseOrMakePlant(preserved, "outdoor_unit", "Outdoor unit", outdoor, floor));
    } else if (kind === "oil" || kind === "lpg") {
      plants.push(
        reuseOrMakePlant(
          preserved,
          kind === "oil" ? "oil_tank" : "lpg_tank",
          kind === "oil" ? "Oil tank" : "LPG tank",
          outdoor,
          floor,
        ),
      );
    }
  }

  appendPlantNetworkPipes(pipes, plants, kind, floor, plantRoom);

  const hub =
    plants.find((p) => p.kind === "manifold")
    ?? plants.find((p) => p.kind === "boiler" || p.kind === "electric_boiler")
    ?? plants.find((p) => p.kind === "cylinder");
  const hubPoint = hub ? { x: hub.x, y: hub.y } : roomCentroid(plantRoom);

  emitters.forEach((emitter, index) => {
    if (emitter.kind === "ufh") {
      // Short tails into the zone from the spine — replaced by real loops when UFH generate runs.
      const entry = { x: emitter.x, y: emitter.y + emitter.depthM / 2 - 0.15 };
      pipes.push(
        makePipe("flow", `UFH flow · ${emitter.label}`, spineRoute(hubPoint, entry, spineY, -0.08), floor),
        makePipe(
          "return",
          `UFH return · ${emitter.label}`,
          spineRoute({ x: entry.x + 0.2, y: entry.y }, hubPoint, spineY, 0.08),
          floor,
        ),
      );
      return;
    }
    const flowTarget = { x: emitter.x - 0.08, y: emitter.y };
    const returnTarget = { x: emitter.x + 0.08, y: emitter.y };
    pipes.push(
      makePipe(
        "flow",
        `Flow → ${emitter.label}`,
        spineRoute(hubPoint, flowTarget, spineY, index % 2 === 0 ? -0.06 : -0.1),
        floor,
      ),
      makePipe(
        "return",
        `Return ← ${emitter.label}`,
        spineRoute(returnTarget, hubPoint, spineY, index % 2 === 0 ? 0.06 : 0.1),
        floor,
      ),
    );
  });

  const draft: HeatingSystemLayout = {
    systemOptionId,
    plants,
    pipes,
    emitters,
    emitterMode,
    updatedAt: new Date().toISOString(),
  };

  // UFH mode: replace rectangular zones + stub tails with serpentine circuits + manifold tails.
  if (emitterMode === "ufh" && emitters.some((e) => e.kind === "ufh")) {
    return buildUfhCircuitsOnLayout(project, draft, { pattern: "serpentine" }).layout;
  }

  return draft;
}

export function pipeStroke(
  kind: HeatingPipeKind,
  diameterMm?: number,
): { stroke: string; dash?: string; width: number } {
  const sizeBoost = diameterMm === 28 ? 1.35 : diameterMm === 22 ? 1.1 : diameterMm === 15 ? 0.85 : 1;
  const base = (() => {
    switch (kind) {
      case "flow":
        return { stroke: "#dc2626", width: 3.2 };
      case "return":
        return { stroke: "#2563eb", width: 3.2 };
      case "refrigerant":
        return { stroke: "#7c3aed", width: 4, dash: "8 4" };
      case "gas":
        return { stroke: "#ca8a04", width: 3.5, dash: "5 4" };
      case "oil":
        return { stroke: "#92400e", width: 3.5, dash: "6 3" };
      case "dhw":
        return { stroke: "#0891b2", width: 3 };
      case "primary":
      default:
        return { stroke: "#157fa8", width: 3.5 };
    }
  })();
  return { ...base, width: Number((base.width * sizeBoost).toFixed(2)) };
}

export function plantFill(kind: HeatingPlantKind): string {
  switch (kind) {
    case "outdoor_unit":
      return "#157fa8";
    case "boiler":
    case "electric_boiler":
      return "#0e5f7f";
    case "cylinder":
    case "buffer":
      return "#0284c7";
    case "manifold":
      return "#334155";
    case "oil_tank":
    case "lpg_tank":
      return "#7c2d12";
    default:
      return "#475569";
  }
}

export function movePlant(layout: HeatingSystemLayout, plantId: string, x: number, y: number): HeatingSystemLayout {
  return {
    ...layout,
    plants: layout.plants.map((plant) =>
      plant.id === plantId ? { ...plant, x, y, placedByUser: true } : plant,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function moveEmitter(
  layout: HeatingSystemLayout,
  emitterId: string,
  x: number,
  y: number,
): HeatingSystemLayout {
  return {
    ...layout,
    emitters: (layout.emitters ?? []).map((emitter) =>
      emitter.id === emitterId ? { ...emitter, x, y } : emitter,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function movePipePoint(
  layout: HeatingSystemLayout,
  pipeId: string,
  pointIndex: number,
  x: number,
  y: number,
): HeatingSystemLayout {
  return {
    ...layout,
    pipes: layout.pipes.map((pipe) => {
      if (pipe.id !== pipeId) return pipe;
      return {
        ...pipe,
        points: pipe.points.map((point, index) => (index === pointIndex ? { x, y } : point)),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

export function translatePipe(layout: HeatingSystemLayout, pipeId: string, dx: number, dy: number): HeatingSystemLayout {
  return {
    ...layout,
    pipes: layout.pipes.map((pipe) => {
      if (pipe.id !== pipeId) return pipe;
      return {
        ...pipe,
        points: pipe.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/** Place a surveyed (existing) radiator on a room wall. */
export function placeSurveyedRadiatorOnWall(
  room: HeatDesignRoom,
  wallIndex: number,
  t: number,
  radiator?: { id: string; model: string; outputWatts: number } | null,
): HeatDesignRoom {
  const edges = edgesOf(room);
  const edge = edges[wallIndex] ?? edges[0];
  if (!edge) return room;
  const widthM = Math.min(1.6, Math.max(0.6, edge.len * 0.32));
  const emitter = {
    id: uid("srad"),
    kind: "radiator" as const,
    wallIndex: edge.index,
    t: Math.min(0.85, Math.max(0.15, t)),
    widthM,
    depthM: 0.14,
    heightM: 0.6,
    radiatorId: radiator?.id,
    outputWatts: radiator?.outputWatts,
    label: radiator ? `${radiator.model} · ${radiator.outputWatts}W` : "Radiator",
  };
  return {
    ...room,
    selectedRadiatorId: radiator?.id ?? room.selectedRadiatorId,
    surveyedEmitters: [...(room.surveyedEmitters ?? []), emitter],
  };
}

/** Geometry helper for drawing a surveyed radiator along a wall. */
export function surveyedEmitterGeom(room: HeatDesignRoom, emitter: NonNullable<HeatDesignRoom["surveyedEmitters"]>[number]) {
  const edges = edgesOf(room);
  const edge = edges[emitter.wallIndex] ?? edges[0]!;
  const point = pointOnEdge(edge, emitter.t, emitter.depthM / 2 + 0.04);
  const rotationDeg = (Math.atan2(edge.uy, edge.ux) * 180) / Math.PI;
  return { x: point.x, y: point.y, rotationDeg, widthM: emitter.widthM, depthM: emitter.depthM };
}

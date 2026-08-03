import { pickRadiatorForRoom } from "./calc";
import { dist, polygonBounds, roomPolygon, roomWallExterior } from "./geometry";
import { heatingSystemOptions, type HeatingSystemKind } from "./systems";
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
  };
}

function makePipe(
  kind: HeatingPipeKind,
  label: string,
  points: PlanPoint[],
  floorLevel: FloorLevel,
): HeatingPipeRun {
  return {
    id: uid(`pipe-${kind}`),
    kind,
    label,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    floorLevel,
  };
}

function plantSizes(kind: HeatingPlantKind) {
  if (kind === "outdoor_unit") return { widthM: 1.05, depthM: 0.42 };
  if (kind === "cylinder" || kind === "buffer") return { widthM: 0.55, depthM: 0.55 };
  if (kind === "oil_tank" || kind === "lpg_tank") return { widthM: 1.2, depthM: 0.7 };
  if (kind === "manifold") return { widthM: 0.5, depthM: 0.18 };
  return { widthM: 0.48, depthM: 0.32 };
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
      ? `${rad.model} · ${room.name || "Room"}`
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

/**
 * Seed a designed heating layout: spaced plant, outdoor unit kept on-canvas,
 * radiators / UFH in each room, and tidy spine pipe routes.
 */
export function seedHeatingLayout(
  project: HeatDesignProject,
  systemOptionId: string,
  emitterMode: HeatingEmitterMode = "mixed",
): HeatingSystemLayout {
  const kind = kindForOption(systemOptionId);
  const floor: FloorLevel = project.activeFloor ?? "ground";
  const plantRoom = pickPlantRoom(project.rooms, floor) ?? project.rooms[0];
  const plants: HeatingPlantItem[] = [];
  const pipes: HeatingPipeRun[] = [];

  if (!plantRoom) {
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
    plants.push(makePlant(item.kind, item.label, slot, floor, plantSizes(item.kind)));
  });

  if (kind === "ashp" || kind === "hybrid") {
    plants.push(makePlant("outdoor_unit", "Outdoor unit", outdoor, floor, plantSizes("outdoor_unit")));
  } else if (kind === "oil" || kind === "lpg") {
    plants.push(
      makePlant(
        kind === "oil" ? "oil_tank" : "lpg_tank",
        kind === "oil" ? "Oil tank" : "LPG tank",
        outdoor,
        floor,
        plantSizes(kind === "oil" ? "oil_tank" : "lpg_tank"),
      ),
    );
  }

  const cylinder = plants.find((p) => p.kind === "cylinder");
  const manifold = plants.find((p) => p.kind === "manifold");
  const boiler = plants.find((p) => p.kind === "boiler" || p.kind === "electric_boiler");
  const ou = plants.find((p) => p.kind === "outdoor_unit" || p.kind === "oil_tank" || p.kind === "lpg_tank");

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
    const meter = outdoorAnchor(plantRoom, 0.5);
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
  if (cylinder && manifold) {
    pipes.push(
      makePipe(
        "primary",
        "Cylinder → manifold",
        manhattanRoute({ x: cylinder.x, y: cylinder.y }, { x: manifold.x, y: manifold.y }, true),
        floor,
      ),
    );
  }

  const hub = manifold ?? boiler ?? cylinder;
  const hubPoint = hub ? { x: hub.x, y: hub.y } : roomCentroid(plantRoom);

  emitters.forEach((emitter, index) => {
    if (emitter.kind === "ufh") {
      // Short tails into the zone from the spine
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

  return {
    systemOptionId,
    plants,
    pipes,
    emitters,
    emitterMode,
    updatedAt: new Date().toISOString(),
  };
}

export function pipeStroke(kind: HeatingPipeKind): { stroke: string; dash?: string; width: number } {
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
      return { stroke: "#0f766e", width: 3.5 };
  }
}

export function plantFill(kind: HeatingPlantKind): string {
  switch (kind) {
    case "outdoor_unit":
      return "#0f766e";
    case "boiler":
    case "electric_boiler":
      return "#b45309";
    case "cylinder":
    case "buffer":
      return "#0369a1";
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
    plants: layout.plants.map((plant) => (plant.id === plantId ? { ...plant, x, y } : plant)),
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

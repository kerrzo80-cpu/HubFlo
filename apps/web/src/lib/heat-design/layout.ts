import { heatingSystemOptions, type HeatingSystemKind } from "./systems";
import { dist, polygonBounds, roomPolygon, roomWallExterior } from "./geometry";
import type {
  FloorLevel,
  HeatDesignProject,
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

export function roomCentroid(room: HeatDesignProject["rooms"][number]) {
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

/** Midpoint of the longest exterior wall, offset outward by metres. */
export function outdoorAnchor(room: HeatDesignProject["rooms"][number], offsetM: number): PlanPoint {
  const polygon = roomPolygon(room);
  const exterior = roomWallExterior(room, polygon.length);
  let bestI = 0;
  let bestLen = -1;
  for (let i = 0; i < polygon.length; i += 1) {
    if (!exterior[i]) continue;
    const len = dist(polygon[i]!, polygon[(i + 1) % polygon.length]!);
    if (len > bestLen) {
      bestLen = len;
      bestI = i;
    }
  }
  const a = polygon[bestI]!;
  const b = polygon[(bestI + 1) % polygon.length]!;
  const len = dist(a, b) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Prefer outside the room: test both normals against centroid
  const c = roomCentroid(room);
  const toMid = { x: mid.x - c.x, y: mid.y - c.y };
  const outward = toMid.x * nx + toMid.y * ny >= 0 ? 1 : -1;
  return {
    x: mid.x + nx * offsetM * outward,
    y: mid.y + ny * offsetM * outward,
  };
}

function insideNearWall(room: HeatDesignProject["rooms"][number], inset = 0.55): PlanPoint {
  const polygon = roomPolygon(room);
  const exterior = roomWallExterior(room, polygon.length);
  let bestI = exterior.findIndex(Boolean);
  if (bestI < 0) bestI = 0;
  const a = polygon[bestI]!;
  const b = polygon[(bestI + 1) % polygon.length]!;
  const len = dist(a, b) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const c = roomCentroid(room);
  const toMid = { x: mid.x - c.x, y: mid.y - c.y };
  const outward = toMid.x * nx + toMid.y * ny >= 0 ? 1 : -1;
  return {
    x: mid.x - nx * inset * outward,
    y: mid.y - ny * inset * outward,
  };
}

/** Orthogonal (Manhattan) route via one elbow. */
export function manhattanRoute(from: PlanPoint, to: PlanPoint, preferHorizontalFirst = true): PlanPoint[] {
  if (Math.abs(from.x - to.x) < 0.05 || Math.abs(from.y - to.y) < 0.05) {
    return [
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    ];
  }
  const elbow = preferHorizontalFirst
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
  return [
    { x: from.x, y: from.y },
    elbow,
    { x: to.x, y: to.y },
  ];
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
  if (kind === "outdoor_unit") return { widthM: 1.1, depthM: 0.45 };
  if (kind === "cylinder" || kind === "buffer") return { widthM: 0.6, depthM: 0.6 };
  if (kind === "oil_tank" || kind === "lpg_tank") return { widthM: 1.4, depthM: 0.8 };
  if (kind === "manifold") return { widthM: 0.45, depthM: 0.2 };
  return { widthM: 0.5, depthM: 0.35 };
}

function kindForOption(optionId: string): HeatingSystemKind {
  return heatingSystemOptions.find((item) => item.id === optionId)?.kind ?? "ashp";
}

/**
 * Seed a movable heating layout (plant + pipework) for the chosen system on the floor plan.
 * Positions are suggestions — drag on the plan to suit the property.
 */
export function seedHeatingLayout(project: HeatDesignProject, systemOptionId: string): HeatingSystemLayout {
  const kind = kindForOption(systemOptionId);
  const floor: FloorLevel = project.activeFloor ?? "ground";
  const plantRoom = pickPlantRoom(project.rooms, floor) ?? project.rooms[0];
  const plants: HeatingPlantItem[] = [];
  const pipes: HeatingPipeRun[] = [];

  if (!plantRoom) {
    return { systemOptionId, plants, pipes, updatedAt: new Date().toISOString() };
  }

  const indoor = insideNearWall(plantRoom, 0.65);
  const outdoor = outdoorAnchor(plantRoom, Math.max(1.2, project.outdoorUnitDistanceM || 3));
  const cylinderPoint = {
    x: indoor.x + 0.85,
    y: indoor.y,
  };
  const manifoldPoint = {
    x: cylinderPoint.x + 0.55,
    y: cylinderPoint.y + 0.35,
  };

  if (kind === "ashp" || kind === "hybrid") {
    plants.push(
      makePlant("outdoor_unit", "Outdoor unit", outdoor, floor, plantSizes("outdoor_unit")),
      makePlant("cylinder", `${project.cylinderLitres || 210}L cylinder`, cylinderPoint, floor, plantSizes("cylinder")),
      makePlant("manifold", "Heating manifold", manifoldPoint, floor, plantSizes("manifold")),
    );
    if (kind === "hybrid") {
      plants.push(
        makePlant("boiler", "Gas boiler (peak)", { x: indoor.x, y: indoor.y + 0.7 }, floor, plantSizes("boiler")),
      );
    }
    pipes.push(
      makePipe("refrigerant", "Refrigerant / primary", manhattanRoute(outdoor, cylinderPoint, true), floor),
      makePipe("primary", "Cylinder → manifold", manhattanRoute(cylinderPoint, manifoldPoint, false), floor),
    );
  } else if (kind === "gas" || kind === "electric") {
    const boilerKind: HeatingPlantKind = kind === "electric" ? "electric_boiler" : "boiler";
    plants.push(
      makePlant(boilerKind, kind === "electric" ? "Electric boiler" : "Gas boiler", indoor, floor, plantSizes("boiler")),
      makePlant("cylinder", `${project.cylinderLitres || 210}L cylinder`, cylinderPoint, floor, plantSizes("cylinder")),
      makePlant("manifold", "Heating manifold", manifoldPoint, floor, plantSizes("manifold")),
    );
    if (kind === "gas") {
      const meter = outdoorAnchor(plantRoom, 0.4);
      pipes.push(makePipe("gas", "Gas supply", manhattanRoute(meter, indoor, true), floor));
    }
    pipes.push(
      makePipe("primary", "Boiler → cylinder", manhattanRoute(indoor, cylinderPoint, true), floor),
      makePipe("primary", "Cylinder → manifold", manhattanRoute(cylinderPoint, manifoldPoint, false), floor),
    );
  } else if (kind === "oil" || kind === "lpg") {
    const tankKind: HeatingPlantKind = kind === "oil" ? "oil_tank" : "lpg_tank";
    plants.push(
      makePlant("boiler", kind === "oil" ? "Oil boiler" : "LPG boiler", indoor, floor, plantSizes("boiler")),
      makePlant(tankKind, kind === "oil" ? "Oil tank" : "LPG tank", outdoor, floor, plantSizes(tankKind)),
      makePlant("cylinder", `${project.cylinderLitres || 210}L cylinder`, cylinderPoint, floor, plantSizes("cylinder")),
      makePlant("manifold", "Heating manifold", manifoldPoint, floor, plantSizes("manifold")),
    );
    pipes.push(
      makePipe(kind === "oil" ? "oil" : "gas", kind === "oil" ? "Oil feed" : "LPG supply", manhattanRoute(outdoor, indoor, true), floor),
      makePipe("primary", "Boiler → cylinder", manhattanRoute(indoor, cylinderPoint, true), floor),
      makePipe("primary", "Cylinder → manifold", manhattanRoute(cylinderPoint, manifoldPoint, false), floor),
    );
  }

  const hub = plants.find((p) => p.kind === "manifold") ?? plants.find((p) => p.kind === "boiler" || p.kind === "electric_boiler");
  const hubPoint = hub ? { x: hub.x, y: hub.y } : manifoldPoint;
  const heatedRooms = project.rooms.filter((room) => (room.floorLevel ?? "ground") === floor);
  heatedRooms.forEach((room, index) => {
    const target = roomCentroid(room);
    // Slight offset so flow/return don't fully overlap
    const flowTarget = { x: target.x - 0.12, y: target.y - 0.08 };
    const returnTarget = { x: target.x + 0.12, y: target.y + 0.08 };
    pipes.push(
      makePipe(
        "flow",
        `Flow → ${room.name || "room"}`,
        manhattanRoute(hubPoint, flowTarget, index % 2 === 0),
        floor,
      ),
      makePipe(
        "return",
        `Return ← ${room.name || "room"}`,
        manhattanRoute(returnTarget, hubPoint, index % 2 !== 0),
        floor,
      ),
    );
  });

  // Expand bounds slightly so outdoor plant sits in plan extent
  const allPoints = [
    ...plants.map((p) => ({ x: p.x, y: p.y })),
    ...pipes.flatMap((pipe) => pipe.points),
  ];
  if (allPoints.length) {
    polygonBounds(allPoints);
  }

  return {
    systemOptionId,
    plants,
    pipes,
    updatedAt: new Date().toISOString(),
  };
}

export function pipeStroke(kind: HeatingPipeKind): { stroke: string; dash?: string; width: number } {
  switch (kind) {
    case "flow":
      return { stroke: "#dc2626", width: 3.5 };
    case "return":
      return { stroke: "#2563eb", width: 3.5 };
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
      return { stroke: "#0f766e", width: 4 };
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateRoomHeatLoss,
  ceilingTypes,
  dist,
  edgeLengths,
  edgeParam,
  floorTypes,
  glazingTypes,
  insertVertexOnEdge,
  lShapePolygon,
  moveEmitter,
  movePipePoint,
  movePlant,
  numberFromInput,
  openingOnEdge,
  pickRadiatorForRoom,
  pipeStroke,
  placeSurveyedRadiatorOnWall,
  plantFill,
  polygonBounds,
  readPlanUnderlayFile,
  removePlantFromLayout,
  roomPolygon,
  roomTypes,
  roomWallExterior,
  surveyedEmitterGeom,
  syncRoomFromPolygon,
  translatePolygon,
  wallTypes,
  wattsLabel,
  type FloorLevel,
  type HeatDesignRoom,
  type HeatingEmitterMode,
  type HeatingPlantKind,
  type HeatingSystemLayout,
  type PlanOpening,
  type PlanPoint,
  type PlanUnderlay,
} from "@/lib/heat-design";

type FloorPlanCanvasProps = {
  rooms: HeatDesignRoom[];
  selectedRoomId: string | null;
  activeFloor: FloorLevel;
  designExternalTemp?: number;
  summary?: { heatLossW: number; floorAreaM2: number; roomCount: number };
  onSelectRoom: (roomId: string | null) => void;
  onPatchRoom: (roomId: string, patch: Partial<HeatDesignRoom>) => void;
  onDeleteRoom: (roomId: string) => void;
  onChangeFloor: (floor: FloorLevel) => void;
  onAddRoom?: () => void;
  onPlaceRoom?: (roomType: string, planX: number, planY: number, lengthM?: number, widthM?: number) => void;
  onReconcileWalls?: () => void;
  /** Chosen-system plant + pipework overlay */
  heatingLayout?: HeatingSystemLayout | null;
  layoutMode?: boolean;
  onLayoutModeChange?: (on: boolean) => void;
  onPatchLayout?: (layout: HeatingSystemLayout) => void;
  onRegenerateLayout?: () => void;
  /** Place boiler / cylinder / manifold / outdoor unit by clicking the plan */
  onPlacePlant?: (kind: HeatingPlantKind, x: number, y: number) => void;
  layoutSystemLabel?: string;
  emitterMode?: HeatingEmitterMode;
  onEmitterModeChange?: (mode: HeatingEmitterMode) => void;
  onFinishSurveyedPlan?: () => void;
  planUnderlay?: PlanUnderlay | null;
  onPlanUnderlayChange?: (underlay: PlanUnderlay | null) => void;
  /** Pull first PDF/image from the linked Takeoff project */
  onUseTakeoffDrawing?: () => void;
  takeoffDrawingBusy?: boolean;
  linkedTakeoffRef?: string | null;
};

const BASE_SCALE = 90;
const PAD = 56;
const SNAP_M = 0.15;

type PlaceTool = "window" | "door" | "rooflight" | "radiator" | null;
type PlantPlaceTool = HeatingPlantKind | null;

const PLANT_PLACE_OPTIONS: Array<{ kind: HeatingPlantKind; label: string }> = [
  { kind: "boiler", label: "Boiler" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "manifold", label: "Manifold" },
  { kind: "outdoor_unit", label: "Outdoor unit" },
];

type DragState =
  | { mode: "move"; roomId: string; origin: PlanPoint[]; grab: PlanPoint }
  | { mode: "vertex"; roomId: string; index: number; polygon: PlanPoint[] }
  | { mode: "resize-rect"; roomId: string; corner: number; origin: PlanPoint[] }
  | { mode: "edge"; roomId: string; edgeIndex: number; origin: PlanPoint[] }
  | { mode: "draw-room"; roomType: string; start: PlanPoint; current: PlanPoint }
  | { mode: "opening"; roomId: string; openingId: string; wallIndex: number }
  | { mode: "plant"; plantId: string }
  | { mode: "pipe-point"; pipeId: string; pointIndex: number }
  | { mode: "pipe-move"; pipeId: string; origin: PlanPoint[]; grab: PlanPoint }
  | { mode: "emitter"; emitterId: string }
  | null;

function mm(metres: number) {
  return `${Math.round(metres * 1000)} mm`;
}

function snap(value: number, anchors: number[]) {
  let best = value;
  let bestDist = SNAP_M;
  for (const anchor of anchors) {
    const d = Math.abs(value - anchor);
    if (d < bestDist) {
      best = anchor;
      bestDist = d;
    }
  }
  return best;
}

/** Prefer whole-edge lock when translating a room against neighbours. */
function snapTranslation(origin: PlanPoint[], dx: number, dy: number, anchors: { xs: number[]; ys: number[] }) {
  let bestDx = dx;
  let bestDy = dy;
  let bestScore = Number.POSITIVE_INFINITY;
  const candidatesX = [dx];
  const candidatesY = [dy];
  for (const p of origin) {
    for (const ax of anchors.xs) candidatesX.push(ax - p.x);
    for (const ay of anchors.ys) candidatesY.push(ay - p.y);
  }
  for (const cx of candidatesX) {
    if (Math.abs(cx - dx) > SNAP_M * 1.4) continue;
    for (const cy of candidatesY) {
      if (Math.abs(cy - dy) > SNAP_M * 1.4) continue;
      let score = Math.abs(cx - dx) + Math.abs(cy - dy);
      const moved = translatePolygon(origin, cx, cy);
      let hits = 0;
      for (const p of moved) {
        if (anchors.xs.some((v) => Math.abs(v - p.x) < 0.001)) hits += 1;
        if (anchors.ys.some((v) => Math.abs(v - p.y) < 0.001)) hits += 1;
      }
      score -= hits * 0.02;
      if (score < bestScore) {
        bestScore = score;
        bestDx = cx;
        bestDy = cy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

export function FloorPlanCanvas({
  rooms,
  selectedRoomId,
  activeFloor,
  designExternalTemp = -3,
  summary,
  onSelectRoom,
  onPatchRoom,
  onDeleteRoom,
  onChangeFloor,
  onAddRoom,
  onPlaceRoom,
  onReconcileWalls,
  heatingLayout = null,
  layoutMode = false,
  onLayoutModeChange,
  onPatchLayout,
  onRegenerateLayout,
  onPlacePlant,
  layoutSystemLabel,
  emitterMode = "mixed",
  onEmitterModeChange,
  onFinishSurveyedPlan,
  planUnderlay = null,
  onPlanUnderlayChange,
  onUseTakeoffDrawing,
  takeoffDrawingBusy = false,
  linkedTakeoffRef = null,
}: FloorPlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const underlayInputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [placeTool, setPlaceTool] = useState<PlaceTool>(null);
  const [placeRoomType, setPlaceRoomType] = useState<string | null>(null);
  const [plantPlaceTool, setPlantPlaceTool] = useState<PlantPlaceTool>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [selectedPipeId, setSelectedPipeId] = useState<string | null>(null);
  const [selectedEmitterId, setSelectedEmitterId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [roomEdit, setRoomEdit] = useState<{ roomId: string; field: "name" | "height"; value: string } | null>(null);

  function submitRoomEdit() {
    if (!roomEdit) return;
    const raw = roomEdit.value.trim();
    if (roomEdit.field === "name") {
      if (raw) onPatchRoom(roomEdit.roomId, { name: raw });
    } else {
      const metres = Number(raw) / 1000;
      if (Number.isFinite(metres) && metres > 1) onPatchRoom(roomEdit.roomId, { height: String(metres) });
    }
    setRoomEdit(null);
  }

  const floorRooms = useMemo(
    () => rooms.filter((room) => (room.floorLevel ?? "ground") === activeFloor),
    [rooms, activeFloor],
  );
  const belowFloor: FloorLevel | null =
    activeFloor === "first" ? "ground" : activeFloor === "second" ? "first" : activeFloor === "ground" ? "cellar" : null;
  const ghostRooms = useMemo(
    () => (belowFloor ? rooms.filter((room) => (room.floorLevel ?? "ground") === belowFloor) : []),
    [rooms, belowFloor],
  );

  const floorPlants = useMemo(
    () => (heatingLayout?.plants ?? []).filter((plant) => (plant.floorLevel ?? "ground") === activeFloor),
    [heatingLayout, activeFloor],
  );
  const floorPipes = useMemo(
    () => (heatingLayout?.pipes ?? []).filter((pipe) => (pipe.floorLevel ?? "ground") === activeFloor),
    [heatingLayout, activeFloor],
  );
  const floorEmitters = useMemo(
    () => (heatingLayout?.emitters ?? []).filter((item) => (item.floorLevel ?? "ground") === activeFloor),
    [heatingLayout, activeFloor],
  );

  const scale = BASE_SCALE * zoom;

  const bounds = useMemo(() => {
    let maxX = 10;
    let maxY = 8;
    let minX = 0;
    let minY = 0;
    for (const room of floorRooms) {
      const box = polygonBounds(roomPolygon(room));
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX + 1.2);
      maxY = Math.max(maxY, box.maxY + 1.2);
    }
    for (const plant of floorPlants) {
      const halfW = (plant.widthM ?? 0.5) / 2;
      const halfD = (plant.depthM ?? 0.35) / 2;
      minX = Math.min(minX, plant.x - halfW - 0.3);
      minY = Math.min(minY, plant.y - halfD - 0.3);
      maxX = Math.max(maxX, plant.x + halfW + 0.8);
      maxY = Math.max(maxY, plant.y + halfD + 0.8);
    }
    for (const emitter of floorEmitters) {
      const halfW = emitter.widthM / 2;
      const halfD = emitter.depthM / 2;
      minX = Math.min(minX, emitter.x - halfW);
      minY = Math.min(minY, emitter.y - halfD);
      maxX = Math.max(maxX, emitter.x + halfW);
      maxY = Math.max(maxY, emitter.y + halfD);
    }
    for (const pipe of floorPipes) {
      for (const p of pipe.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + 0.4);
        maxY = Math.max(maxY, p.y + 0.4);
      }
    }
    if (planUnderlay?.dataUrl) {
      minX = Math.min(minX, planUnderlay.originX);
      minY = Math.min(minY, planUnderlay.originY);
      maxX = Math.max(maxX, planUnderlay.originX + planUnderlay.widthM);
      maxY = Math.max(maxY, planUnderlay.originY + planUnderlay.heightM);
    }
    const originX = minX - 0.35;
    const originY = minY - 0.35;
    const metresW = maxX - originX + 0.5;
    const metresH = maxY - originY + 0.5;
    return {
      width: Math.max(640, metresW * scale + PAD * 2),
      height: Math.max(440, metresH * scale + PAD * 2),
      metresX: maxX,
      metresY: maxY,
      originX,
      originY,
    };
  }, [floorRooms, floorPlants, floorPipes, floorEmitters, scale, planUnderlay]);

  function px(x: number) {
    return PAD + (x - bounds.originX) * scale;
  }
  function py(y: number) {
    return PAD + (y - bounds.originY) * scale;
  }

  function clientToMetres(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = bounds.width / rect.width;
    const sy = bounds.height / rect.height;
    return {
      x: ((clientX - rect.left) * sx - PAD) / scale + bounds.originX,
      y: ((clientY - rect.top) * sy - PAD) / scale + bounds.originY,
    };
  }

  function fitZoom() {
    const wrap = wrapRef.current;
    if (!wrap) {
      setZoom(1);
      return;
    }
    const avail = Math.max(320, wrap.clientWidth - 24);
    const natural = bounds.width / zoom;
    const next = Math.max(0.45, Math.min(1.8, (avail / natural) * 0.96));
    setZoom(Number(next.toFixed(2)));
  }

  useEffect(() => {
    if (!heatingLayout?.updatedAt) return;
    const timer = window.setTimeout(() => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const avail = Math.max(320, wrap.clientWidth - 24);
      const metresW = bounds.metresX - bounds.originX + 0.5;
      const natural = metresW * BASE_SCALE + PAD * 2;
      const next = Math.max(0.5, Math.min(1.35, (avail / natural) * 0.94));
      setZoom(Number(next.toFixed(2)));
    }, 40);
    return () => window.clearTimeout(timer);
    // Fit when a new layout is seeded so outdoor unit / pipes stay in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatingLayout?.updatedAt]);

  const anchors = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of floorRooms) {
      for (const p of roomPolygon(room)) {
        xs.push(p.x);
        ys.push(p.y);
      }
    }
    return { xs, ys };
  }, [floorRooms]);

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      const point = clientToMetres(event.clientX, event.clientY);
      if (drag?.mode === "draw-room") {
        setGuides({ x: [drag.start.x, point.x], y: [drag.start.y, point.y] });
        setDrag({ ...drag, current: point });
        return;
      }
      if (drag?.mode === "plant" && heatingLayout && onPatchLayout) {
        onPatchLayout(movePlant(heatingLayout, drag.plantId, point.x, point.y));
        return;
      }
      if (drag?.mode === "emitter" && heatingLayout && onPatchLayout) {
        onPatchLayout(moveEmitter(heatingLayout, drag.emitterId, point.x, point.y));
        return;
      }
      if (drag?.mode === "pipe-point" && heatingLayout && onPatchLayout) {
        onPatchLayout(movePipePoint(heatingLayout, drag.pipeId, drag.pointIndex, point.x, point.y));
        return;
      }
      if (drag?.mode === "pipe-move" && heatingLayout && onPatchLayout) {
        const dx = point.x - drag.grab.x;
        const dy = point.y - drag.grab.y;
        onPatchLayout({
          ...heatingLayout,
          pipes: heatingLayout.pipes.map((pipe) =>
            pipe.id === drag.pipeId
              ? { ...pipe, points: drag.origin.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
              : pipe,
          ),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (drag?.mode === "move") {
        const rawDx = point.x - drag.grab.x;
        const rawDy = point.y - drag.grab.y;
        const foreignXs = anchors.xs.filter((v) => !drag.origin.some((o) => Math.abs(o.x - v) < 0.001));
        const foreignYs = anchors.ys.filter((v) => !drag.origin.some((o) => Math.abs(o.y - v) < 0.001));
        const locked = snapTranslation(drag.origin, rawDx, rawDy, { xs: foreignXs, ys: foreignYs });
        const uniform = translatePolygon(drag.origin, locked.dx, locked.dy);
        const guideX = [...new Set(uniform.map((p) => p.x).filter((x) => foreignXs.some((v) => Math.abs(v - x) < 0.001)))];
        const guideY = [...new Set(uniform.map((p) => p.y).filter((y) => foreignYs.some((v) => Math.abs(v - y) < 0.001)))];
        setGuides({ x: guideX, y: guideY });
        const room = floorRooms.find((r) => r.id === drag.roomId);
        if (!room) return;
        onPatchRoom(drag.roomId, syncRoomFromPolygon(room, uniform));
      } else if (drag?.mode === "vertex") {
        let x = Math.max(0, point.x);
        let y = Math.max(0, point.y);
        const sx = snap(
          x,
          anchors.xs.filter((_, i) => true),
        );
        const sy = snap(y, anchors.ys);
        const guideX: number[] = [];
        const guideY: number[] = [];
        if (Math.abs(sx - x) < SNAP_M) {
          x = sx;
          guideX.push(x);
        }
        if (Math.abs(sy - y) < SNAP_M) {
          y = sy;
          guideY.push(y);
        }
        setGuides({ x: guideX, y: guideY });
        const next = drag.polygon.map((p, i) => (i === drag.index ? { x, y } : p));
        const room = floorRooms.find((r) => r.id === drag.roomId);
        if (!room) return;
        onPatchRoom(drag.roomId, syncRoomFromPolygon(room, next));
      } else if (drag?.mode === "resize-rect") {
        const room = floorRooms.find((r) => r.id === drag.roomId);
        if (!room) return;
        const origin = drag.origin;
        const opposite = origin[(drag.corner + 2) % 4]!;
        let x = Math.max(0.4, point.x);
        let y = Math.max(0.4, point.y);
        const sx = snap(x, anchors.xs);
        const sy = snap(y, anchors.ys);
        if (Math.abs(sx - x) < SNAP_M) x = sx;
        if (Math.abs(sy - y) < SNAP_M) y = sy;
        const minX = Math.min(opposite.x, x);
        const maxX = Math.max(opposite.x, x);
        const minY = Math.min(opposite.y, y);
        const maxY = Math.max(opposite.y, y);
        if (maxX - minX < 0.8 || maxY - minY < 0.8) return;
        const next = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ];
        setGuides({ x: [minX, maxX], y: [minY, maxY] });
        onPatchRoom(drag.roomId, syncRoomFromPolygon(room, next));
      } else if (drag?.mode === "edge") {
        const room = floorRooms.find((r) => r.id === drag.roomId);
        if (!room) return;
        const origin = drag.origin;
        const i0 = drag.edgeIndex;
        const i1 = (drag.edgeIndex + 1) % origin.length;
        const a = origin[i0]!;
        const b = origin[i1]!;
        const next = origin.map((p) => ({ ...p }));
        const horizontal = Math.abs(a.y - b.y) < 0.05;
        const vertical = Math.abs(a.x - b.x) < 0.05;
        if (horizontal) {
          let y = Math.max(0.2, point.y);
          const sy = snap(y, anchors.ys);
          if (Math.abs(sy - y) < SNAP_M) y = sy;
          next[i0] = { x: a.x, y };
          next[i1] = { x: b.x, y };
          setGuides({ x: [], y: [y] });
        } else if (vertical) {
          let x = Math.max(0.2, point.x);
          const sx = snap(x, anchors.xs);
          if (Math.abs(sx - x) < SNAP_M) x = sx;
          next[i0] = { x, y: a.y };
          next[i1] = { x, y: b.y };
          setGuides({ x: [x], y: [] });
        } else {
          // Free edge: move both endpoints along the edge normal toward the pointer.
          const len = dist(a, b) || 1;
          const nx = -(b.y - a.y) / len;
          const ny = (b.x - a.x) / len;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const push = (point.x - mid.x) * nx + (point.y - mid.y) * ny;
          next[i0] = { x: a.x + nx * push, y: a.y + ny * push };
          next[i1] = { x: b.x + nx * push, y: b.y + ny * push };
          setGuides({ x: [], y: [] });
        }
        const bounds = polygonBounds(next);
        if (bounds.width < 0.8 || bounds.height < 0.8) return;
        onPatchRoom(drag.roomId, syncRoomFromPolygon(room, next));
      } else if (drag?.mode === "opening") {
        const room = floorRooms.find((r) => r.id === drag.roomId);
        if (!room) return;
        const polygon = roomPolygon(room);
        const a = polygon[drag.wallIndex]!;
        const b = polygon[(drag.wallIndex + 1) % polygon.length]!;
        const t = edgeParam(a, b, point);
        onPatchRoom(drag.roomId, {
          openings: (room.openings ?? []).map((opening) =>
            opening.id === drag.openingId ? { ...opening, t, wallIndex: drag.wallIndex } : opening,
          ),
        });
      }
    }

    function onUp() {
      if (drag?.mode === "draw-room" && onPlaceRoom) {
        const minX = Math.min(drag.start.x, drag.current.x);
        const minY = Math.min(drag.start.y, drag.current.y);
        const length = Math.abs(drag.current.x - drag.start.x);
        const width = Math.abs(drag.current.y - drag.start.y);
        if (length >= 0.9 && width >= 0.9) {
          onPlaceRoom(drag.roomType, Math.max(0, minX), Math.max(0, minY), length, width);
        } else {
          onPlaceRoom(drag.roomType, Math.max(0, drag.start.x), Math.max(0, drag.start.y));
        }
        setPlaceRoomType(null);
      }
      const shouldReconcile =
        drag?.mode === "move" ||
        drag?.mode === "vertex" ||
        drag?.mode === "resize-rect" ||
        drag?.mode === "edge" ||
        drag?.mode === "draw-room";
      setDrag(null);
      setGuides({ x: [], y: [] });
      if (shouldReconcile) onReconcileWalls?.();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, floorRooms, anchors, onPatchRoom, onPatchLayout, onReconcileWalls, heatingLayout, bounds.width, bounds.height]);

  const selected = floorRooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedPoly = selected ? roomPolygon(selected) : [];
  const selectedPlant = floorPlants.find((plant) => plant.id === selectedPlantId) ?? null;
  const selectedPipe = floorPipes.find((pipe) => pipe.id === selectedPipeId) ?? null;
  const selectedEmitter = floorEmitters.find((item) => item.id === selectedEmitterId) ?? null;
  const selectedOpening = selected
    ? (selected.openings ?? []).find((opening) => opening.id === selectedOpeningId) ?? null
    : null;
  const selectedLoss = selected
    ? calculateRoomHeatLoss(
        { ...selected, meanWaterTemperature: selected.meanWaterTemperature || "45" },
        designExternalTemp,
      )
    : null;
  const showLayout = Boolean(
    heatingLayout && (layoutMode || floorPlants.length || floorPipes.length || floorEmitters.length),
  );

  function addAlcoveOnEdge(room: HeatDesignRoom, edgeIndex: number) {
    const polygon = roomPolygon(room);
    const a = polygon[edgeIndex]!;
    const b = polygon[(edgeIndex + 1) % polygon.length]!;
    const len = dist(a, b) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    // outward normal roughly — push alcove "outside" using exterior flag
    const exterior = roomWallExterior(room, polygon.length);
    const sign = exterior[edgeIndex] ? -1 : 1;
    const depth = 0.55;
    const inset = 0.28;
    const p1 = { x: a.x + ux * len * inset, y: a.y + uy * len * inset };
    const p2 = { x: p1.x + nx * depth * sign, y: p1.y + ny * depth * sign };
    const p4 = { x: a.x + ux * len * (1 - inset), y: a.y + uy * len * (1 - inset) };
    const p3 = { x: p4.x + nx * depth * sign, y: p4.y + ny * depth * sign };
    const next = [...polygon];
    next.splice(edgeIndex + 1, 0, p1, p2, p3, p4);
    const wallExterior = roomWallExterior(room, polygon.length);
    const inserted = [true, true, true, true];
    const newExterior = [
      ...wallExterior.slice(0, edgeIndex),
      wallExterior[edgeIndex] ?? true,
      ...inserted,
      ...wallExterior.slice(edgeIndex + 1),
    ];
    // edge split: original edge becomes first stub + alcove sides + last stub — mark alcove exterior
    newExterior[edgeIndex] = wallExterior[edgeIndex] ?? true;
    onPatchRoom(room.id, syncRoomFromPolygon({ ...room, wallExterior: newExterior }, next));
    setSelectedEdge(edgeIndex + 1);
  }

  function toggleEdgeExterior(room: HeatDesignRoom, edgeIndex: number) {
    const polygon = roomPolygon(room);
    const wallExterior = [...roomWallExterior(room, polygon.length)];
    wallExterior[edgeIndex] = !wallExterior[edgeIndex];
    onPatchRoom(room.id, {
      wallExterior,
      exteriorWalls: wallExterior.filter(Boolean).length,
      exteriorFlags:
        polygon.length === 4
          ? [wallExterior[0]!, wallExterior[1]!, wallExterior[2]!, wallExterior[3]!]
          : room.exteriorFlags,
    });
  }

  function placeOpeningOnEdge(
    room: HeatDesignRoom,
    edgeIndex: number,
    point: PlanPoint,
    kind: "window" | "door" | "rooflight" | "radiator",
  ) {
    if (kind === "radiator") {
      const polygon = roomPolygon(room);
      const a = polygon[edgeIndex]!;
      const b = polygon[(edgeIndex + 1) % polygon.length]!;
      const t = edgeParam(a, b, point);
      const rad = pickRadiatorForRoom(
        { ...room, meanWaterTemperature: room.meanWaterTemperature || "45" },
        designExternalTemp,
      );
      onPatchRoom(
        room.id,
        placeSurveyedRadiatorOnWall(
          room,
          edgeIndex,
          t,
          rad ? { id: rad.id, model: rad.model, outputWatts: rad.outputWatts } : null,
        ),
      );
      setPlaceTool(null);
      return;
    }
    const polygon = roomPolygon(room);
    const a = polygon[edgeIndex]!;
    const b = polygon[(edgeIndex + 1) % polygon.length]!;
    const t = edgeParam(a, b, point);
    const opening: PlanOpening = {
      id: `op-${Date.now()}-${kind}`,
      wallIndex: edgeIndex,
      t,
      kind,
      widthM: kind === "door" ? 0.9 : kind === "rooflight" ? 0.8 : 1.2,
      heightM: kind === "door" ? 2.0 : kind === "rooflight" ? 0.8 : 1.2,
      materialId: room.glazingType,
    };
    onPatchRoom(room.id, { openings: [...(room.openings ?? []), opening] });
    setSelectedOpeningId(opening.id);
    setPlaceTool(null);
  }

  function patchSelectedOpening(patch: Partial<PlanOpening>) {
    if (!selected || !selectedOpeningId) return;
    onPatchRoom(selected.id, {
      openings: (selected.openings ?? []).map((opening) =>
        opening.id === selectedOpeningId ? { ...opening, ...patch } : opening,
      ),
    });
  }

  function makeLShape(room: HeatDesignRoom) {
    const box = polygonBounds(roomPolygon(room));
    const length = Math.max(2.4, box.width || numberFromInput(room.length, 3.2));
    const width = Math.max(2.4, box.height || numberFromInput(room.width, 2.4));
    const armLength = Math.min(length * 0.45, Math.max(1.1, length - 1.2));
    const armWidth = Math.min(width * 0.45, Math.max(1.1, width - 1.2));
    const polygon = lShapePolygon(box.minX || room.planX, box.minY || room.planY, length, width, armLength, armWidth);
    // Outer edges exterior; the two inner cut edges internal
    const wallExterior = [true, true, true, false, true, true];
    onPatchRoom(
      room.id,
      syncRoomFromPolygon(
        {
          ...room,
          wallExterior,
          roomType: room.roomType === "Living Room" ? "Hall" : room.roomType,
          name: room.name === "Room 1" || room.roomType === "Living Room" ? "Hall" : room.name,
        },
        polygon,
      ),
    );
  }

  function deleteSelectedOpening(room: HeatDesignRoom) {
    if (!selectedOpeningId) return;
    onPatchRoom(room.id, {
      openings: (room.openings ?? []).filter((opening) => opening.id !== selectedOpeningId),
    });
    setSelectedOpeningId(null);
  }

  return (
    <div className="hp-canvas-shell">
      <div className="hp-plan-workspace">
        <aside className="hp-palette" aria-label="Plan components">
          <p className="hp-palette-label">Rooms</p>
          <div className="hp-palette-list">
            {roomTypes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`hp-palette-item${placeRoomType === item.id ? " is-on" : ""}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/hd-room", item.id);
                  event.dataTransfer.effectAllowed = "copy";
                  setPlaceTool(null);
                  setPlantPlaceTool(null);
                  // Leave heating-layout lock so rooms can be drawn / moved.
                  if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
                  setPlaceRoomType(item.id);
                }}
                onClick={() => {
                  setPlaceTool(null);
                  setPlantPlaceTool(null);
                  if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
                  setPlaceRoomType((current) => (current === item.id ? null : item.id));
                }}
                title={`${item.id} · ${item.targetTemp}°C · ${item.airChanges} ACH — drag onto plan or click then draw`}
              >
                {item.id}
              </button>
            ))}
          </div>
          <p className="hp-palette-label">Openings & emitters</p>
          <div className="hp-palette-list hp-palette-row">
            {(
              [
                ["window", "Window"],
                ["door", "Door"],
                ["rooflight", "Roof light"],
                ["radiator", "Radiator"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`hp-palette-item${placeTool === id ? " is-on" : ""}`}
                disabled={!selected}
                onClick={() => {
                  setPlaceRoomType(null);
                  setPlantPlaceTool(null);
                  if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
                  setPlaceTool((current) => (current === id ? null : id));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hp-palette-label">Plant</p>
          <div className="hp-palette-list hp-palette-row">
            {PLANT_PLACE_OPTIONS.map((item) => (
              <button
                key={item.kind}
                type="button"
                className={`hp-palette-item${plantPlaceTool === item.kind ? " is-on" : ""}`}
                disabled={!onPlacePlant}
                onClick={() => {
                  setPlaceTool(null);
                  setPlaceRoomType(null);
                  // Plant click-place must not sticky-lock rooms (layout mode stays optional).
                  setPlantPlaceTool((current) => (current === item.kind ? null : item.kind));
                }}
                title={`Place ${item.label} — click the plan`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="hp-palette-hint">
            Draw rooms, then place boiler / cylinder / manifold where you want them. Route pipes keeps only your plant
            and rebuilds emitters + pipe runs. Optional PDF / PNG / JPG under the plan.
          </p>
          {onPlanUnderlayChange ? (
            <>
              <p className="hp-palette-label">Drawing</p>
              <div className="hp-palette-list hp-palette-row">
                <button
                  type="button"
                  className="hp-palette-item"
                  onClick={() => underlayInputRef.current?.click()}
                  title="Upload a PDF (first page) or plan photo (PNG / JPG / WebP)"
                >
                  {planUnderlay ? "Replace drawing" : "Upload PDF / photo"}
                </button>
                {onUseTakeoffDrawing ? (
                  <button
                    type="button"
                    className="hp-palette-item"
                    disabled={takeoffDrawingBusy}
                    onClick={() => onUseTakeoffDrawing()}
                    title={
                      linkedTakeoffRef
                        ? `Use first drawing from linked Takeoff ${linkedTakeoffRef}`
                        : "Send to Takeoff first, or link a takeoff, then reuse its PDF here"
                    }
                  >
                    {takeoffDrawingBusy ? "Loading…" : linkedTakeoffRef ? "Use Takeoff PDF" : "Open Takeoff…"}
                  </button>
                ) : null}
                {planUnderlay ? (
                  <button type="button" className="hp-palette-item" onClick={() => onPlanUnderlayChange(null)}>
                    Clear drawing
                  </button>
                ) : null}
              </div>
              {planUnderlay ? (
                <label className="hp-palette-hint" style={{ display: "block" }}>
                  Drawing fade{" "}
                  <input
                    type="range"
                    min={15}
                    max={85}
                    value={Math.round((planUnderlay.opacity ?? 0.45) * 100)}
                    onChange={(event) =>
                      onPlanUnderlayChange({
                        ...planUnderlay,
                        opacity: Number(event.target.value) / 100,
                      })
                    }
                  />
                </label>
              ) : null}
              <input
                ref={underlayInputRef}
                type="file"
                accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || !onPlanUnderlayChange) return;
                  void (async () => {
                    const underlay = await readPlanUnderlayFile(file, floorRooms);
                    if (underlay) onPlanUnderlayChange(underlay);
                  })();
                }}
              />
            </>
          ) : null}
        </aside>

        <div className="hp-plan-main">
      <div className="hp-plan-bar">
        <div className="hp-plan-bar-left">
          <strong>Floor plan</strong>
          <span>
            {floorRooms.length} room{floorRooms.length === 1 ? "" : "s"} on {activeFloor}
          </span>
        </div>
        <div className="hp-plan-bar-actions">
          {onAddRoom ? (
            <button type="button" className="hd-btn hd-btn-primary" onClick={onAddRoom}>
              Add room
            </button>
          ) : null}
          {heatingLayout && onLayoutModeChange ? (
            <button
              type="button"
              className={`hd-btn hd-btn-ghost${layoutMode ? " is-on" : ""}`}
              onClick={() => onLayoutModeChange(!layoutMode)}
              title="Show and move plant + pipework"
            >
              Heating layout
            </button>
          ) : null}
          {heatingLayout && onRegenerateLayout ? (
            <button
              type="button"
              className="hd-btn hd-btn-ghost"
              onClick={onRegenerateLayout}
              title="Keeps your plant positions; redraws radiators/UFH and pipe routes"
            >
              Route pipes
            </button>
          ) : null}
          <div className="hp-zoom-controls" aria-label="Zoom">
            <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.15).toFixed(2))))}>
              −
            </button>
            <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className="hd-btn hd-btn-ghost" onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))))}>
              +
            </button>
            <button type="button" className="hd-btn hd-btn-ghost" onClick={fitZoom}>
              Fit
            </button>
          </div>
          <button
            type="button"
            className="hd-btn hd-btn-ghost"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
              makeLShape(selected);
            }}
          >
            L-shape
          </button>
          <button
            type="button"
            className="hd-btn hd-btn-ghost"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
              const polygon = roomPolygon(selected);
              const exterior = roomWallExterior(selected, polygon.length);
              const edge = selectedEdge ?? exterior.findIndex(Boolean);
              addAlcoveOnEdge(selected, edge < 0 ? 0 : edge);
            }}
          >
            Alcove / bay
          </button>
          <button
            type="button"
            className="hd-btn hd-btn-danger"
            disabled={!selected || !selectedOpeningId}
            title={selectedOpeningId ? "Remove the selected window or door" : "Select a window or door mark first"}
            onClick={() => {
              if (!selected) return;
              if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
              deleteSelectedOpening(selected);
            }}
          >
            Remove opening
          </button>
          <button
            type="button"
            className="hd-btn hd-btn-danger"
            disabled={!selected}
            title="Remove the selected room"
            onClick={() => {
              if (!selected) return;
              if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
              setSelectedOpeningId(null);
              setSelectedEdge(null);
              onDeleteRoom(selected.id);
            }}
          >
            Remove room
          </button>
        </div>
      </div>
      {layoutMode && heatingLayout ? (
        <div className="hp-layout-banner">
          <strong>{layoutSystemLabel || "Heating layout"}</strong>
          <span>
            {plantPlaceTool
              ? `Click the plan to place ${plantPlaceTool.replace("_", " ")}. Then Route pipes / Ask Blake for the network and kit.`
              : "Drag plant, radiators / UFH and pipe bends. Flow red · return blue · refrigerant purple · primary teal. Use zoom if anything sits outside the first view."}
          </span>
          {selectedPlant ? <em>Selected: {selectedPlant.label}</em> : null}
          {selectedEmitter ? <em>Selected: {selectedEmitter.label}</em> : null}
          {selectedPipe ? <em>Selected pipe: {selectedPipe.label}</em> : null}
          {selectedPlant && onPatchLayout && heatingLayout ? (
            <button
              type="button"
              className="hd-btn hd-btn-danger"
              onClick={() => {
                onPatchLayout(removePlantFromLayout(heatingLayout, selectedPlant.id));
                setSelectedPlantId(null);
              }}
            >
              Remove plant
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="hp-canvas-wrap" ref={wrapRef}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("text/hd-room")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!onPlaceRoom) return;
          const roomType = event.dataTransfer.getData("text/hd-room");
          if (!roomType) return;
          event.preventDefault();
          if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
          const point = clientToMetres(event.clientX, event.clientY);
          onPlaceRoom(roomType, Math.max(0, point.x - 1.75), Math.max(0, point.y - 1.6), 3.5, 3.2);
          setPlaceRoomType(null);
        }}
      >
        <svg
          ref={svgRef}
          className="hp-canvas"
          width={bounds.width}
          height={bounds.height}
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          role="img"
          aria-label="Floor plan canvas"
          onPointerDown={(event) => {
            if (plantPlaceTool && onPlacePlant) {
              event.preventDefault();
              const point = clientToMetres(event.clientX, event.clientY);
              onPlacePlant(plantPlaceTool, Math.max(0, point.x), Math.max(0, point.y));
              setPlantPlaceTool(null);
              return;
            }
            // Drawing / moving rooms must work even if Heating layout was left on.
            if (placeRoomType && onPlaceRoom) {
              event.preventDefault();
              if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
              const point = clientToMetres(event.clientX, event.clientY);
              setDrag({ mode: "draw-room", roomType: placeRoomType, start: point, current: point });
              return;
            }
            onSelectRoom(null);
            setSelectedEdge(null);
            setSelectedOpeningId(null);
          }}
        >
          <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="#7a7a7a" />
          {planUnderlay?.dataUrl ? (
            <image
              href={planUnderlay.dataUrl}
              x={px(planUnderlay.originX)}
              y={py(planUnderlay.originY)}
              width={planUnderlay.widthM * scale}
              height={planUnderlay.heightM * scale}
              opacity={planUnderlay.opacity ?? 0.45}
              preserveAspectRatio="none"
              style={{ pointerEvents: "none" }}
            />
          ) : null}
          {Array.from({ length: Math.ceil(bounds.metresX - bounds.originX) + 2 }, (_, m) => {
            const gx = bounds.originX + m;
            return (
              <line
                key={`gx-${m}`}
                x1={px(gx)}
                y1={PAD}
                x2={px(gx)}
                y2={bounds.height - PAD}
                stroke="rgba(0,0,0,0.07)"
                strokeWidth={1}
              />
            );
          })}
          {Array.from({ length: Math.ceil(bounds.metresY - bounds.originY) + 2 }, (_, m) => {
            const gy = bounds.originY + m;
            return (
              <line
                key={`gy-${m}`}
                x1={PAD}
                y1={py(gy)}
                x2={bounds.width - PAD}
                y2={py(gy)}
                stroke="rgba(0,0,0,0.07)"
                strokeWidth={1}
              />
            );
          })}

          {ghostRooms.map((room) => {
            const polygon = roomPolygon(room);
            const pointsAttr = polygon.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
            return (
              <polygon
                key={`ghost-${room.id}`}
                points={pointsAttr}
                fill="rgba(255,255,255,0.18)"
                stroke="rgba(255,255,255,0.35)"
                strokeWidth={2}
                strokeDasharray="6 5"
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {drag?.mode === "draw-room" ? (
            <rect
              x={px(Math.min(drag.start.x, drag.current.x))}
              y={py(Math.min(drag.start.y, drag.current.y))}
              width={Math.abs(px(drag.current.x) - px(drag.start.x))}
              height={Math.abs(py(drag.current.y) - py(drag.start.y))}
              fill="rgba(255,255,255,0.55)"
              stroke="#e11d48"
              strokeWidth={2}
              strokeDasharray="5 4"
              style={{ pointerEvents: "none" }}
            />
          ) : null}

          {guides.x.map((x) => (
            <line
              key={`vg-${x}`}
              x1={px(x)}
              y1={PAD}
              x2={px(x)}
              y2={bounds.height - PAD}
              stroke="#e11d48"
              strokeDasharray="6 5"
              strokeWidth={1.5}
            />
          ))}
          {guides.y.map((y) => (
            <line
              key={`hg-${y}`}
              x1={PAD}
              y1={py(y)}
              x2={bounds.width - PAD}
              y2={py(y)}
              stroke="#e11d48"
              strokeDasharray="6 5"
              strokeWidth={1.5}
            />
          ))}

          {floorRooms.map((room) => {
            const polygon = roomPolygon(room);
            const exterior = roomWallExterior(room, polygon.length);
            const isSelected = room.id === selectedRoomId;
            const height = numberFromInput(room.height, 2.4);
            const pointsAttr = polygon.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
            const lengths = edgeLengths(polygon);
            const centroid = polygon.reduce(
              (acc, p) => ({ x: acc.x + p.x / polygon.length, y: acc.y + p.y / polygon.length }),
              { x: 0, y: 0 },
            );

            return (
              <g key={room.id}>
                <polygon
                  points={pointsAttr}
                  fill={isSelected ? "#eef6fb" : "#f7f7f5"}
                  stroke="none"
                  style={{ cursor: plantPlaceTool ? "crosshair" : placeRoomType ? "crosshair" : "grab" }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    // Drawing a new room must work even when the drag starts over an existing room.
                    if (placeRoomType && onPlaceRoom) {
                      if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
                      const point = clientToMetres(event.clientX, event.clientY);
                      setDrag({ mode: "draw-room", roomType: placeRoomType, start: point, current: point });
                      return;
                    }
                    // Selecting a room exits sticky heating-layout lock so move/delete work again.
                    if (layoutMode && !plantPlaceTool && onLayoutModeChange) {
                      onLayoutModeChange(false);
                    }
                    onSelectRoom(room.id);
                    setSelectedEdge(null);
                    setSelectedPlantId(null);
                    setSelectedPipeId(null);
                    if (plantPlaceTool) return;
                    const grab = clientToMetres(event.clientX, event.clientY);
                    setDrag({ mode: "move", roomId: room.id, origin: polygon, grab });
                  }}
                />
                {polygon.map((p, i) => {
                  const q = polygon[(i + 1) % polygon.length]!;
                  return (
                    <line
                      key={`e-${i}`}
                      x1={px(p.x)}
                      y1={py(p.y)}
                      x2={px(q.x)}
                      y2={py(q.y)}
                      stroke={
                        isSelected && selectedEdge === i ? "#0ea5e9" : exterior[i] ? "#2c2c2c" : "#8d8d8d"
                      }
                      strokeWidth={exterior[i] ? (isSelected ? 11 : 9) : isSelected && selectedEdge === i ? 5 : 3}
                      strokeLinecap="square"
                      style={{
                        cursor: placeRoomType || placeTool || plantPlaceTool ? "crosshair" : "ew-resize",
                        pointerEvents: placeRoomType ? "none" : "auto",
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (placeRoomType && onPlaceRoom) {
                          if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
                          const point = clientToMetres(event.clientX, event.clientY);
                          setDrag({ mode: "draw-room", roomType: placeRoomType, start: point, current: point });
                          return;
                        }
                        if (layoutMode && !plantPlaceTool && onLayoutModeChange) {
                          onLayoutModeChange(false);
                        }
                        onSelectRoom(room.id);
                        setSelectedEdge(i);
                        setSelectedOpeningId(null);
                        if (placeTool) {
                          placeOpeningOnEdge(room, i, clientToMetres(event.clientX, event.clientY), placeTool);
                          return;
                        }
                        if (event.detail >= 2) {
                          toggleEdgeExterior(room, i);
                          return;
                        }
                        if (!plantPlaceTool) {
                          setDrag({ mode: "edge", roomId: room.id, edgeIndex: i, origin: polygon });
                        }
                      }}
                    />
                  );
                })}

                <text
                  x={px(centroid.x)}
                  y={py(centroid.y) - 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#334155"
                  fontSize={13}
                  fontWeight={700}
                  style={{ pointerEvents: "none" }}
                >
                  {room.name?.trim() || room.roomType}
                </text>
                <text
                  x={px(centroid.x)}
                  y={py(centroid.y) + 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#8a8a8a"
                  fontSize={12}
                  fontWeight={600}
                  style={{ pointerEvents: "none" }}
                >
                  {mm(height)}
                </text>

                {(room.openings ?? []).map((opening) => {
                  const wallIndex = opening.wallIndex ?? opening.wall ?? 0;
                  const geom = openingOnEdge(polygon, { ...opening, wallIndex });
                  const active = opening.id === selectedOpeningId;
                  return (
                    <g key={opening.id}>
                      <line
                        x1={px(geom.x1)}
                        y1={py(geom.y1)}
                        x2={px(geom.x2)}
                        y2={py(geom.y2)}
                        stroke={
                          opening.kind === "door" ? "#fb7185" : opening.kind === "rooflight" ? "#a78bfa" : "#38bdf8"
                        }
                        strokeWidth={active ? 12 : 8}
                        strokeLinecap="butt"
                        style={{ cursor: "grab" }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectRoom(room.id);
                          setSelectedOpeningId(opening.id);
                          setSelectedEdge(wallIndex);
                          setPlaceTool(null);
                          setPlaceRoomType(null);
                          setDrag({
                            mode: "opening",
                            roomId: room.id,
                            openingId: opening.id,
                            wallIndex,
                          });
                        }}
                      />
                      <text
                        x={px(geom.cx) + geom.nx * 12}
                        y={py(geom.cy) + geom.ny * 12}
                        textAnchor="middle"
                        fill={
                          opening.kind === "door" ? "#9f1239" : opening.kind === "rooflight" ? "#5b21b6" : "#0369a1"
                        }
                        fontSize={11}
                        fontWeight={700}
                        style={{ pointerEvents: "none" }}
                      >
                        {opening.kind === "door" ? "D" : opening.kind === "rooflight" ? "RL" : "W"}
                      </text>
                    </g>
                  );
                })}

                {(room.surveyedEmitters ?? []).map((emitter) => {
                  if (emitter.kind === "ufh") {
                    const box = polygonBounds(polygon);
                    return (
                      <rect
                        key={emitter.id}
                        x={px(box.minX + 0.35)}
                        y={py(box.minY + 0.35)}
                        width={Math.max(8, (box.width - 0.7) * scale)}
                        height={Math.max(8, (box.height - 0.7) * scale)}
                        fill="rgba(14, 116, 144, 0.12)"
                        stroke="#0e7490"
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                        style={{ pointerEvents: "none" }}
                      />
                    );
                  }
                  const geom = surveyedEmitterGeom(room, emitter);
                  const w = geom.widthM * scale;
                  const d = geom.depthM * scale;
                  return (
                    <g
                      key={emitter.id}
                      transform={`translate(${px(geom.x)}, ${py(geom.y)}) rotate(${geom.rotationDeg})`}
                      style={{ pointerEvents: "none" }}
                    >
                      <rect
                        x={-w / 2}
                        y={-d / 2}
                        width={w}
                        height={d}
                        rx={1.5}
                        fill="#3f3f46"
                        stroke="#fafafa"
                        strokeWidth={1}
                      />
                      <text
                        x={0}
                        y={-d / 2 - 5}
                        textAnchor="middle"
                        fill="#27272a"
                        fontSize={9}
                        fontWeight={700}
                      >
                        RAD
                      </text>
                    </g>
                  );
                })}

                {isSelected && !plantPlaceTool
                  ? polygon.map((p, i) => {
                      const q = polygon[(i + 1) % polygon.length]!;
                      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                      const labelOffset = 14;
                      return (
                        <g key={`sel-${i}`}>
                          <text
                            x={px(mid.x)}
                            y={py(mid.y) - labelOffset}
                            textAnchor="middle"
                            fill="#e11d48"
                            fontSize={12}
                            fontWeight={800}
                            style={{ pointerEvents: "none" }}
                          >
                            {mm(lengths[i] ?? 0)}
                          </text>
                          <circle
                            cx={px(mid.x)}
                            cy={py(mid.y)}
                            r={5}
                            fill="#93c5fd"
                            stroke="#fff"
                            strokeWidth={1.5}
                            style={{ cursor: "copy" }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (onLayoutModeChange && layoutMode) onLayoutModeChange(false);
                              // Insert vertex then start dragging it
                              const next = insertVertexOnEdge(polygon, i, 0.5);
                              const wallExterior = roomWallExterior(room, polygon.length);
                              const newExterior = [
                                ...wallExterior.slice(0, i + 1),
                                wallExterior[i] ?? true,
                                ...wallExterior.slice(i + 1),
                              ];
                              const patched = syncRoomFromPolygon({ ...room, wallExterior: newExterior }, next);
                              onPatchRoom(room.id, patched);
                              setSelectedEdge(i);
                              setDrag({
                                mode: "vertex",
                                roomId: room.id,
                                index: i + 1,
                                polygon: next,
                              });
                            }}
                          />
                          <rect
                            x={px(p.x) - 5}
                            y={py(p.y) - 5}
                            width={10}
                            height={10}
                            fill="#fb7185"
                            stroke="#fff"
                            strokeWidth={1.5}
                            style={{ cursor: polygon.length === 4 ? "nwse-resize" : "move" }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onSelectRoom(room.id);
                              if (polygon.length === 4) {
                                setDrag({ mode: "resize-rect", roomId: room.id, corner: i, origin: polygon });
                              } else {
                                setDrag({ mode: "vertex", roomId: room.id, index: i, polygon });
                              }
                            }}
                          />
                        </g>
                      );
                    })
                  : null}
              </g>
            );
          })}

          {showLayout
            ? floorPipes.map((pipe) => {
                const style = pipeStroke(pipe.kind, pipe.diameterMm);
                const active = pipe.id === selectedPipeId;
                const pointsAttr = pipe.points
                  .map((p) => `${px(p.x)},${py(p.y)}`)
                  .join(" ");
                const mid = pipe.points[Math.floor(pipe.points.length / 2)];
                return (
                  <g
                    key={pipe.id}
                    className="hp-pipe-layer"
                    style={{ pointerEvents: layoutMode ? "auto" : "none" }}
                  >
                    {/* Halo so flow/return stay readable on busy PDF underlays */}
                    {planUnderlay?.dataUrl ? (
                      <polyline
                        points={pointsAttr}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={(active ? style.width + 2 : style.width) + 3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.85}
                        style={{ pointerEvents: "none" }}
                      />
                    ) : null}
                    <polyline
                      points={pointsAttr}
                      fill="none"
                      stroke={style.stroke}
                      strokeWidth={active ? style.width + 2.5 : style.width + (planUnderlay ? 0.8 : 0)}
                      strokeDasharray={style.dash}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.96}
                      style={{ cursor: layoutMode ? "grab" : "default" }}
                      onPointerDown={(event) => {
                        if (!layoutMode || !heatingLayout) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedPipeId(pipe.id);
                        setSelectedPlantId(null);
                        setSelectedEmitterId(null);
                        onSelectRoom(null);
                        const grab = clientToMetres(event.clientX, event.clientY);
                        setDrag({ mode: "pipe-move", pipeId: pipe.id, origin: pipe.points, grab });
                      }}
                    />
                    {mid && pipe.diameterMm ? (
                      <text
                        x={px(mid.x)}
                        y={py(mid.y) - 6}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={700}
                        fill={style.stroke}
                        style={{ pointerEvents: "none" }}
                      >
                        {pipe.diameterMm}
                      </text>
                    ) : null}
                    {layoutMode
                      ? pipe.points.map((p, index) => (
                          <circle
                            key={`${pipe.id}-pt-${index}`}
                            cx={px(p.x)}
                            cy={py(p.y)}
                            r={active ? 6 : 4.5}
                            fill="#fff"
                            stroke={style.stroke}
                            strokeWidth={2}
                            style={{ cursor: "move" }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedPipeId(pipe.id);
                              setSelectedPlantId(null);
                              setSelectedEmitterId(null);
                              setDrag({ mode: "pipe-point", pipeId: pipe.id, pointIndex: index });
                            }}
                          />
                        ))
                      : null}
                  </g>
                );
              })
            : null}

          {showLayout
            ? floorPlants.map((plant) => {
                const w = (plant.widthM ?? 0.5) * scale;
                const d = (plant.depthM ?? 0.35) * scale;
                const cx = px(plant.x);
                const cy = py(plant.y);
                const active = plant.id === selectedPlantId;
                const fill = plantFill(plant.kind);
                return (
                  <g
                    key={plant.id}
                    className="hp-plant-layer"
                    style={{
                      cursor: layoutMode ? "grab" : "default",
                      pointerEvents: layoutMode ? "auto" : "none",
                    }}
                    onPointerDown={(event) => {
                      if (!layoutMode || !heatingLayout) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedPlantId(plant.id);
                      setSelectedPipeId(null);
                      setSelectedEmitterId(null);
                      onSelectRoom(null);
                      setDrag({ mode: "plant", plantId: plant.id });
                    }}
                  >
                    <rect
                      x={cx - w / 2}
                      y={cy - d / 2}
                      width={w}
                      height={d}
                      rx={4}
                      fill={fill}
                      stroke={active ? "#fff" : "rgba(255,255,255,0.65)"}
                      strokeWidth={active ? 3 : 1.5}
                      opacity={0.95}
                    />
                    <text
                      x={cx}
                      y={cy - d / 2 - 8}
                      textAnchor="middle"
                      fill="#0f172a"
                      fontSize={11}
                      fontWeight={700}
                      style={{ pointerEvents: "none" }}
                    >
                      {plant.label}
                    </text>
                  </g>
                );
              })
            : null}

          {showLayout
            ? floorEmitters.map((emitter) => {
                const w = emitter.widthM * scale;
                const d = emitter.depthM * scale;
                const cx = px(emitter.x);
                const cy = py(emitter.y);
                const active = emitter.id === selectedEmitterId;
                if (emitter.kind === "ufh") {
                  return (
                    <g
                      key={emitter.id}
                      className="hp-emitter-layer"
                      style={{
                        cursor: layoutMode ? "grab" : "default",
                        // When not in heating-layout mode, let wall/room edits receive the taps.
                        pointerEvents: layoutMode ? "auto" : "none",
                      }}
                      onPointerDown={(event) => {
                        if (!layoutMode || !heatingLayout) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedEmitterId(emitter.id);
                        setSelectedPlantId(null);
                        setSelectedPipeId(null);
                        onSelectRoom(emitter.roomId);
                        setDrag({ mode: "emitter", emitterId: emitter.id });
                      }}
                    >
                      <rect
                        x={cx - w / 2}
                        y={cy - d / 2}
                        width={w}
                        height={d}
                        rx={6}
                        fill="rgba(14, 116, 144, 0.12)"
                        stroke={active ? "#0e7490" : "#0891b2"}
                        strokeWidth={active ? 2.5 : 1.5}
                        strokeDasharray="6 4"
                      />
                      {/* simple loop hint */}
                      <rect
                        x={cx - w * 0.35}
                        y={cy - d * 0.35}
                        width={w * 0.7}
                        height={d * 0.7}
                        fill="none"
                        stroke="#0891b2"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.7}
                        style={{ pointerEvents: "none" }}
                      />
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#0e7490"
                        fontSize={11}
                        fontWeight={700}
                        style={{ pointerEvents: "none" }}
                      >
                        UFH
                      </text>
                    </g>
                  );
                }
                return (
                  <g
                    key={emitter.id}
                    className="hp-emitter-layer"
                    transform={`rotate(${emitter.rotationDeg} ${cx} ${cy})`}
                    style={{
                      cursor: layoutMode ? "grab" : "default",
                      pointerEvents: layoutMode ? "auto" : "none",
                    }}
                    onPointerDown={(event) => {
                      if (!layoutMode || !heatingLayout) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedEmitterId(emitter.id);
                      setSelectedPlantId(null);
                      setSelectedPipeId(null);
                      onSelectRoom(emitter.roomId);
                      setDrag({ mode: "emitter", emitterId: emitter.id });
                    }}
                  >
                    <rect
                      x={cx - w / 2}
                      y={cy - d / 2}
                      width={w}
                      height={d}
                      rx={2}
                      fill={active ? "#fb7185" : "#f43f5e"}
                      stroke="#fff"
                      strokeWidth={active ? 2 : 1}
                    />
                    <text
                      x={cx}
                      y={cy - d / 2 - 6}
                      textAnchor="middle"
                      fill="#9f1239"
                      fontSize={10}
                      fontWeight={700}
                      style={{ pointerEvents: "none" }}
                    >
                      {emitter.label}
                    </text>
                  </g>
                );
              })
            : null}
        </svg>

        {selected && !layoutMode ? (
          <div className="hp-room-toolbar" style={{ left: "50%", top: 12, transform: "translateX(-50%)" }}>
            <button
              type="button"
              title="Ceiling height"
              onClick={() =>
                setRoomEdit({
                  roomId: selected.id,
                  field: "height",
                  value: String(Math.round(numberFromInput(selected.height, 2.4) * 1000)),
                })
              }
            >
              ↕
            </button>
            <button
              type="button"
              title="Rename"
              onClick={() => setRoomEdit({ roomId: selected.id, field: "name", value: selected.name })}
            >
              ✎
            </button>
            <label className="hp-room-type">
              <select
                value={selected.roomType}
                onChange={(event) => onPatchRoom(selected.id, { roomType: event.target.value, name: event.target.value })}
              >
                {roomTypes.map((item) => (
                  <option key={item.id}>{item.id}</option>
                ))}
              </select>
            </label>
            {selectedOpeningId ? (
              <button type="button" className="is-danger" title="Remove selected opening" onClick={() => deleteSelectedOpening(selected)}>
                Remove opening
              </button>
            ) : null}
            <button
              type="button"
              className="is-danger"
              title="Remove room"
              onClick={() => {
                setSelectedOpeningId(null);
                setSelectedEdge(null);
                onDeleteRoom(selected.id);
              }}
            >
              Remove room
            </button>
          </div>
        ) : null}

        {roomEdit ? (
          <div
            className="hp-edit-modal-backdrop"
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setRoomEdit(null);
            }}
          >
            <div
              className="hp-edit-modal"
              role="dialog"
              aria-modal="true"
              aria-label={roomEdit.field === "name" ? "Rename room" : "Ceiling height"}
            >
              <label>
                {roomEdit.field === "name" ? "Room name" : "Ceiling height (mm)"}
                <input
                  autoFocus
                  type={roomEdit.field === "name" ? "text" : "number"}
                  value={roomEdit.value}
                  onChange={(event) =>
                    setRoomEdit((current) => (current ? { ...current, value: event.target.value } : current))
                  }
                  onFocus={(event) => event.target.select()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitRoomEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setRoomEdit(null);
                    }
                  }}
                />
              </label>
              <div className="hp-edit-modal-actions">
                <button type="button" onClick={() => setRoomEdit(null)}>
                  Cancel
                </button>
                <button type="button" className="is-primary" onClick={submitRoomEdit}>
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="hp-floor-switcher" role="tablist" aria-label="Floor level">
          {(
            [
              ["ground", "Ground"],
              ["cellar", "Cellar"],
              ["first", "First"],
              ["second", "Second"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeFloor === id}
              className={activeFloor === id ? "is-active" : ""}
              onClick={() => onChangeFloor(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {showLayout && floorEmitters.length ? (
        <div className="hp-emitter-schedule">
          <strong>
            Emitter schedule ·{" "}
            {emitterMode === "ufh" ? "Underfloor heating" : emitterMode === "mixed" ? "Mixed" : "Radiators"}
          </strong>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Type</th>
                <th>Size / model</th>
                <th>Output</th>
                <th>vs loss</th>
              </tr>
            </thead>
            <tbody>
              {floorEmitters.map((emitter) => {
                const room = rooms.find((item) => item.id === emitter.roomId);
                const loss = room
                  ? calculateRoomHeatLoss(
                      { ...room, meanWaterTemperature: room.meanWaterTemperature || "45" },
                      designExternalTemp,
                    )
                  : null;
                const output = emitter.outputWatts ?? 0;
                const ok = !loss || !output ? null : output >= loss.radiatorOutputAtDeltaT50 * 0.95;
                return (
                  <tr key={emitter.id} className={emitter.id === selectedEmitterId ? "is-on" : undefined}>
                    <td>{room?.name || "Room"}</td>
                    <td>{emitter.kind === "ufh" ? "UFH" : "Radiator"}</td>
                    <td>{emitter.kind === "ufh" ? `${emitter.widthM.toFixed(1)} × ${emitter.depthM.toFixed(1)} m zone` : emitter.label}</td>
                    <td>{emitter.outputWatts ? `${emitter.outputWatts} W` : emitter.kind === "ufh" ? "—" : "TBC"}</td>
                    <td>
                      {ok == null ? "—" : ok ? "OK" : loss ? `Short ${Math.round(loss.radiatorOutputAtDeltaT50 - output)} W` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="hp-canvas-hint">
        <strong>Floor plan:</strong> pick a room from the palette → click the canvas to place · snap rooms together for
        internal walls · place Window / Door / Roof light on a selected wall · drag corners to resize · tap openings to
        set size in the inspector.
        {" "}
        <strong>Plant:</strong> place boiler / cylinder / manifold, then <em>Route pipes</em> or Ask Blake.
      </p>
      {layoutMode ? (
        <p className="hp-canvas-hint">
          Heating layout — drag plant or pipe vertices. Click a room (or pick a room type) to leave layout mode and
          move / remove rooms again. <em>Route pipes</em> rebuilds emitters and runs from your placed plant only.
        </p>
      ) : null}
      {plantPlaceTool ? (
        <p className="hp-canvas-hint">
          Place <strong>{plantPlaceTool.replace(/_/g, " ")}</strong> — click the plan.
        </p>
      ) : null}
      {placeRoomType ? (
        <p className="hp-canvas-hint">
          Draw room: <strong>{placeRoomType}</strong> — click and drag on the canvas to size it.
        </p>
      ) : null}
      {placeTool ? (
        <p className="hp-canvas-hint">
          Placement mode: <strong>{placeTool}</strong> — click a wall on the selected room.
        </p>
      ) : null}
      {selected && selectedEdge != null && !layoutMode ? (
        <p className="hp-canvas-hint">
          Selected wall {selectedEdge + 1} · {mm(edgeLengths(selectedPoly)[selectedEdge] ?? 0)} ·{" "}
          {roomWallExterior(selected, selectedPoly.length)[selectedEdge] ? "exterior" : "internal"} · double-click wall
          to toggle manually
        </p>
      ) : null}
        </div>

        <aside className="hp-inspector" aria-label="Room and opening details">
          {selected && !layoutMode ? (
            <>
              <p className="hp-palette-label">Room details</p>
              <strong className="hp-inspector-title">{selected.name}</strong>
              <label className="hd-field">
                Room type
                <select
                  value={selected.roomType}
                  onChange={(event) =>
                    onPatchRoom(selected.id, { roomType: event.target.value, name: event.target.value })
                  }
                >
                  {roomTypes.map((item) => (
                    <option key={item.id}>{item.id}</option>
                  ))}
                </select>
              </label>
              <div className="hp-inspector-grid">
                <label className="hd-field">
                  Design °C
                  <input
                    type="number"
                    step="0.5"
                    value={
                      selected.targetTemp ??
                      roomTypes.find((item) => item.id === selected.roomType)?.targetTemp ??
                      21
                    }
                    onChange={(event) =>
                      onPatchRoom(selected.id, { targetTemp: Number(event.target.value) || undefined })
                    }
                  />
                </label>
                <label className="hd-field">
                  ACH
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={
                      selected.airChanges ??
                      roomTypes.find((item) => item.id === selected.roomType)?.airChanges ??
                      0.5
                    }
                    onChange={(event) =>
                      onPatchRoom(selected.id, { airChanges: Number(event.target.value) || undefined })
                    }
                  />
                </label>
              </div>
              <label className="hd-field">
                Floor construction
                <select
                  value={selected.floorType}
                  onChange={(event) => onPatchRoom(selected.id, { floorType: event.target.value })}
                >
                  {floorTypes.map((item) => (
                    <option key={item.id}>{item.id}</option>
                  ))}
                </select>
              </label>
              <label className="hd-field">
                Ceiling / roof
                <select
                  value={selected.ceilingType}
                  onChange={(event) => onPatchRoom(selected.id, { ceilingType: event.target.value })}
                >
                  {ceilingTypes.map((item) => (
                    <option key={item.id}>{item.id}</option>
                  ))}
                </select>
              </label>
              {selectedEdge != null ? (
                <>
                  <p className="hp-palette-label">Selected wall {selectedEdge + 1}</p>
                  <label className="hd-field">
                    Wall material
                    <select
                      value={selected.wallType}
                      onChange={(event) => onPatchRoom(selected.id, { wallType: event.target.value })}
                    >
                      {wallTypes.map((item) => (
                        <option key={item.id}>{item.id}</option>
                      ))}
                    </select>
                  </label>
                  <p className="hp-palette-hint">
                    {roomWallExterior(selected, selectedPoly.length)[selectedEdge]
                      ? `Exterior · design outside ${designExternalTemp}°C`
                      : "Internal — shared with adjoining room"}
                  </p>
                </>
              ) : null}
              {selectedLoss ? (
                <div className="hp-loss-breakdown">
                  <p>
                    <strong>{wattsLabel(selectedLoss.watts)}</strong> total · {selectedLoss.floorArea.toFixed(1)} m² ·{" "}
                    {selectedLoss.floorArea > 0
                      ? `${Math.round(selectedLoss.watts / selectedLoss.floorArea)} W/m²`
                      : "—"}
                  </p>
                  <ul>
                    <li>
                      <span>Walls</span>
                      <b>{wattsLabel(selectedLoss.wallLoss)}</b>
                    </li>
                    <li>
                      <span>Windows / doors</span>
                      <b>{wattsLabel(selectedLoss.glazingLoss)}</b>
                    </li>
                    <li>
                      <span>Floor</span>
                      <b>{wattsLabel(selectedLoss.floorLoss)}</b>
                    </li>
                    <li>
                      <span>Ceiling</span>
                      <b>{wattsLabel(selectedLoss.ceilingLoss)}</b>
                    </li>
                    <li>
                      <span>Ventilation</span>
                      <b>{wattsLabel(selectedLoss.ventilationLoss)}</b>
                    </li>
                  </ul>
                </div>
              ) : null}
              {(selected.surveyedEmitters ?? []).length ? (
                <div className="hp-emitter-mini">
                  <p className="hp-palette-label">Surveyed emitters</p>
                  <ul>
                    {(selected.surveyedEmitters ?? []).map((emitter) => (
                      <li key={emitter.id}>
                        <span>{emitter.label || (emitter.kind === "ufh" ? "UFH" : "Radiator")}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onPatchRoom(selected.id, {
                              surveyedEmitters: (selected.surveyedEmitters ?? []).filter((item) => item.id !== emitter.id),
                            })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <button
                type="button"
                className="hd-btn hd-btn-ghost"
                onClick={() => {
                  const box = polygonBounds(roomPolygon(selected));
                  const emitter = {
                    id: `sufh-${Date.now()}`,
                    kind: "ufh" as const,
                    wallIndex: 0,
                    t: 0.5,
                    widthM: Math.max(1.2, box.width - 0.7),
                    depthM: Math.max(1, box.height - 0.7),
                    label: `UFH · ${selected.name}`,
                  };
                  onPatchRoom(selected.id, {
                    surveyedEmitters: [...(selected.surveyedEmitters ?? []), emitter],
                  });
                }}
              >
                Add underfloor heating
              </button>
              {selectedOpening ? (
                <>
                  <p className="hp-palette-label">Opening</p>
                  <label className="hd-field">
                    Kind
                    <select
                      value={selectedOpening.kind}
                      onChange={(event) =>
                        patchSelectedOpening({
                          kind: event.target.value as PlanOpening["kind"],
                        })
                      }
                    >
                      <option value="window">Window</option>
                      <option value="door">Door</option>
                      <option value="rooflight">Roof light</option>
                    </select>
                  </label>
                  <div className="hp-inspector-grid">
                    <label className="hd-field">
                      Width m
                      <input
                        type="number"
                        step="0.05"
                        min="0.3"
                        value={selectedOpening.widthM}
                        onChange={(event) =>
                          patchSelectedOpening({ widthM: Math.max(0.3, Number(event.target.value) || 0.3) })
                        }
                      />
                    </label>
                    <label className="hd-field">
                      Height m
                      <input
                        type="number"
                        step="0.05"
                        min="0.3"
                        value={selectedOpening.heightM}
                        onChange={(event) =>
                          patchSelectedOpening({ heightM: Math.max(0.3, Number(event.target.value) || 0.3) })
                        }
                      />
                    </label>
                  </div>
                  <label className="hd-field">
                    Material
                    <select
                      value={selectedOpening.materialId || selected.glazingType}
                      onChange={(event) => patchSelectedOpening({ materialId: event.target.value })}
                    >
                      {glazingTypes.map((item) => (
                        <option key={item.id}>{item.id}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="hd-btn hd-btn-danger"
                    onClick={() => deleteSelectedOpening(selected)}
                  >
                    Remove opening
                  </button>
                </>
              ) : (
                <p className="hp-palette-hint">Select a W / D / RL mark to edit size and material.</p>
              )}
            </>
          ) : (
            <p className="hp-palette-hint">
              Select a room to edit type, ACH, design temperature, and see the heat-loss breakdown.
            </p>
          )}
          {summary ? (
            <div className="hp-plan-totals">
              <p className="hp-palette-label">Plan totals</p>
              <div className="hp-plan-totals-grid">
                <div>
                  <span>Heat loss</span>
                  <strong>{wattsLabel(summary.heatLossW)}</strong>
                </div>
                <div>
                  <span>Floor area</span>
                  <strong>{summary.floorAreaM2.toFixed(1)} m²</strong>
                </div>
                <div>
                  <span>W / m²</span>
                  <strong>
                    {summary.floorAreaM2 > 0 ? Math.round(summary.heatLossW / summary.floorAreaM2) : "—"}
                  </strong>
                </div>
                <div>
                  <span>Rooms</span>
                  <strong>{summary.roomCount}</strong>
                </div>
              </div>
              {onFinishSurveyedPlan ? (
                <button type="button" className="hd-btn hd-btn-primary hp-finish-survey" onClick={onFinishSurveyedPlan}>
                  Finish surveyed plan → System
                </button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

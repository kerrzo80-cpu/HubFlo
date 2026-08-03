"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  dist,
  edgeLengths,
  edgeParam,
  insertVertexOnEdge,
  lShapePolygon,
  numberFromInput,
  openingOnEdge,
  polygonBounds,
  roomPolygon,
  roomTypes,
  roomWallExterior,
  syncRoomFromPolygon,
  translatePolygon,
  type FloorLevel,
  type HeatDesignRoom,
  type PlanOpening,
  type PlanPoint,
} from "@/lib/heat-design";

type FloorPlanCanvasProps = {
  rooms: HeatDesignRoom[];
  selectedRoomId: string | null;
  activeFloor: FloorLevel;
  onSelectRoom: (roomId: string | null) => void;
  onPatchRoom: (roomId: string, patch: Partial<HeatDesignRoom>) => void;
  onDeleteRoom: (roomId: string) => void;
  onChangeFloor: (floor: FloorLevel) => void;
  onAddRoom?: () => void;
};

const SCALE = 90;
const PAD = 56;
const SNAP_M = 0.08;

type PlaceTool = "window" | "door" | null;

type DragState =
  | { mode: "move"; roomId: string; origin: PlanPoint[]; grab: PlanPoint }
  | { mode: "vertex"; roomId: string; index: number; polygon: PlanPoint[] }
  | { mode: "opening"; roomId: string; openingId: string; wallIndex: number }
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

export function FloorPlanCanvas({
  rooms,
  selectedRoomId,
  activeFloor,
  onSelectRoom,
  onPatchRoom,
  onDeleteRoom,
  onChangeFloor,
  onAddRoom,
}: FloorPlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [placeTool, setPlaceTool] = useState<PlaceTool>(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null);

  const floorRooms = useMemo(
    () => rooms.filter((room) => (room.floorLevel ?? "ground") === activeFloor),
    [rooms, activeFloor],
  );

  const bounds = useMemo(() => {
    let maxX = 10;
    let maxY = 8;
    let minX = 0;
    let minY = 0;
    for (const room of floorRooms) {
      const box = polygonBounds(roomPolygon(room));
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX + 1.5);
      maxY = Math.max(maxY, box.maxY + 1.5);
    }
    return {
      width: Math.max(760, (maxX - Math.min(0, minX)) * SCALE + PAD * 2),
      height: Math.max(520, (maxY - Math.min(0, minY)) * SCALE + PAD * 2),
      metresX: maxX,
      metresY: maxY,
    };
  }, [floorRooms]);

  function clientToMetres(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = bounds.width / rect.width;
    const sy = bounds.height / rect.height;
    return {
      x: ((clientX - rect.left) * sx - PAD) / SCALE,
      y: ((clientY - rect.top) * sy - PAD) / SCALE,
    };
  }

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
      if (drag?.mode === "move") {
        let dx = point.x - drag.grab.x;
        let dy = point.y - drag.grab.y;
        const moved = translatePolygon(drag.origin, dx, dy);
        const guideX: number[] = [];
        const guideY: number[] = [];
        const snapped = moved.map((p) => {
          const sx = snap(
            p.x,
            anchors.xs.filter((v) => !drag.origin.some((o) => Math.abs(o.x - v) < 0.001)),
          );
          const sy = snap(
            p.y,
            anchors.ys.filter((v) => !drag.origin.some((o) => Math.abs(o.y - v) < 0.001)),
          );
          if (Math.abs(sx - p.x) < SNAP_M) guideX.push(sx);
          if (Math.abs(sy - p.y) < SNAP_M) guideY.push(sy);
          return {
            x: Math.abs(sx - p.x) < SNAP_M ? sx : p.x,
            y: Math.abs(sy - p.y) < SNAP_M ? sy : p.y,
          };
        });
        // Keep relative shape if only some snapped — use uniform translate instead when any snap
        const first = drag.origin[0]!;
        const firstSnapped = snapped[0]!;
        dx = firstSnapped.x - first.x;
        dy = firstSnapped.y - first.y;
        const uniform = translatePolygon(drag.origin, dx, dy);
        setGuides({ x: [...new Set(guideX)], y: [...new Set(guideY)] });
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
      setDrag(null);
      setGuides({ x: [], y: [] });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, floorRooms, anchors, onPatchRoom, bounds.width, bounds.height]);

  const selected = floorRooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedPoly = selected ? roomPolygon(selected) : [];

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

  function placeOpeningOnEdge(room: HeatDesignRoom, edgeIndex: number, point: PlanPoint, kind: "window" | "door") {
    const polygon = roomPolygon(room);
    const a = polygon[edgeIndex]!;
    const b = polygon[(edgeIndex + 1) % polygon.length]!;
    const t = edgeParam(a, b, point);
    const opening: PlanOpening = {
      id: `op-${Date.now()}-${kind}`,
      wallIndex: edgeIndex,
      t,
      kind,
      widthM: kind === "door" ? 0.9 : 1.2,
      heightM: kind === "door" ? 2.0 : 1.2,
    };
    onPatchRoom(room.id, { openings: [...(room.openings ?? []), opening] });
    setSelectedOpeningId(opening.id);
    setPlaceTool(null);
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
          <button
            type="button"
            className={`hd-btn hd-btn-ghost${placeTool === "window" ? " is-on" : ""}`}
            disabled={!selected}
            onClick={() => setPlaceTool((current) => (current === "window" ? null : "window"))}
          >
            Window
          </button>
          <button
            type="button"
            className={`hd-btn hd-btn-ghost${placeTool === "door" ? " is-on" : ""}`}
            disabled={!selected}
            onClick={() => setPlaceTool((current) => (current === "door" ? null : "door"))}
          >
            Door
          </button>
          <button type="button" className="hd-btn hd-btn-ghost" disabled={!selected} onClick={() => selected && makeLShape(selected)}>
            L-shape
          </button>
          <button
            type="button"
            className="hd-btn hd-btn-ghost"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const polygon = roomPolygon(selected);
              const exterior = roomWallExterior(selected, polygon.length);
              const edge = selectedEdge ?? exterior.findIndex(Boolean);
              addAlcoveOnEdge(selected, edge < 0 ? 0 : edge);
            }}
          >
            Alcove / bay
          </button>
        </div>
      </div>
      <div className="hp-canvas-wrap">
        <svg
          ref={svgRef}
          className="hp-canvas"
          width="100%"
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          role="img"
          aria-label="Floor plan canvas"
          onPointerDown={() => {
            onSelectRoom(null);
            setSelectedEdge(null);
          }}
        >
          <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="#6d6d6d" />
          {Array.from({ length: Math.ceil(bounds.metresX) + 1 }, (_, m) => (
            <line
              key={`gx-${m}`}
              x1={PAD + m * SCALE}
              y1={PAD}
              x2={PAD + m * SCALE}
              y2={bounds.height - PAD}
              stroke="rgba(0,0,0,0.08)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: Math.ceil(bounds.metresY) + 1 }, (_, m) => (
            <line
              key={`gy-${m}`}
              x1={PAD}
              y1={PAD + m * SCALE}
              x2={bounds.width - PAD}
              y2={PAD + m * SCALE}
              stroke="rgba(0,0,0,0.08)"
              strokeWidth={1}
            />
          ))}

          {guides.x.map((x) => (
            <line
              key={`vg-${x}`}
              x1={PAD + x * SCALE}
              y1={PAD}
              x2={PAD + x * SCALE}
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
              y1={PAD + y * SCALE}
              x2={bounds.width - PAD}
              y2={PAD + y * SCALE}
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
            const pointsAttr = polygon.map((p) => `${PAD + p.x * SCALE},${PAD + p.y * SCALE}`).join(" ");
            const lengths = edgeLengths(polygon);
            const centroid = polygon.reduce(
              (acc, p) => ({ x: acc.x + p.x / polygon.length, y: acc.y + p.y / polygon.length }),
              { x: 0, y: 0 },
            );

            return (
              <g key={room.id}>
                <polygon
                  points={pointsAttr}
                  fill="#f4f4f2"
                  stroke="none"
                  style={{ cursor: "grab" }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectRoom(room.id);
                    setSelectedEdge(null);
                    const grab = clientToMetres(event.clientX, event.clientY);
                    setDrag({ mode: "move", roomId: room.id, origin: polygon, grab });
                  }}
                />
                {polygon.map((p, i) => {
                  const q = polygon[(i + 1) % polygon.length]!;
                  return (
                    <line
                      key={`e-${i}`}
                      x1={PAD + p.x * SCALE}
                      y1={PAD + p.y * SCALE}
                      x2={PAD + q.x * SCALE}
                      y2={PAD + q.y * SCALE}
                      stroke={isSelected && selectedEdge === i ? "#0ea5e9" : "#111"}
                      strokeWidth={exterior[i] ? 10 : 3}
                      strokeLinecap="square"
                      style={{ cursor: placeTool ? "crosshair" : "pointer" }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectRoom(room.id);
                        setSelectedEdge(i);
                        setSelectedOpeningId(null);
                        if (placeTool) {
                          placeOpeningOnEdge(room, i, clientToMetres(event.clientX, event.clientY), placeTool);
                          return;
                        }
                        if (event.detail >= 2) toggleEdgeExterior(room, i);
                      }}
                    />
                  );
                })}

                <text
                  x={PAD + centroid.x * SCALE}
                  y={PAD + centroid.y * SCALE}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#8a8a8a"
                  fontSize={13}
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
                        x1={PAD + geom.x1 * SCALE}
                        y1={PAD + geom.y1 * SCALE}
                        x2={PAD + geom.x2 * SCALE}
                        y2={PAD + geom.y2 * SCALE}
                        stroke={opening.kind === "door" ? "#fb7185" : "#38bdf8"}
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
                          setDrag({
                            mode: "opening",
                            roomId: room.id,
                            openingId: opening.id,
                            wallIndex,
                          });
                        }}
                      />
                      <text
                        x={PAD + geom.cx * SCALE + geom.nx * 12}
                        y={PAD + geom.cy * SCALE + geom.ny * 12}
                        textAnchor="middle"
                        fill={opening.kind === "door" ? "#9f1239" : "#0369a1"}
                        fontSize={11}
                        fontWeight={700}
                        style={{ pointerEvents: "none" }}
                      >
                        {opening.kind === "door" ? "D" : "W"}
                      </text>
                    </g>
                  );
                })}

                {isSelected
                  ? polygon.map((p, i) => {
                      const q = polygon[(i + 1) % polygon.length]!;
                      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                      const labelOffset = 14;
                      return (
                        <g key={`sel-${i}`}>
                          <text
                            x={PAD + mid.x * SCALE}
                            y={PAD + mid.y * SCALE - labelOffset}
                            textAnchor="middle"
                            fill="#e11d48"
                            fontSize={13}
                            fontWeight={800}
                            style={{ pointerEvents: "none" }}
                          >
                            {mm(lengths[i] ?? 0)}
                          </text>
                          <circle
                            cx={PAD + mid.x * SCALE}
                            cy={PAD + mid.y * SCALE}
                            r={5}
                            fill="#93c5fd"
                            stroke="#fff"
                            strokeWidth={1.5}
                            style={{ cursor: "copy" }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
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
                            x={PAD + p.x * SCALE - 5}
                            y={PAD + p.y * SCALE - 5}
                            width={10}
                            height={10}
                            fill="#fb7185"
                            stroke="#fff"
                            strokeWidth={1.5}
                            style={{ cursor: "move" }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onSelectRoom(room.id);
                              setDrag({ mode: "vertex", roomId: room.id, index: i, polygon });
                            }}
                          />
                        </g>
                      );
                    })
                  : null}
              </g>
            );
          })}
        </svg>

        {selected ? (
          <div className="hp-room-toolbar" style={{ left: "50%", top: 12, transform: "translateX(-50%)" }}>
            <button
              type="button"
              title="Ceiling height"
              onClick={() => {
                const next = window.prompt(
                  "Ceiling height (mm)",
                  String(Math.round(numberFromInput(selected.height, 2.4) * 1000)),
                );
                if (!next) return;
                const metres = Number(next) / 1000;
                if (Number.isFinite(metres) && metres > 1) onPatchRoom(selected.id, { height: String(metres) });
              }}
            >
              ↕
            </button>
            <button
              type="button"
              title="Rename"
              onClick={() => {
                const next = window.prompt("Room name", selected.name);
                if (next) onPatchRoom(selected.id, { name: next });
              }}
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
            <button type="button" title="Delete room" className="is-danger" onClick={() => onDeleteRoom(selected.id)}>
              🗑
            </button>
          </div>
        ) : null}

        <div className="hp-floor-switcher" role="tablist" aria-label="Floor level">
          {(
            [
              ["ground", "Ground"],
              ["cellar", "Cellar"],
              ["first", "First"],
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
      <p className="hp-canvas-hint">
        <strong>Windows / doors:</strong> select a room → tap <em>Window</em> or <em>Door</em> → click a wall. Drag the
        W/D mark to slide it. <strong>L-shaped hall:</strong> select room → <em>L-shape</em>, then drag pink corners to
        tune. Blue dots insert vertices; <em>Alcove / bay</em> pushes a bay.
      </p>
      {placeTool ? (
        <p className="hp-canvas-hint">
          Placement mode: <strong>{placeTool}</strong> — click any wall on the selected room.
        </p>
      ) : null}
      {selected && selectedEdge != null ? (
        <p className="hp-canvas-hint">
          Selected wall {selectedEdge + 1} · {mm(edgeLengths(selectedPoly)[selectedEdge] ?? 0)} ·{" "}
          {roomWallExterior(selected, selectedPoly.length)[selectedEdge] ? "exterior" : "internal"}
        </p>
      ) : null}
    </div>
  );
}

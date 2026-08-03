"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { numberFromInput, roomTypes, type FloorLevel, type HeatDesignRoom } from "@/lib/heat-design";

type FloorPlanCanvasProps = {
  rooms: HeatDesignRoom[];
  selectedRoomId: string | null;
  activeFloor: FloorLevel;
  onSelectRoom: (roomId: string | null) => void;
  onMoveRoom: (roomId: string, planX: number, planY: number) => void;
  onResizeRoom: (roomId: string, length: string, width: string, planX?: number, planY?: number) => void;
  onPatchRoom: (roomId: string, patch: Partial<HeatDesignRoom>) => void;
  onDeleteRoom: (roomId: string) => void;
  onChangeFloor: (floor: FloorLevel) => void;
};

const SCALE = 90; // px per metre — HeatPunk-like zoom
const PAD = 48;
const SNAP_M = 0.08;

type DragState =
  | { mode: "move"; roomId: string; offsetX: number; offsetY: number }
  | {
      mode: "resize";
      roomId: string;
      corner: "nw" | "ne" | "sw" | "se";
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      startL: number;
      startW: number;
    }
  | null;

function mm(metres: number) {
  return `${Math.round(metres * 1000)} mm`;
}

function snap(value: number, anchors: number[]) {
  let best = value;
  let bestDist = SNAP_M;
  for (const anchor of anchors) {
    const dist = Math.abs(value - anchor);
    if (dist < bestDist) {
      best = anchor;
      bestDist = dist;
    }
  }
  return best;
}

export function FloorPlanCanvas({
  rooms,
  selectedRoomId,
  activeFloor,
  onSelectRoom,
  onMoveRoom,
  onResizeRoom,
  onPatchRoom,
  onDeleteRoom,
  onChangeFloor,
}: FloorPlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const floorRooms = useMemo(
    () => rooms.filter((room) => (room.floorLevel ?? "ground") === activeFloor),
    [rooms, activeFloor],
  );

  const bounds = useMemo(() => {
    let maxX = 10;
    let maxY = 8;
    for (const room of floorRooms) {
      const l = numberFromInput(room.length, 3.5);
      const w = numberFromInput(room.width, 3);
      maxX = Math.max(maxX, (room.planX ?? 0) + l + 2);
      maxY = Math.max(maxY, (room.planY ?? 0) + w + 2);
    }
    return {
      width: Math.max(720, maxX * SCALE + PAD * 2),
      height: Math.max(480, maxY * SCALE + PAD * 2),
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
    const xs: number[] = [0];
    const ys: number[] = [0];
    for (const room of floorRooms) {
      const l = numberFromInput(room.length, 3.5);
      const w = numberFromInput(room.width, 3);
      xs.push(room.planX, room.planX + l);
      ys.push(room.planY, room.planY + w);
    }
    return { xs, ys };
  }, [floorRooms]);

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      const point = clientToMetres(event.clientX, event.clientY);
      if (drag?.mode === "move") {
        let nextX = Math.max(0, point.x - drag.offsetX);
        let nextY = Math.max(0, point.y - drag.offsetY);
        const room = floorRooms.find((r) => r.id === drag.roomId);
        const l = numberFromInput(room?.length, 3.5);
        const w = numberFromInput(room?.width, 3);
        const otherX = anchors.xs.filter((v) => {
          const r = floorRooms.find((item) => item.id === drag.roomId);
          return r ? v !== r.planX && v !== r.planX + l : true;
        });
        const otherY = anchors.ys.filter((v) => {
          const r = floorRooms.find((item) => item.id === drag.roomId);
          return r ? v !== r.planY && v !== r.planY + w : true;
        });
        const snappedX = snap(nextX, otherX);
        const snappedRight = snap(nextX + l, otherX) - l;
        const snappedY = snap(nextY, otherY);
        const snappedBottom = snap(nextY + w, otherY) - w;
        const guideX: number[] = [];
        const guideY: number[] = [];
        if (Math.abs(snappedX - nextX) < SNAP_M) {
          nextX = snappedX;
          guideX.push(nextX);
        } else if (Math.abs(snappedRight - nextX) < SNAP_M) {
          nextX = snappedRight;
          guideX.push(nextX + l);
        }
        if (Math.abs(snappedY - nextY) < SNAP_M) {
          nextY = snappedY;
          guideY.push(nextY);
        } else if (Math.abs(snappedBottom - nextY) < SNAP_M) {
          nextY = snappedBottom;
          guideY.push(nextY + w);
        }
        setGuides({ x: guideX, y: guideY });
        onMoveRoom(drag.roomId, nextX, nextY);
      } else if (drag?.mode === "resize") {
        const min = 1.5;
        let planX = drag.originX;
        let planY = drag.originY;
        let length = drag.startL;
        let width = drag.startW;
        if (drag.corner.includes("e")) {
          length = Math.max(min, point.x - drag.originX);
        }
        if (drag.corner.includes("w")) {
          const right = drag.originX + drag.startL;
          planX = Math.min(point.x, right - min);
          length = right - planX;
        }
        if (drag.corner.includes("s")) {
          width = Math.max(min, point.y - drag.originY);
        }
        if (drag.corner.includes("n")) {
          const bottom = drag.originY + drag.startW;
          planY = Math.min(point.y, bottom - min);
          width = bottom - planY;
        }
        setGuides({ x: [], y: [] });
        onResizeRoom(drag.roomId, length.toFixed(3), width.toFixed(3), planX, planY);
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
  }, [drag, floorRooms, anchors, onMoveRoom, onResizeRoom, bounds.width, bounds.height]);

  const selected = floorRooms.find((room) => room.id === selectedRoomId) ?? null;

  return (
    <div className="hp-canvas-shell">
      <div className="hp-canvas-wrap">
        <svg
          ref={svgRef}
          className="hp-canvas"
          width="100%"
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          role="img"
          aria-label="Floor plan canvas"
          onPointerDown={() => onSelectRoom(null)}
        >
          <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="#6d6d6d" />
          {/* subtle grid */}
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
            const length = numberFromInput(room.length, 3.5);
            const width = numberFromInput(room.width, 3);
            const height = numberFromInput(room.height, 2.4);
            const x = PAD + (room.planX ?? 0) * SCALE;
            const y = PAD + (room.planY ?? 0) * SCALE;
            const w = length * SCALE;
            const h = width * SCALE;
            const isSelected = room.id === selectedRoomId;
            const flags = room.exteriorFlags ?? [true, true, false, false];
            const wallStroke = (exterior: boolean) => (exterior ? 10 : 3);

            return (
              <g key={room.id}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="#f4f4f2"
                  stroke="none"
                  style={{ cursor: "grab" }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectRoom(room.id);
                    const point = clientToMetres(event.clientX, event.clientY);
                    setDrag({
                      mode: "move",
                      roomId: room.id,
                      offsetX: point.x - (room.planX ?? 0),
                      offsetY: point.y - (room.planY ?? 0),
                    });
                  }}
                />
                {/* exterior / internal wall strokes */}
                <line x1={x} y1={y} x2={x + w} y2={y} stroke="#111" strokeWidth={wallStroke(flags[0])} strokeLinecap="square" />
                <line x1={x + w} y1={y} x2={x + w} y2={y + h} stroke="#111" strokeWidth={wallStroke(flags[1])} strokeLinecap="square" />
                <line x1={x} y1={y + h} x2={x + w} y2={y + h} stroke="#111" strokeWidth={wallStroke(flags[2])} strokeLinecap="square" />
                <line x1={x} y1={y} x2={x} y2={y + h} stroke="#111" strokeWidth={wallStroke(flags[3])} strokeLinecap="square" />

                <text
                  x={x + w / 2}
                  y={y + h / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#8a8a8a"
                  fontSize={13}
                  fontWeight={600}
                  style={{ pointerEvents: "none" }}
                >
                  {mm(height)}
                </text>

                {/* openings */}
                {(room.openings ?? []).map((opening) => {
                  const t = Math.min(0.85, Math.max(0.15, opening.t));
                  const ow = Math.min(opening.widthM * SCALE, (opening.wall === 0 || opening.wall === 2 ? w : h) * 0.45);
                  let ox = x;
                  let oy = y;
                  let rw = ow;
                  let rh = 8;
                  if (opening.wall === 0) {
                    ox = x + t * w - ow / 2;
                    oy = y - 4;
                  } else if (opening.wall === 2) {
                    ox = x + t * w - ow / 2;
                    oy = y + h - 4;
                  } else if (opening.wall === 1) {
                    ox = x + w - 4;
                    oy = y + t * h - ow / 2;
                    rw = 8;
                    rh = ow;
                  } else {
                    ox = x - 4;
                    oy = y + t * h - ow / 2;
                    rw = 8;
                    rh = ow;
                  }
                  return (
                    <rect
                      key={opening.id}
                      x={ox}
                      y={oy}
                      width={rw}
                      height={rh}
                      fill={opening.kind === "door" ? "#fb7185" : "#fda4af"}
                      stroke="#be123c"
                      strokeWidth={1}
                      rx={2}
                      style={{ pointerEvents: "none" }}
                    />
                  );
                })}

                {isSelected ? (
                  <>
                    <text x={x + w / 2} y={y + h + 22} textAnchor="middle" fill="#e11d48" fontSize={15} fontWeight={800}>
                      {mm(length)}
                    </text>
                    <text
                      x={x + w + 10}
                      y={y + h / 2}
                      textAnchor="start"
                      dominantBaseline="middle"
                      fill="#e11d48"
                      fontSize={15}
                      fontWeight={800}
                    >
                      {mm(width)}
                    </text>
                    {(
                      [
                        ["nw", x, y],
                        ["ne", x + w, y],
                        ["sw", x, y + h],
                        ["se", x + w, y + h],
                      ] as const
                    ).map(([corner, cx, cy]) => (
                      <rect
                        key={corner}
                        x={cx - 5}
                        y={cy - 5}
                        width={10}
                        height={10}
                        fill="#fb7185"
                        stroke="#fff"
                        strokeWidth={1.5}
                        style={{ cursor: `${corner}-resize` }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectRoom(room.id);
                          const point = clientToMetres(event.clientX, event.clientY);
                          setDrag({
                            mode: "resize",
                            roomId: room.id,
                            corner,
                            startX: point.x,
                            startY: point.y,
                            originX: room.planX ?? 0,
                            originY: room.planY ?? 0,
                            startL: length,
                            startW: width,
                          });
                        }}
                      />
                    ))}
                    {/* mid-edge blue nodes */}
                    {[
                      [x + w * 0.33, y],
                      [x + w * 0.66, y],
                      [x + w, y + h * 0.33],
                      [x + w, y + h * 0.66],
                      [x + w * 0.33, y + h],
                      [x + w * 0.66, y + h],
                      [x, y + h * 0.33],
                      [x, y + h * 0.66],
                    ].map(([nx, ny], index) => (
                      <circle key={`n-${index}`} cx={nx} cy={ny} r={4.5} fill="#93c5fd" stroke="#fff" strokeWidth={1.5} />
                    ))}
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>

        {selected ? (
          <div
            className="hp-room-toolbar"
            style={{
              left: `calc(${((PAD + selected.planX * SCALE + (numberFromInput(selected.length) * SCALE) / 2) / bounds.width) * 100}%)`,
              top: `calc(${((PAD + selected.planY * SCALE) / bounds.height) * 100}% - 52px)`,
            }}
          >
            <button
              type="button"
              title="Ceiling height"
              onClick={() => {
                const next = window.prompt("Ceiling height (mm)", String(Math.round(numberFromInput(selected.height, 2.4) * 1000)));
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
        Drag rooms to move · corner handles resize (mm live) · edges snap · thick walls = external · pink marks =
        windows/doors
      </p>
    </div>
  );
}

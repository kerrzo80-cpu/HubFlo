"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { numberFromInput, roomColor, type HeatDesignRoom } from "@/lib/heat-design";

type FloorPlanCanvasProps = {
  rooms: HeatDesignRoom[];
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onMoveRoom: (roomId: string, planX: number, planY: number) => void;
  onResizeRoom: (roomId: string, length: string, width: string) => void;
};

const SCALE = 36; // px per metre
const PAD = 24;

type DragState =
  | { mode: "move"; roomId: string; offsetX: number; offsetY: number }
  | { mode: "resize"; roomId: string; startX: number; startY: number; startL: number; startW: number }
  | null;

export function FloorPlanCanvas({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onMoveRoom,
  onResizeRoom,
}: FloorPlanCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState>(null);

  const bounds = useMemo(() => {
    let maxX = 12;
    let maxY = 10;
    for (const room of rooms) {
      const l = numberFromInput(room.length, 4);
      const w = numberFromInput(room.width, 3);
      maxX = Math.max(maxX, (room.planX ?? 0) + l + 2);
      maxY = Math.max(maxY, (room.planY ?? 0) + w + 2);
    }
    return { width: maxX * SCALE + PAD * 2, height: maxY * SCALE + PAD * 2, metresX: maxX, metresY: maxY };
  }, [rooms]);

  function clientToMetres(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - PAD) / SCALE,
      y: (clientY - rect.top - PAD) / SCALE,
    };
  }

  useEffect(() => {
    if (!drag) return;

    function onMove(event: PointerEvent) {
      const point = clientToMetres(event.clientX, event.clientY);
      if (drag?.mode === "move") {
        onMoveRoom(drag.roomId, Math.max(0, point.x - drag.offsetX), Math.max(0, point.y - drag.offsetY));
      } else if (drag?.mode === "resize") {
        const nextL = Math.max(1.5, drag.startL + (point.x - drag.startX));
        const nextW = Math.max(1.5, drag.startW + (point.y - drag.startY));
        onResizeRoom(drag.roomId, nextL.toFixed(1), nextW.toFixed(1));
      }
    }

    function onUp() {
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, onMoveRoom, onResizeRoom]);

  const gridLines = [];
  for (let m = 0; m <= Math.ceil(bounds.metresX); m += 1) {
    gridLines.push(
      <line
        key={`vx-${m}`}
        x1={PAD + m * SCALE}
        y1={PAD}
        x2={PAD + m * SCALE}
        y2={bounds.height - PAD}
        stroke="rgba(20,33,28,0.08)"
        strokeWidth={m % 5 === 0 ? 1.5 : 1}
      />,
    );
  }
  for (let m = 0; m <= Math.ceil(bounds.metresY); m += 1) {
    gridLines.push(
      <line
        key={`hy-${m}`}
        x1={PAD}
        y1={PAD + m * SCALE}
        x2={bounds.width - PAD}
        y2={PAD + m * SCALE}
        stroke="rgba(20,33,28,0.08)"
        strokeWidth={m % 5 === 0 ? 1.5 : 1}
      />,
    );
  }

  return (
    <div className="hd-canvas-wrap">
      <div className="hd-canvas-toolbar">
        <span>1 square = 1 m · drag rooms to move · corner handle to resize</span>
      </div>
      <svg
        ref={svgRef}
        className="hd-canvas"
        width="100%"
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        role="img"
        aria-label="Floor plan canvas"
      >
        <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="#fbfaf6" rx={16} />
        {gridLines}
        {rooms.map((room, index) => {
          const length = numberFromInput(room.length, 4);
          const width = numberFromInput(room.width, 3);
          const x = PAD + (room.planX ?? 0) * SCALE;
          const y = PAD + (room.planY ?? 0) * SCALE;
          const w = length * SCALE;
          const h = width * SCALE;
          const selected = room.id === selectedRoomId;
          const fill = roomColor(index);
          return (
            <g key={room.id}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={10}
                fill={selected ? fill : `${fill}33`}
                stroke={fill}
                strokeWidth={selected ? 3 : 2}
                style={{ cursor: "grab" }}
                onPointerDown={(event) => {
                  event.preventDefault();
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
              <text
                x={x + w / 2}
                y={y + h / 2 - 6}
                textAnchor="middle"
                fill="#14211c"
                fontSize={13}
                fontWeight={700}
                style={{ pointerEvents: "none" }}
              >
                {room.name}
              </text>
              <text
                x={x + w / 2}
                y={y + h / 2 + 12}
                textAnchor="middle"
                fill="#5c6b64"
                fontSize={11}
                style={{ pointerEvents: "none" }}
              >
                {length.toFixed(1)} × {width.toFixed(1)} m
              </text>
              <circle
                cx={x + w - 4}
                cy={y + h - 4}
                r={8}
                fill="#fff"
                stroke={fill}
                strokeWidth={2}
                style={{ cursor: "nwse-resize" }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectRoom(room.id);
                  const point = clientToMetres(event.clientX, event.clientY);
                  setDrag({
                    mode: "resize",
                    roomId: room.id,
                    startX: point.x,
                    startY: point.y,
                    startL: length,
                    startW: width,
                  });
                }}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

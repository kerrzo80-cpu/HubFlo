"use client";

import {
  openingOnEdge,
  polygonBounds,
  roomPolygon,
  roomWallExterior,
  type HeatDesignRoom,
} from "@/lib/heat-design";

const SCALE = 28;
const PAD = 16;

/** Compact SVG floor plan for the printable report. */
export function ReportFloorPlan({ rooms, title }: { rooms: HeatDesignRoom[]; title?: string }) {
  let minX = 0;
  let minY = 0;
  let maxX = 8;
  let maxY = 6;
  for (const room of rooms) {
    const box = polygonBounds(roomPolygon(room));
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  const width = Math.max(320, (maxX - minX) * SCALE + PAD * 2);
  const height = Math.max(220, (maxY - minY) * SCALE + PAD * 2);
  const ox = -minX;
  const oy = -minY;

  return (
    <div className="hd-report-plan">
      {title ? <h4>{title}</h4> : null}
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Floor plan drawing">
        <rect x={0} y={0} width={width} height={height} fill="#f3f4f6" />
        {rooms.map((room) => {
          const polygon = roomPolygon(room);
          const exterior = roomWallExterior(room, polygon.length);
          const points = polygon
            .map((p) => `${PAD + (p.x + ox) * SCALE},${PAD + (p.y + oy) * SCALE}`)
            .join(" ");
          const centroid = polygon.reduce(
            (acc, p) => ({ x: acc.x + p.x / polygon.length, y: acc.y + p.y / polygon.length }),
            { x: 0, y: 0 },
          );
          return (
            <g key={room.id}>
              <polygon points={points} fill="#fff" stroke="none" />
              {polygon.map((p, i) => {
                const q = polygon[(i + 1) % polygon.length]!;
                return (
                  <line
                    key={`${room.id}-e-${i}`}
                    x1={PAD + (p.x + ox) * SCALE}
                    y1={PAD + (p.y + oy) * SCALE}
                    x2={PAD + (q.x + ox) * SCALE}
                    y2={PAD + (q.y + oy) * SCALE}
                    stroke="#111"
                    strokeWidth={exterior[i] ? 3.5 : 1.25}
                  />
                );
              })}
              {(room.openings ?? []).map((opening) => {
                const geom = openingOnEdge(polygon, {
                  ...opening,
                  wallIndex: opening.wallIndex ?? opening.wall ?? 0,
                });
                return (
                  <line
                    key={opening.id}
                    x1={PAD + (geom.x1 + ox) * SCALE}
                    y1={PAD + (geom.y1 + oy) * SCALE}
                    x2={PAD + (geom.x2 + ox) * SCALE}
                    y2={PAD + (geom.y2 + oy) * SCALE}
                    stroke={opening.kind === "door" ? "#be123c" : "#0369a1"}
                    strokeWidth={4}
                  />
                );
              })}
              <text
                x={PAD + (centroid.x + ox) * SCALE}
                y={PAD + (centroid.y + oy) * SCALE}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fontWeight={700}
                fill="#334155"
              >
                {room.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

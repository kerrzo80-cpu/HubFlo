"use client";

import {
  openingOnEdge,
  pipeStroke,
  plantFill,
  polygonBounds,
  roomPolygon,
  roomWallExterior,
  type HeatDesignRoom,
  type HeatingSystemLayout,
} from "@/lib/heat-design";

const SCALE = 28;
const PAD = 16;

/** Compact SVG floor plan for the printable report. */
export function ReportFloorPlan({
  rooms,
  title,
  layout,
}: {
  rooms: HeatDesignRoom[];
  title?: string;
  layout?: HeatingSystemLayout | null;
}) {
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
  const floor = rooms[0]?.floorLevel ?? "ground";
  const plants = (layout?.plants ?? []).filter((plant) => (plant.floorLevel ?? "ground") === floor);
  const pipes = (layout?.pipes ?? []).filter((pipe) => (pipe.floorLevel ?? "ground") === floor);
  for (const plant of plants) {
    const halfW = (plant.widthM ?? 0.5) / 2;
    const halfD = (plant.depthM ?? 0.35) / 2;
    minX = Math.min(minX, plant.x - halfW);
    minY = Math.min(minY, plant.y - halfD);
    maxX = Math.max(maxX, plant.x + halfW);
    maxY = Math.max(maxY, plant.y + halfD);
  }
  for (const pipe of pipes) {
    for (const p of pipe.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
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

        {pipes.map((pipe) => {
          const style = pipeStroke(pipe.kind);
          const points = pipe.points
            .map((p) => `${PAD + (p.x + ox) * SCALE},${PAD + (p.y + oy) * SCALE}`)
            .join(" ");
          return (
            <polyline
              key={pipe.id}
              points={points}
              fill="none"
              stroke={style.stroke}
              strokeWidth={Math.max(1.5, style.width * 0.55)}
              strokeDasharray={style.dash}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
          );
        })}

        {plants.map((plant) => {
          const w = (plant.widthM ?? 0.5) * SCALE;
          const d = (plant.depthM ?? 0.35) * SCALE;
          const cx = PAD + (plant.x + ox) * SCALE;
          const cy = PAD + (plant.y + oy) * SCALE;
          return (
            <g key={plant.id}>
              <rect
                x={cx - w / 2}
                y={cy - d / 2}
                width={w}
                height={d}
                rx={2}
                fill={plantFill(plant.kind)}
                stroke="#fff"
                strokeWidth={1}
              />
              <text
                x={cx}
                y={cy - d / 2 - 4}
                textAnchor="middle"
                fontSize={8}
                fontWeight={700}
                fill="#0f172a"
              >
                {plant.label}
              </text>
            </g>
          );
        })}
      </svg>
      {layout ? (
        <p className="hd-report-plan-key">
          Layout overlay: plant positions + pipework for the chosen system (dragged on the floor plan). Flow red ·
          return blue · primary teal.
        </p>
      ) : null}
    </div>
  );
}

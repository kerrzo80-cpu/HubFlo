"use client";

import {
  openingOnEdge,
  pipeStroke,
  plantFill,
  polygonBounds,
  roomPolygon,
  roomWallExterior,
  type FloorLevel,
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
  floorLevel,
}: {
  rooms: HeatDesignRoom[];
  title?: string;
  layout?: HeatingSystemLayout | null;
  floorLevel?: FloorLevel;
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
  const floor = floorLevel ?? rooms[0]?.floorLevel ?? "ground";
  const plants = (layout?.plants ?? []).filter((plant) => (plant.floorLevel ?? "ground") === floor);
  const pipes = (layout?.pipes ?? []).filter((pipe) => (pipe.floorLevel ?? "ground") === floor);
  const emitters = (layout?.emitters ?? []).filter((item) => (item.floorLevel ?? "ground") === floor);
  for (const plant of plants) {
    const halfW = (plant.widthM ?? 0.5) / 2;
    const halfD = (plant.depthM ?? 0.35) / 2;
    minX = Math.min(minX, plant.x - halfW);
    minY = Math.min(minY, plant.y - halfD);
    maxX = Math.max(maxX, plant.x + halfW);
    maxY = Math.max(maxY, plant.y + halfD);
  }
  for (const emitter of emitters) {
    minX = Math.min(minX, emitter.x - emitter.widthM / 2);
    minY = Math.min(minY, emitter.y - emitter.depthM / 2);
    maxX = Math.max(maxX, emitter.x + emitter.widthM / 2);
    maxY = Math.max(maxY, emitter.y + emitter.depthM / 2);
  }
  for (const pipe of pipes) {
    for (const p of pipe.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const ox = -minX + 0.2;
  const oy = -minY + 0.2;
  const width = Math.max(320, (maxX - minX + 0.4) * SCALE + PAD * 2);
  const height = Math.max(220, (maxY - minY + 0.4) * SCALE + PAD * 2);

  function px(x: number) {
    return PAD + (x + ox) * SCALE;
  }
  function py(y: number) {
    return PAD + (y + oy) * SCALE;
  }

  return (
    <div className="hd-report-plan">
      {title ? <h4>{title}</h4> : null}
      <div className="hd-report-plan-frame">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Floor plan drawing"
        >
        <rect x={0} y={0} width={width} height={height} fill="#f3f4f6" />
        {rooms.map((room) => {
          const polygon = roomPolygon(room);
          const exterior = roomWallExterior(room, polygon.length);
          const points = polygon.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
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
                    x1={px(p.x)}
                    y1={py(p.y)}
                    x2={px(q.x)}
                    y2={py(q.y)}
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
                    x1={px(geom.x1)}
                    y1={py(geom.y1)}
                    x2={px(geom.x2)}
                    y2={py(geom.y2)}
                    stroke={opening.kind === "door" ? "#be123c" : "#0369a1"}
                    strokeWidth={4}
                  />
                );
              })}
              <text
                x={px(centroid.x)}
                y={py(centroid.y)}
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

        {emitters.map((emitter) => {
          const w = emitter.widthM * SCALE;
          const d = emitter.depthM * SCALE;
          const cx = px(emitter.x);
          const cy = py(emitter.y);
          if (emitter.kind === "ufh") {
            return (
              <rect
                key={emitter.id}
                x={cx - w / 2}
                y={cy - d / 2}
                width={w}
                height={d}
                fill="rgba(14, 116, 144, 0.1)"
                stroke="#0891b2"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            );
          }
          return (
            <g key={emitter.id} transform={`rotate(${emitter.rotationDeg} ${cx} ${cy})`}>
              <rect x={cx - w / 2} y={cy - d / 2} width={w} height={d} rx={1} fill="#f43f5e" />
            </g>
          );
        })}

        {pipes.map((pipe) => {
          const style = pipeStroke(pipe.kind);
          const points = pipe.points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
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
          const cx = px(plant.x);
          const cy = py(plant.y);
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
              <text x={cx} y={cy - d / 2 - 4} textAnchor="middle" fontSize={8} fontWeight={700} fill="#0f172a">
                {plant.label}
              </text>
            </g>
          );
        })}
        </svg>
      </div>
      {layout ? (
        <p className="hd-report-plan-key">
          Overlay: plant,{" "}
          {layout.emitterMode === "ufh"
            ? "UFH"
            : layout.emitterMode === "radiators"
              ? "radiators"
              : "radiators / UFH"}{" "}
          and pipework. Flow red · return blue · primary teal · refrigerant purple.
        </p>
      ) : null}
    </div>
  );
}

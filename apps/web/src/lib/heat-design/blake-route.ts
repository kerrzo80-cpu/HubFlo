/**
 * Blake route sizing + fittings summary for Heat Design layouts.
 * Elbows / couplings / reducers (28→22→15) feed Takeoff BOQ.
 */

import { dist } from "./geometry";
import { sizeTierForPipe } from "./layout";
import type {
  HeatingPipeDiameterMm,
  HeatingPipeRun,
  HeatingSystemLayout,
  PlanPoint,
} from "./types";

export type HeatingFittingBucket = {
  diameterMm: HeatingPipeDiameterMm;
  metres: number;
  elbows: number;
  couplings: number;
};

export type HeatingFittingsSummary = {
  bySize: HeatingFittingBucket[];
  reducers: Array<{ fromMm: HeatingPipeDiameterMm; toMm: HeatingPipeDiameterMm; count: number }>;
  totalMetres: number;
  totalElbows: number;
  totalCouplings: number;
  totalReducers: number;
  notes: string[];
};

function polylineLengthM(points: PlanPoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    total += dist(a, b);
  }
  return total;
}

/** Metre-space bend test (Heat Design coords are metres, not PDF pixels). */
export function isRightAngleBendMetres(previous: PlanPoint, bend: PlanPoint, next: PlanPoint) {
  const firstX = previous.x - bend.x;
  const firstY = previous.y - bend.y;
  const secondX = next.x - bend.x;
  const secondY = next.y - bend.y;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);
  if (firstLength < 0.08 || secondLength < 0.08) return false;
  const cosine = Math.abs((firstX * secondX + firstY * secondY) / (firstLength * secondLength));
  return cosine <= 0.55;
}

export function countElbowsMetres(points: PlanPoint[]) {
  if (points.length < 3) return 0;
  let count = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const bend = points[index];
    const next = points[index + 1];
    if (!previous || !bend || !next) continue;
    if (isRightAngleBendMetres(previous, bend, next)) count += 1;
  }
  return count;
}

export function countCouplingsMetres(lengthM: number, stockLengthM = 3) {
  if (!(lengthM > 0) || !(stockLengthM > 0)) return 0;
  return Math.floor(lengthM / stockLengthM);
}

/** Apply Blake size tiers (28 / 22 / 15) onto an existing layout’s pipes. */
export function applyBlakePipeSizing(layout: HeatingSystemLayout): HeatingSystemLayout {
  return {
    ...layout,
    pipes: layout.pipes.map((pipe) => {
      const tier = sizeTierForPipe(pipe.kind, pipe.label);
      return {
        ...pipe,
        diameterMm: tier.diameterMm,
        pipeSpecId: tier.pipeSpecId,
        material: tier.material,
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

function endpointPairsNear(
  a: HeatingPipeRun,
  b: HeatingPipeRun,
  toleranceM = 0.18,
): boolean {
  const aEnds = [a.points[0], a.points[a.points.length - 1]].filter(Boolean) as PlanPoint[];
  const bEnds = [b.points[0], b.points[b.points.length - 1]].filter(Boolean) as PlanPoint[];
  for (const pa of aEnds) {
    for (const pb of bEnds) {
      if (dist(pa, pb) <= toleranceM) return true;
    }
  }
  return false;
}

function reducerKey(fromMm: HeatingPipeDiameterMm, toMm: HeatingPipeDiameterMm) {
  const hi = Math.max(fromMm, toMm) as HeatingPipeDiameterMm;
  const lo = Math.min(fromMm, toMm) as HeatingPipeDiameterMm;
  return `${hi}->${lo}`;
}

/** Summarise metres, elbows, couplings and reducers for the sized network. */
export function summariseHeatingFittings(layout: HeatingSystemLayout): HeatingFittingsSummary {
  const sized = applyBlakePipeSizing(layout);
  const buckets = new Map<HeatingPipeDiameterMm, HeatingFittingBucket>();
  for (const diameterMm of [28, 22, 15] as HeatingPipeDiameterMm[]) {
    buckets.set(diameterMm, { diameterMm, metres: 0, elbows: 0, couplings: 0 });
  }

  for (const pipe of sized.pipes) {
    if (pipe.kind === "refrigerant" || pipe.kind === "gas" || pipe.kind === "oil") {
      // Still size for BOQ copper/fuel lines; gas/oil counted as copper proxy in v1.
    }
    const diameterMm = pipe.diameterMm || 22;
    const bucket = buckets.get(diameterMm) || {
      diameterMm,
      metres: 0,
      elbows: 0,
      couplings: 0,
    };
    const metres = polylineLengthM(pipe.points);
    bucket.metres += metres;
    bucket.elbows += countElbowsMetres(pipe.points);
    bucket.couplings += countCouplingsMetres(metres, 3);
    buckets.set(diameterMm, bucket);
  }

  const reducerCounts = new Map<string, { fromMm: HeatingPipeDiameterMm; toMm: HeatingPipeDiameterMm; count: number }>();
  for (let i = 0; i < sized.pipes.length; i += 1) {
    for (let j = i + 1; j < sized.pipes.length; j += 1) {
      const a = sized.pipes[i]!;
      const b = sized.pipes[j]!;
      if (!a.diameterMm || !b.diameterMm || a.diameterMm === b.diameterMm) continue;
      if (!endpointPairsNear(a, b)) continue;
      const fromMm = Math.max(a.diameterMm, b.diameterMm) as HeatingPipeDiameterMm;
      const toMm = Math.min(a.diameterMm, b.diameterMm) as HeatingPipeDiameterMm;
      const key = reducerKey(fromMm, toMm);
      const current = reducerCounts.get(key) || { fromMm, toMm, count: 0 };
      current.count += 1;
      reducerCounts.set(key, current);
    }
  }

  const bySize = [...buckets.values()].filter((row) => row.metres > 0.01 || row.elbows || row.couplings);
  const reducers = [...reducerCounts.values()].sort((a, b) => b.fromMm - a.fromMm || a.toMm - b.toMm);
  const totalMetres = bySize.reduce((sum, row) => sum + row.metres, 0);
  const totalElbows = bySize.reduce((sum, row) => sum + row.elbows, 0);
  const totalCouplings = bySize.reduce((sum, row) => sum + row.couplings, 0);
  const totalReducers = reducers.reduce((sum, row) => sum + row.count, 0);

  const notes = [
    "Blake sized mains 28 mm, branches 22 mm, rad/UFH tails 15 mm.",
    "Elbows at right-angle bends · couplings every 3 m · reducers where sizes meet.",
    "Send to Takeoff to put this network on the BOQ for Push.",
  ];

  return {
    bySize: bySize.map((row) => ({
      ...row,
      metres: Number(row.metres.toFixed(2)),
    })),
    reducers,
    totalMetres: Number(totalMetres.toFixed(2)),
    totalElbows,
    totalCouplings,
    totalReducers,
    notes,
  };
}

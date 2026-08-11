/**
 * Two-click drawing scale for Heat Design underlays.
 * Plan coordinates are metres; calibration rescales underlay + geometry so those metres are real.
 */

import { dist, roomPolygon, syncRoomFromPolygon } from "./geometry";
import type {
  HeatDesignRoom,
  HeatingSystemLayout,
  PlanPoint,
  PlanScaleCalibration,
  PlanUnderlay,
} from "./types";

export type ScaleCalibrationResult = {
  underlay: PlanUnderlay;
  rooms: HeatDesignRoom[];
  layout: HeatingSystemLayout | null;
  scaleFactor: number;
  measuredPlanM: number;
};

function scalePoint(point: PlanPoint, factor: number, origin: PlanPoint): PlanPoint {
  return {
    x: origin.x + (point.x - origin.x) * factor,
    y: origin.y + (point.y - origin.y) * factor,
  };
}

function scaleLayout(layout: HeatingSystemLayout, factor: number, origin: PlanPoint): HeatingSystemLayout {
  return {
    ...layout,
    plants: layout.plants.map((plant) => ({
      ...plant,
      x: origin.x + (plant.x - origin.x) * factor,
      y: origin.y + (plant.y - origin.y) * factor,
      widthM: plant.widthM != null ? plant.widthM * factor : plant.widthM,
      depthM: plant.depthM != null ? plant.depthM * factor : plant.depthM,
    })),
    pipes: layout.pipes.map((pipe) => ({
      ...pipe,
      points: pipe.points.map((point) => scalePoint(point, factor, origin)),
    })),
    emitters: (layout.emitters ?? []).map((emitter) => ({
      ...emitter,
      x: origin.x + (emitter.x - origin.x) * factor,
      y: origin.y + (emitter.y - origin.y) * factor,
      widthM: emitter.widthM * factor,
      depthM: emitter.depthM * factor,
    })),
    updatedAt: new Date().toISOString(),
  };
}

/** True when the underlay has a completed two-point known-distance calibration. */
export function isPlanScaleCalibrated(underlay: PlanUnderlay | null | undefined): boolean {
  const scale = underlay?.scale;
  return Boolean(
    scale?.calibrated &&
      Number.isFinite(scale.knownMetres) &&
      scale.knownMetres > 0 &&
      scale.from &&
      scale.to &&
      dist(scale.from, scale.to) > 0.01,
  );
}

/**
 * Apply a known real-world distance between two plan points.
 * Rescales underlay extents and existing rooms / layout so subsequent areas and pipe lengths are metres.
 */
export function applyPlanScaleCalibration(
  underlay: PlanUnderlay,
  from: PlanPoint,
  to: PlanPoint,
  knownMetres: number,
  rooms: HeatDesignRoom[] = [],
  layout: HeatingSystemLayout | null = null,
): ScaleCalibrationResult {
  const measuredPlanM = dist(from, to);
  if (!(knownMetres > 0) || !(measuredPlanM > 0.001)) {
    throw new Error("Scale needs two distinct points and a known length in metres.");
  }
  const scaleFactor = knownMetres / measuredPlanM;
  const origin: PlanPoint = {
    x: underlay.originX,
    y: underlay.originY,
  };

  const calibration: PlanScaleCalibration = {
    calibrated: true,
    knownMetres,
    from: scalePoint(from, scaleFactor, origin),
    to: scalePoint(to, scaleFactor, origin),
    measuredPlanM,
    scaleFactor,
    calibratedAt: new Date().toISOString(),
  };

  const nextUnderlay: PlanUnderlay = {
    ...underlay,
    widthM: underlay.widthM * scaleFactor,
    heightM: underlay.heightM * scaleFactor,
    scale: calibration,
  };

  const nextRooms = rooms.map((room) => {
    const polygon = roomPolygon(room).map((point) => scalePoint(point, scaleFactor, origin));
    return syncRoomFromPolygon(
      {
        ...room,
        openings: (room.openings ?? []).map((opening) => ({
          ...opening,
          widthM: opening.widthM * scaleFactor,
          // Opening height is vertical — leave unchanged when rescaling the plan.
        })),
      },
      polygon,
    );
  });

  const nextLayout = layout ? scaleLayout(layout, scaleFactor, origin) : null;

  return {
    underlay: nextUnderlay,
    rooms: nextRooms,
    layout: nextLayout,
    scaleFactor,
    measuredPlanM,
  };
}

/** Metres represented by a draft calibration segment before Apply. */
export function draftScaleLengthM(from: PlanPoint | null | undefined, to: PlanPoint | null | undefined): number {
  if (!from || !to) return 0;
  return dist(from, to);
}

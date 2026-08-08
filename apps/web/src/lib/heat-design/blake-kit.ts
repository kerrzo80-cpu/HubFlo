/**
 * Blake ancillaries / valves / “bits and pieces” for a heating design.
 * Complements plant kit + sized pipe fittings (elbows/couplings/reducers).
 */

import type { HeatingFittingsSummary } from "./blake-route";
import { summariseHeatingFittings } from "./blake-route";
import type { HeatingSystemKind } from "./systems";
import type {
  HeatingEmitterMode,
  HeatingSystemLayout,
  KitLine,
} from "./types";

export type BlakeTakeoffAllowance = {
  id: string;
  section: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  markupPercent: number;
  supplierRequired: boolean;
  blakeNote?: string;
};

export type BlakeKitInput = {
  systemKind: HeatingSystemKind;
  emitterMode: HeatingEmitterMode;
  layout?: HeatingSystemLayout | null;
  roomCount?: number;
  floorAreaM2?: number;
  /** Prefetched fittings; otherwise derived from layout. */
  fittings?: HeatingFittingsSummary;
};

function line(
  id: string,
  category: string,
  description: string,
  qty: number,
  unitCost: number,
  unit?: string,
): KitLine {
  return {
    id: `kit-blake-${id}`,
    category,
    description,
    qty: Math.max(0, qty),
    unitCost,
    unit,
    required: true,
  };
}

/** Count layout facts Blake uses for ancillaries. */
export function layoutCounts(layout?: HeatingSystemLayout | null) {
  const plants = layout?.plants || [];
  const emitters = layout?.emitters || [];
  const rads = emitters.filter((row) => row.kind === "radiator").length;
  const ufhZones = emitters.filter((row) => row.kind === "ufh").length;
  const hasBoiler = plants.some((p) => p.kind === "boiler" || p.kind === "electric_boiler");
  const hasAshp = plants.some((p) => p.kind === "outdoor_unit");
  const hasCylinder = plants.some((p) => p.kind === "cylinder" || p.kind === "buffer");
  const hasManifold = plants.some((p) => p.kind === "manifold");
  return {
    rads,
    ufhZones,
    hasBoiler,
    hasAshp,
    hasCylinder,
    hasManifold,
    plantCount: plants.length,
  };
}

/**
 * Valves, drains, AAVs, clips, emitter packs and system-specific ancillaries.
 * Safe to append after buildKitLines — ids are prefixed kit-blake-*.
 */
export function buildBlakeAncillariesKit(input: BlakeKitInput): KitLine[] {
  const mode = input.emitterMode || "radiators";
  const counts = layoutCounts(input.layout);
  const fittings = input.fittings || (input.layout ? summariseHeatingFittings(input.layout) : null);
  const rooms = Math.max(1, input.roomCount || counts.rads || counts.ufhZones || 1);
  const rads = Math.max(mode === "ufh" ? 0 : 1, counts.rads || (mode === "radiators" || mode === "mixed" ? rooms : 0));
  const ufhZones = Math.max(
    mode === "radiators" ? 0 : 1,
    counts.ufhZones || (mode === "ufh" || mode === "mixed" ? Math.max(1, Math.round(rooms * 0.35)) : 0),
  );
  const pipeM = Math.max(8, Math.round(fittings?.totalMetres || (input.floorAreaM2 || 80) * 1.1));
  const lines: KitLine[] = [];

  // ——— System hydraulics / valves ———
  lines.push(line("filling-loop", "Valves", "Filling loop + double check valve", 1, 28));
  lines.push(line("prv", "Valves", "System PRV / expansion relief set", 1, 22));
  lines.push(line("gauge", "Valves", "System pressure gauge", 1, 12));
  lines.push(line("bypass", "Valves", "Automatic bypass valve", 1, 48));
  lines.push(
    line(
      "drain",
      "Valves",
      "Drain cock / hose union",
      Math.max(2, (counts.hasBoiler || counts.hasAshp ? 1 : 0) + (counts.hasCylinder ? 1 : 0) + (counts.hasManifold ? 1 : 0)),
      6.5,
    ),
  );
  lines.push(
    line(
      "aav",
      "Valves",
      "Automatic air vent",
      Math.max(2, 1 + (counts.hasManifold ? 1 : 0) + Math.ceil(rads / 6)),
      9.5,
    ),
  );
  lines.push(
    line(
      "iso-plant",
      "Valves",
      "Plant isolation valves (pair)",
      Math.max(2, (counts.hasBoiler || counts.hasAshp ? 1 : 0) + (counts.hasCylinder ? 1 : 0) + (counts.hasManifold ? 1 : 0)),
      18,
    ),
  );

  if (counts.hasCylinder || input.systemKind !== "electric") {
    lines.push(line("zone-dhw", "Controls", "2-port zone valve — DHW / cylinder", 1, 55));
  }
  lines.push(line("zone-ch", "Controls", "2-port zone valve — heating", mode === "mixed" ? 2 : 1, 55));
  lines.push(line("wiring-centre", "Controls", "Wiring centre / junction box", 1, 42));

  // ——— Pipe fixings / insulation ———
  lines.push(line("clips", "Pipework", "Pipe clips / saddles", Math.max(20, Math.ceil(pipeM * 1.6)), 0.45, "nr"));
  lines.push(line("insulation", "Pipework", "Pipe insulation (lagging)", pipeM, 1.85, "m"));
  lines.push(line("pipe-paste", "Pipework", "Jointing paste / PTFE / flux pack", 1, 16));

  // ——— Emitter ancillaries ———
  if (rads > 0) {
    lines.push(line("trv", "Emitters", "TRV", rads, 18));
    lines.push(line("lockshield", "Emitters", "Lockshield valve", rads, 9));
    lines.push(line("rad-tails", "Emitters", "Radiator tails / copper set", rads, 12));
    lines.push(line("rad-brackets", "Emitters", "Radiator brackets / packers", rads, 8.5));
    lines.push(line("bleed-key", "Emitters", "Radiator bleed key (pack)", 1, 3.5));
  }
  if (ufhZones > 0 || mode === "ufh" || mode === "mixed") {
    lines.push(line("ufh-actuator", "Emitters", "UFH manifold actuator", Math.max(3, ufhZones + 2), 22));
    lines.push(line("ufh-sensor", "Emitters", "UFH floor / slab sensor", Math.max(1, ufhZones), 18));
    if (!counts.hasManifold) {
      lines.push(line("ufh-blend", "Emitters", "UFH blending / pumpset allowance", 1, 220));
    }
  }

  // ——— Fuel / plant specific ———
  if (input.systemKind === "gas" || input.systemKind === "hybrid" || input.systemKind === "lpg") {
    lines.push(line("condensate", "Boiler", "Condensate pipe + neutraliser allowance", 1, 35));
    lines.push(line("magna-extra", "Hydraulics", "System cleanser / flush chemicals", 1, 45));
  }
  if (input.systemKind === "ashp" || input.systemKind === "hybrid") {
    lines.push(line("ashp-flex", "Heat pump", "Outdoor unit flexible hose kit", 1, 65));
    lines.push(line("ashp-glycol", "Heat pump", "Antifreeze / inhibitor top-up pack", 1, 55));
    lines.push(line("ashp-base", "Heat pump", "Anti-vibration mounts / base pad", 1, 48));
  }
  if (input.systemKind === "oil") {
    lines.push(line("oil-filter", "Fuel", "Oil filter / fire valve allowance", 1, 65));
  }

  // ——— Cylinder G3 bits if cylinder present ———
  if (counts.hasCylinder || input.systemKind === "ashp" || input.systemKind === "hybrid") {
    lines.push(line("g3-tundish", "Cylinder", "G3 tundish / discharge pipe allowance", 1, 42));
    lines.push(line("cyl-stat", "Cylinder", "Cylinder thermostat / sensor", 1, 28));
  }

  // Drop zero-qty rows
  return lines.filter((row) => row.qty > 0);
}

/** Pipe fittings summary → takeoff material lines (elbows / couplings by size). */
export function fittingsMaterialAllowances(
  fittings: HeatingFittingsSummary,
  projectId: string,
): BlakeTakeoffAllowance[] {
  const lines: BlakeTakeoffAllowance[] = [];
  for (const row of fittings.bySize) {
    if (row.elbows > 0) {
      lines.push({
        id: `studio-mat-${projectId}-blake-elbow-${row.diameterMm}`,
        section: "Fittings",
        description: `Takeoff · ${row.diameterMm}mm Copper 90° elbow`,
        quantity: row.elbows,
        unit: "nr",
        unitCost: 1.85,
        markupPercent: 0,
        supplierRequired: false,
        blakeNote: "Blake route planner — elbows at right-angle bends",
      });
    }
    if (row.couplings > 0) {
      lines.push({
        id: `studio-mat-${projectId}-blake-coupling-${row.diameterMm}`,
        section: "Fittings",
        description: `Takeoff · ${row.diameterMm}mm Copper coupling`,
        quantity: row.couplings,
        unit: "nr",
        unitCost: 1.35,
        markupPercent: 0,
        supplierRequired: false,
        blakeNote: "Blake route planner — couplings every 3 m",
      });
    }
  }
  return lines;
}

/** Convert Blake kit lines into takeoff materialAllowances. */
export function blakeKitMaterialAllowances(
  kitLines: KitLine[],
  projectId: string,
): BlakeTakeoffAllowance[] {
  return kitLines
    .filter((row) => row.qty > 0 && row.unitCost >= 0)
    .map((row) => ({
      id: `studio-mat-${projectId}-blake-${row.id.replace(/^kit-blake-/, "")}`,
      section: row.category || "Ancillaries",
      description: `Takeoff · ${row.description}`,
      quantity: row.qty,
      unit: row.unit || "nr",
      unitCost: row.unitCost,
      markupPercent: 0,
      supplierRequired: false,
      blakeNote: "Blake ancillaries kit from Heat Design",
    }));
}

/** All Blake-derived takeoff allowances: reducers caller adds separately; this is valves + sized fittings. */
export function blakeAncillariesForTakeoff(input: BlakeKitInput & { projectId: string }): BlakeTakeoffAllowance[] {
  const fittings = input.fittings || (input.layout ? summariseHeatingFittings(input.layout) : null);
  const kit = buildBlakeAncillariesKit({ ...input, fittings: fittings || undefined });
  const fromKit = blakeKitMaterialAllowances(kit, input.projectId);
  const fromFits = fittings ? fittingsMaterialAllowances(fittings, input.projectId) : [];
  return [...fromFits, ...fromKit];
}

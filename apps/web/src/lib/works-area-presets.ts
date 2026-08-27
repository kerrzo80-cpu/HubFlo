/**
 * Layman presets for Quote/Job Cost Centre List.
 * Behind the scenes these still map to section.name / costCentre.name strings.
 */

export const WORKS_AREA_PRESETS = ["Interior Works", "Exterior Work"] as const;

export const INTERIOR_ROOM_PRESETS = [
  "Lounge",
  "Kitchen",
  "Dining room",
  "Bathroom",
  "En-suite",
  "Cloakroom",
  "Bedroom 1",
  "Bedroom 2",
  "Bedroom 3",
  "Bedroom 4",
  "Hallway",
  "Landing",
  "Stairs",
  "Utility",
  "Office",
  "Conservatory",
  "Garage",
  "Plant room",
] as const;

export const EXTERIOR_AREA_PRESETS = [
  "Rainwater goods",
  "Roof",
  "External walls",
  "Drainage",
  "Driveway / paths",
  "Garden / landscaping",
  "External tap / supply",
  "Boundary / fencing",
  "Outbuilding",
] as const;

export const ROOM_AREA_PRESETS = [...INTERIOR_ROOM_PRESETS, ...EXTERIOR_AREA_PRESETS] as const;

export const WORKS_AREA_CUSTOM = "__custom__";
export const ROOM_AREA_CUSTOM = "__custom__";

export function worksAreaSelectValue(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return WORKS_AREA_PRESETS[0];
  return (WORKS_AREA_PRESETS as readonly string[]).includes(trimmed) ? trimmed : WORKS_AREA_CUSTOM;
}

export function roomAreaSelectValue(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return ROOM_AREA_CUSTOM;
  return (ROOM_AREA_PRESETS as readonly string[]).includes(trimmed) ? trimmed : ROOM_AREA_CUSTOM;
}

/** Prefer exterior room list when the parent works area looks external. */
export function prefersExteriorRooms(worksAreaName: string): boolean {
  return /exter|external|outside|rainwater|roof|drain|garden|drive/i.test(worksAreaName);
}

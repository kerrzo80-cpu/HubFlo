/**
 * Editable takeoff rate library + fixture assembly kits (persist per workspace).
 * Server-only (SQLite). Client code must import from takeoff-rate-core.
 */

import { loadServerStore, writeServerStore } from "@/lib/server-store";
import {
  cloneDefaultTakeoffRateLibrary,
  expandTakeoffAssemblies as expandTakeoffAssembliesCore,
  lookupLibraryRate as lookupLibraryRateCore,
  type MaterialLine,
  type TakeoffAssemblyKit,
  type TakeoffRateEntry,
  type TakeoffRateLibrary,
} from "@/lib/takeoff-rate-core";
import { useDemoSeedData } from "@/lib/workspace-mode";

export * from "@/lib/takeoff-rate-core";

const STORE_NAME = "takeoff-rate-library-v1";

function mergeLibraryRows<T extends { id: string }>(saved: T[] | undefined, defaults: T[]): T[] {
  if (!Array.isArray(saved) || !saved.length) return defaults;
  const savedIds = new Set(saved.map((row) => row.id));
  return [...saved, ...defaults.filter((row) => !savedIds.has(row.id))];
}

export function getTakeoffRateLibrary(): TakeoffRateLibrary {
  const empty: TakeoffRateLibrary = { version: 1, rates: [], assemblies: [], updatedAt: new Date().toISOString() };
  const raw = loadServerStore<Partial<TakeoffRateLibrary>>(
    STORE_NAME,
    useDemoSeedData() ? cloneDefaultTakeoffRateLibrary() : empty,
  );
  if (!useDemoSeedData()) {
    return {
      version: 1,
      rates: Array.isArray(raw.rates) ? raw.rates : [],
      assemblies: Array.isArray(raw.assemblies) ? raw.assemblies : [],
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  }
  const base = cloneDefaultTakeoffRateLibrary();
  return {
    version: 1,
    rates: mergeLibraryRows(raw.rates, base.rates),
    assemblies: mergeLibraryRows(raw.assemblies, base.assemblies),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export function saveTakeoffRateLibrary(input: {
  rates?: TakeoffRateEntry[];
  assemblies?: TakeoffAssemblyKit[];
}): TakeoffRateLibrary {
  const current = getTakeoffRateLibrary();
  const next: TakeoffRateLibrary = {
    version: 1,
    rates: Array.isArray(input.rates) ? input.rates : current.rates,
    assemblies: Array.isArray(input.assemblies) ? input.assemblies : current.assemblies,
    updatedAt: new Date().toISOString(),
  };
  writeServerStore(STORE_NAME, next);
  return next;
}

export function resetTakeoffRateLibrary(): TakeoffRateLibrary {
  const next = useDemoSeedData()
    ? cloneDefaultTakeoffRateLibrary()
    : { version: 1 as const, rates: [], assemblies: [], updatedAt: new Date().toISOString() };
  next.updatedAt = new Date().toISOString();
  writeServerStore(STORE_NAME, next);
  return next;
}

/** Server convenience: lookup against persisted library. */
export function lookupLibraryRate(description: string, unit: string, library = getTakeoffRateLibrary()): number {
  return lookupLibraryRateCore(description, unit, library);
}

export function expandTakeoffAssemblies<T extends MaterialLine>(
  lines: T[],
  library = getTakeoffRateLibrary(),
): T[] {
  return expandTakeoffAssembliesCore(lines, library);
}

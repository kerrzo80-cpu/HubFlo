/**
 * Server-only Price Ledger helpers — learn firm supplier costs into the rate library.
 */

import {
  getTakeoffRateLibrary,
  saveTakeoffRateLibrary,
  type TakeoffRateEntry,
  type TakeoffRateLibrary,
  type TakeoffRateUnit,
} from "@/lib/takeoff-rate-library";

export type FirmLearnRow = {
  description: string;
  unit?: string;
  unitCost: number;
};

function normaliseUnit(unit?: string): TakeoffRateUnit {
  const value = String(unit || "nr").trim().toLowerCase();
  if (value === "m" || value === "m2" || value === "run" || value === "nr") return value;
  if (value === "lm" || value === "metre" || value === "meter" || value === "metres") return "m";
  if (value === "m²" || value === "sqm") return "m2";
  return "nr";
}

function slugId(description: string, unit: TakeoffRateUnit): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `learned-${unit}-${slug || "item"}`;
}

/**
 * Upsert firm unit costs into the takeoff rate library so guides improve over time.
 * Matches existing rates by match/label; otherwise appends a learned entry.
 */
export function learnFirmCostsIntoRateLibrary(rows: FirmLearnRow[]): {
  library: TakeoffRateLibrary;
  learned: number;
  updated: number;
  created: number;
} {
  const usable = rows
    .map((row) => ({
      description: String(row.description || "").trim(),
      unit: normaliseUnit(row.unit),
      unitCost: Math.round(Math.max(0, Number(row.unitCost) || 0) * 100) / 100,
    }))
    .filter((row) => row.description && row.unitCost > 0);

  if (!usable.length) {
    const library = getTakeoffRateLibrary();
    return { library, learned: 0, updated: 0, created: 0 };
  }

  const library = getTakeoffRateLibrary();
  const rates = [...library.rates];
  let updated = 0;
  let created = 0;

  for (const row of usable) {
    const haystack = row.description.toLowerCase();
    const existingIndex = rates.findIndex((rate) => {
      if (rate.unit !== row.unit) return false;
      if (rate.label.toLowerCase() === haystack) return true;
      try {
        return new RegExp(rate.match, "i").test(row.description);
      } catch {
        return haystack.includes(rate.match.toLowerCase());
      }
    });

    if (existingIndex >= 0) {
      const current = rates[existingIndex]!;
      if (current.unitCost !== row.unitCost) {
        rates[existingIndex] = { ...current, unitCost: row.unitCost };
        updated += 1;
      }
      continue;
    }

    const entry: TakeoffRateEntry = {
      id: slugId(row.description, row.unit),
      label: row.description.slice(0, 80),
      match: row.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 80),
      unit: row.unit,
      unitCost: row.unitCost,
      category: "other",
    };
    // Avoid duplicate ids if same description learned twice in one batch.
    const dup = rates.findIndex((rate) => rate.id === entry.id);
    if (dup >= 0) {
      rates[dup] = { ...rates[dup]!, unitCost: row.unitCost };
      updated += 1;
    } else {
      rates.push(entry);
      created += 1;
    }
  }

  const next = saveTakeoffRateLibrary({ rates, assemblies: library.assemblies });
  return {
    library: next,
    learned: updated + created,
    updated,
    created,
  };
}

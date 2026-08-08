/**
 * Apply takeoff rates (editable library → built-in defaults) and assemblies.
 * Client-safe: no SQLite / prebuild store. Pass a library from API state when available.
 */

import {
  defaultTakeoffRateLibrary,
  expandTakeoffAssemblies,
  lookupLibraryRate,
  type MaterialLine,
  type TakeoffRateLibrary,
} from "@/lib/takeoff-rate-core";

export type TakeoffRateLine = MaterialLine;

/** Built-in fallbacks when library has no match. */
const DEFAULT_RATES: Array<{ match: RegExp; unitCost: number; unitHint?: string }> = [
  { match: /\b15\s*mm\b.*copper|15\s*cu\b/i, unitCost: 4.2, unitHint: "m" },
  { match: /\b22\s*mm\b.*copper|22\s*cu\b/i, unitCost: 7.8, unitHint: "m" },
  { match: /\b28\s*mm\b.*copper|28\s*cu\b/i, unitCost: 12.5, unitHint: "m" },
  { match: /\b35\s*mm\b.*copper|35\s*cu\b/i, unitCost: 18.0, unitHint: "m" },
  { match: /\b15\s*mm\b.*hep|15\s*hep\b/i, unitCost: 3.4, unitHint: "m" },
  { match: /\b22\s*mm\b.*hep|22\s*hep\b/i, unitCost: 5.6, unitHint: "m" },
  { match: /\b28\s*mm\b.*hep|28\s*hep\b/i, unitCost: 8.4, unitHint: "m" },
  { match: /\b32\s*mm\b.*waste|32\s*waste\b/i, unitCost: 2.8, unitHint: "m" },
  { match: /\b40\s*mm\b.*waste|40\s*waste\b/i, unitCost: 3.6, unitHint: "m" },
  { match: /\b50\s*mm\b.*waste|50\s*waste\b/i, unitCost: 5.2, unitHint: "m" },
  { match: /\b110\b.*soil|110\s*soil\b/i, unitCost: 9.5, unitHint: "m" },
  { match: /90°?\s*elbow|elbow/i, unitCost: 1.85, unitHint: "nr" },
  { match: /coupling/i, unitCost: 1.35, unitHint: "nr" },
  { match: /\bP-WC\b|\bWC\b/i, unitCost: 185, unitHint: "nr" },
  { match: /\bP-WHB\b|wash hand basin|\bbasin\b/i, unitCost: 95, unitHint: "nr" },
  { match: /\bP-BATH\b|\bbath\b/i, unitCost: 220, unitHint: "nr" },
  { match: /\bP-SHR\b|\bshower\b/i, unitCost: 160, unitHint: "nr" },
  { match: /\bP-RAD\b|\bradiator\b/i, unitCost: 95, unitHint: "nr" },
  { match: /\bP-SINK\b|\bsink\b/i, unitCost: 110, unitHint: "nr" },
  { match: /hot pipe|cold pipe|heating pipe|waste \/ soil|pipe runs/i, unitCost: 7.8, unitHint: "m" },
];

function lookupDefaultRate(description: string, unit: string): number {
  const hay = description.trim();
  for (const row of DEFAULT_RATES) {
    if (!row.match.test(hay)) continue;
    if (row.unitHint && row.unitHint !== unit && unit !== "run") continue;
    return row.unitCost;
  }
  return 0;
}

/** Fill unitCost on takeoff material lines before Push to Core. */
export function applyTakeoffRatesToMaterials<T extends TakeoffRateLine>(
  lines: T[],
  library?: TakeoffRateLibrary | null,
): T[] {
  const lib = library || defaultTakeoffRateLibrary();
  return lines.map((line) => {
    if (line.unitCost > 0) return line;
    const fromLibrary = lookupLibraryRate(line.description, line.unit, lib);
    if (fromLibrary > 0) return { ...line, unitCost: fromLibrary };
    const fromDefault = lookupDefaultRate(line.description, line.unit);
    if (fromDefault > 0) return { ...line, unitCost: fromDefault };
    return line;
  });
}

/** Price lines, then expand enabled assembly kits (WC / WHB / rad ancillaries). */
export function priceAndExpandTakeoffMaterials<T extends TakeoffRateLine>(
  lines: T[],
  library?: TakeoffRateLibrary | null,
): T[] {
  const lib = library || defaultTakeoffRateLibrary();
  const priced = applyTakeoffRatesToMaterials(lines, lib);
  const expanded = expandTakeoffAssemblies(priced, lib);
  return applyTakeoffRatesToMaterials(expanded, lib);
}

export function summarisePricedMaterials(lines: Array<{ quantity: number; unitCost: number }>) {
  const total = lines.reduce((sum, line) => sum + (line.quantity || 0) * (line.unitCost || 0), 0);
  const priced = lines.filter((line) => line.unitCost > 0).length;
  return {
    pricedLines: priced,
    materialCost: Number(total.toFixed(2)),
  };
}

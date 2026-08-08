/**
 * Apply NeXa rate-library guide prices onto kit / material lines that are £0 or missing.
 * Marks RFQ when still unpriced — no fake merchant close.
 */

import { lookupLibraryRate } from "@/lib/takeoff-rate-library";
import type { KitLine } from "@/lib/heat-design/types";

export type GuidePricedLine = {
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  pricing: "library" | "kept" | "rfq";
};

/** Price kit lines from the takeoff rate library; keep existing positive costs. */
export function applyGuidePricesToKit(lines: KitLine[]): KitLine[] {
  return lines.map((line) => {
    if (line.unitCost > 0) return line;
    const unit = line.unit || "nr";
    const fromLib = lookupLibraryRate(line.description, unit);
    if (fromLib > 0) {
      return { ...line, unitCost: fromLib };
    }
    // Soft keyword guides for common ancillaries not in library patterns
    const soft = softGuide(line.description, unit);
    if (soft > 0) return { ...line, unitCost: soft };
    return line;
  });
}

function softGuide(description: string, unit: string): number {
  const hay = description.toLowerCase();
  if (unit === "m") {
    if (hay.includes("insulation") || hay.includes("lagging")) return 1.85;
    if (hay.includes("15")) return 4.2;
    if (hay.includes("22")) return 7.8;
    if (hay.includes("28")) return 12.5;
  }
  if (/\btrv\b/.test(hay)) return 18;
  if (hay.includes("lockshield")) return 9;
  if (hay.includes("isolation valve")) return 9;
  if (hay.includes("automatic air vent") || /\baav\b/.test(hay)) return 9.5;
  if (hay.includes("drain cock") || hay.includes("drain-off")) return 6.5;
  if (hay.includes("pipe clip") || hay.includes("saddle")) return 0.45;
  if (hay.includes("zone valve") || hay.includes("2-port")) return 55;
  if (hay.includes("wiring centre")) return 42;
  if (hay.includes("filling loop")) return 28;
  if (hay.includes("bypass")) return 48;
  if (hay.includes("prv") || hay.includes("relief")) return 22;
  if (hay.includes("tundish") || hay.includes("g3")) return 42;
  if (hay.includes("actuator")) return 22;
  return 0;
}

export function summariseGuidePricing(lines: Array<{ unitCost: number }>) {
  const priced = lines.filter((line) => line.unitCost > 0).length;
  const rfq = lines.length - priced;
  const materialCost = lines.reduce((sum, line) => sum + (line.unitCost || 0), 0);
  return {
    pricedLines: priced,
    rfqLines: rfq,
    materialCost: Number(materialCost.toFixed(2)),
    note:
      rfq > 0
        ? `${priced} guide-priced · ${rfq} still Supplier RFQ`
        : `${priced} lines guide-priced from rate library`,
  };
}

/**
 * Server-side guide prices (rate library + soft guides).
 * Do not import from client components — pulls SQLite via takeoff-rate-library.
 * Client path: `@/lib/ai-soft-guide-prices`.
 */

import { applySoftGuidePricesToKit } from "@/lib/ai-soft-guide-prices";
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
  const withLibrary = lines.map((line) => {
    if (line.unitCost > 0) return line;
    const unit = line.unit || "nr";
    const fromLib = lookupLibraryRate(line.description, unit);
    if (fromLib > 0) {
      return {
        ...line,
        unitCost: fromLib,
        pricingSource: "rate-library" as const,
        pricingNote: "NeXa rate library guide — amend when supplier quote lands",
      };
    }
    return line;
  });
  return applySoftGuidePricesToKit(withLibrary);
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

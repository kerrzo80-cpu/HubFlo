/**
 * Server-side guide prices (office catalogue → rate library → soft guides).
 * Do not import from client components — pulls SQLite / hub store.
 * Client path: `@/lib/ai-soft-guide-prices`.
 */

import { applySoftGuidePricesToKit } from "@/lib/ai-soft-guide-prices";
import { lookupCatalogUnitCost } from "@/lib/catalog-price-lookup";
import { lookupLibraryRate } from "@/lib/takeoff-rate-library";
import type { KitLine } from "@/lib/heat-design/types";

export type GuidePricedLine = {
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  pricing: "catalogue" | "library" | "kept" | "rfq";
};

/** Price kit lines: office catalogue (confirmed) → rate library → soft guides. */
export function applyGuidePricesToKit(lines: KitLine[]): KitLine[] {
  const withCatalog = lines.map((line) => {
    if (line.unitCost > 0) return line;
    const hit = lookupCatalogUnitCost(line.description, line.unit || "nr");
    if (hit && hit.unitCost > 0) {
      return {
        ...line,
        unitCost: hit.unitCost,
        pricingSource: "catalogue" as const,
        pricingNote: `Office catalogue · ${hit.catalogName}${hit.sku ? ` (${hit.sku})` : ""} — confirmed cost`,
        pricingState: "firm" as const,
      };
    }
    return line;
  });

  const withLibrary = withCatalog.map((line) => {
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
        : `${priced} lines guide-priced from catalogue / rate library`,
  };
}

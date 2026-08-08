import { derivePricingState, isProvisionalState } from "@/lib/price-ledger";
import type { KitLine } from "./types";

export type QuoteCostLineExport = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell: number;
  supplierRequired?: boolean;
  rateSource?: "ratebook" | "manual";
  pricingState?: "budget" | "guide" | "rfq" | "firm";
  pricingSource?: string;
  pricingNote?: string;
  pricedAt?: string;
};

/** Map heat-design kit lines into Core quote cost-centre materials. */
export function kitLinesToQuoteCostLines(kit: KitLine[], markupPercent = 35): QuoteCostLineExport[] {
  const markup = Math.max(0, markupPercent) / 100;
  return kit
    .filter((line) => line.unitCost > 0 || line.required)
    .map((line) => {
      const unitCost = Math.round(line.unitCost * 100) / 100;
      const unitSell = Math.round(unitCost * (1 + markup) * 100) / 100;
      const qtyLabel = line.unit ? ` (${line.qty} ${line.unit})` : "";
      const pricingState = derivePricingState(line);
      return {
        id: `heat-kit-${line.id}`,
        catalogItemId: "heat-design-kit",
        description: `[${line.category}] ${line.description}${qtyLabel}`,
        quantity: line.unit ? 1 : line.qty,
        unitCost: line.unit ? Math.round(unitCost * line.qty * 100) / 100 : unitCost,
        unitSell: line.unit ? Math.round(unitSell * line.qty * 100) / 100 : unitSell,
        supplierRequired: isProvisionalState(pricingState),
        rateSource: "manual" as const,
        pricingState,
        pricingSource: line.pricingSource,
        pricingNote: line.pricingNote,
        pricedAt: line.pricedAt,
      };
    });
}

export function kitSellTotal(lines: QuoteCostLineExport[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitSell, 0) * 100) / 100;
}

export type JobMaterialLineExport = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
  supplierRequired?: boolean;
  rateSource?: "ratebook" | "manual";
};

/** Map heat-design kit lines into Core job cost-centre materials. */
export function kitLinesToJobMaterials(kit: KitLine[], markupPercent = 35): JobMaterialLineExport[] {
  return kit
    .filter((line) => line.unitCost > 0 || line.required)
    .map((line) => {
      const qtyLabel = line.unit ? ` (${line.qty} ${line.unit})` : "";
      const unitCost = line.unit
        ? Math.round(line.unitCost * line.qty * 100) / 100
        : Math.round(line.unitCost * 100) / 100;
      const pricingState = derivePricingState(line);
      return {
        id: `heat-kit-${line.id}`,
        catalogItemId: "heat-design-kit",
        description: `[${line.category}] ${line.description}${qtyLabel}`,
        quantity: line.unit ? 1 : line.qty,
        unitCost,
        markupPercent,
        supplierRequired: isProvisionalState(pricingState),
        rateSource: "manual" as const,
      };
    });
}

export function jobMaterialsCostTotal(lines: JobMaterialLineExport[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) * 100) / 100;
}

/** Approx cost of previous heat-design materials already on a job centre (for re-link value fix). */
export function previousJobMaterialsCost(materials: Array<{ quantity?: number; unitCost?: number }> | undefined): number {
  if (!materials?.length) return 0;
  return Math.round(
    materials.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0) * 100,
  ) / 100;
}

/** Approx sell of previous heat-design lines already on a quote centre. */
export function previousQuoteLinesSell(
  lines: Array<{ quantity?: number; unitSell?: number; unitCost?: number }> | undefined,
): number {
  if (!lines?.length) return 0;
  return Math.round(
    lines.reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitSell ?? line.unitCost ?? 0),
      0,
    ) * 100,
  ) / 100;
}

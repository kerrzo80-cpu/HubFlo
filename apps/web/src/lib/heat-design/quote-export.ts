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
      return {
        id: `heat-kit-${line.id}`,
        catalogItemId: "heat-design-kit",
        description: `[${line.category}] ${line.description}${qtyLabel}`,
        quantity: line.unit ? 1 : line.qty,
        unitCost: line.unit ? Math.round(unitCost * line.qty * 100) / 100 : unitCost,
        unitSell: line.unit ? Math.round(unitSell * line.qty * 100) / 100 : unitSell,
        supplierRequired: false,
        rateSource: "manual" as const,
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
      return {
        id: `heat-kit-${line.id}`,
        catalogItemId: "heat-design-kit",
        description: `[${line.category}] ${line.description}${qtyLabel}`,
        quantity: line.unit ? 1 : line.qty,
        unitCost,
        markupPercent,
        supplierRequired: false,
        rateSource: "manual" as const,
      };
    });
}

export function jobMaterialsCostTotal(lines: JobMaterialLineExport[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) * 100) / 100;
}

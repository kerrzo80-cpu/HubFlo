import { derivePricingState, isProvisionalState } from "@/lib/price-ledger";
import type { TenderBoqLine } from "@/lib/tenders-types";
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

/** Tender BoQ sheet / section used for Heat Design pushes (re-push replaces this block). */
export const HEAT_DESIGN_BOQ_SHEET = "Heating design";

/** Clear kit description for commercial lines — keep PEX UFH vs copper plant distinct. */
export function kitLineCommercialDescription(line: KitLine): string {
  const category = (line.category || "").trim();
  const description = (line.description || "").trim();
  if (!description) return category || "Heat design material";
  // Kit descriptions already name PEX / copper / plant; avoid dumping as bare "copper".
  if (!category || description.toLowerCase().startsWith(category.toLowerCase())) {
    return description;
  }
  return `${category} — ${description}`;
}

function kitLineBoqRef(category: string): string {
  const key = category.trim().toLowerCase();
  if (key.includes("heat pump") || key === "heat pump") return "HP";
  if (key.includes("boiler")) return "BOIL";
  if (key.includes("cylinder")) return "CYL";
  if (key.includes("hydraul")) return "HYD";
  if (key.includes("pipe")) return "PIPE";
  if (key.includes("emitter") || key.includes("ufh") || key.includes("radiator")) return "EMIT";
  if (key.includes("control")) return "CTRL";
  if (key.includes("valve")) return "VALVE";
  if (key.includes("electric")) return "ELEC";
  if (key.includes("flue") || key.includes("gas") || key.includes("fuel")) return "FUEL";
  if (key.includes("fabric") || key.includes("opening")) return "FAB";
  if (key.includes("outdoor")) return "OU";
  if (key.includes("system")) return "SYS";
  return "HD";
}

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
        description: `${kitLineCommercialDescription(line)}${qtyLabel}`,
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
        description: `${kitLineCommercialDescription(line)}${qtyLabel}`,
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

export function isHeatDesignBoqLine(line: Pick<TenderBoqLine, "id" | "sheet" | "section">): boolean {
  if (line.sheet === HEAT_DESIGN_BOQ_SHEET || line.section === HEAT_DESIGN_BOQ_SHEET) return true;
  return line.id.startsWith("heat-kit-") || line.id.startsWith("heat-design-boq-");
}

/** Map Defined kit into tender BoQ measured lines (PEX UFH vs copper plant kept distinct). */
export function kitLinesToTenderBoqLines(
  kit: KitLine[],
  options?: { markupPercent?: number; systemLabel?: string },
): TenderBoqLine[] {
  const markup = Math.max(0, options?.markupPercent ?? 35) / 100;
  const header: TenderBoqLine = {
    id: "heat-design-boq-header",
    kind: "header",
    description: options?.systemLabel
      ? `${HEAT_DESIGN_BOQ_SHEET} — ${options.systemLabel}`
      : HEAT_DESIGN_BOQ_SHEET,
    sheet: HEAT_DESIGN_BOQ_SHEET,
    section: HEAT_DESIGN_BOQ_SHEET,
  };

  const measured = kit
    .filter((line) => line.unitCost > 0 || line.required)
    .filter((line) => line.qty > 0 || line.unitCost > 0)
    .map((line): TenderBoqLine => {
      const unitCost = Math.round(line.unitCost * 100) / 100;
      const rate = Math.round(unitCost * (1 + markup) * 100) / 100;
      const quantity = Math.round(line.qty * 1000) / 1000;
      const unit = line.unit || "nr";
      const value =
        Number.isFinite(quantity) && Number.isFinite(rate) ? Math.round(quantity * rate * 100) / 100 : null;
      return {
        id: `heat-kit-${line.id}`,
        kind: "measured",
        ref: kitLineBoqRef(line.category),
        description: kitLineCommercialDescription(line),
        quantity,
        unit,
        rate,
        value,
        note: line.pricingNote || undefined,
        pricingSource: "manual",
        sheet: HEAT_DESIGN_BOQ_SHEET,
        section: HEAT_DESIGN_BOQ_SHEET,
      };
    });

  return measured.length ? [header, ...measured] : [];
}

/** Replace any prior Heat Design block and append the new BoQ lines. */
export function mergeHeatDesignBoqLines(
  existing: TenderBoqLine[],
  nextHeatLines: TenderBoqLine[],
): TenderBoqLine[] {
  const kept = existing.filter((line) => !isHeatDesignBoqLine(line));
  return [...kept, ...nextHeatLines];
}

export function previousHeatDesignBoqSell(lines: TenderBoqLine[] | undefined): number {
  if (!lines?.length) return 0;
  return Math.round(
    lines
      .filter((line) => isHeatDesignBoqLine(line) && line.kind === "measured")
      .reduce((sum, line) => {
        const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
        if (hasValue) return sum + line.value!;
        const qty = typeof line.quantity === "number" ? line.quantity : 0;
        const rate = typeof line.rate === "number" ? line.rate : 0;
        return sum + qty * rate;
      }, 0) * 100,
  ) / 100;
}

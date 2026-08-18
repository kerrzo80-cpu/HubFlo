/**
 * Material unit-cost resolution for Blake takeoff lines.
 * Import used to rely on softGuide alone (mostly £0) — sell collapsed to labour only.
 */

import { softGuideUnitCost } from "@/lib/ai-soft-guide-prices";
import type { AiTakeoffLine } from "@/lib/ai-takeoff-assistant-types";
import { budgetPriceKitWithBlake } from "@/lib/blake-budget-prices";
import type { KitLine } from "@/lib/heat-design/types";
import { applyTakeoffRatesToMaterials } from "@/lib/takeoff-studio-rates";
import {
  normalizeBoqDescriptionForLookup,
  normalizeBoqUnitForLookup,
} from "@/lib/tender-boq-blake-prices";

export type MaterialPriceSource = "bill" | "library" | "soft-guide" | "blake-budget" | "none";

export function resolveTakeoffMaterialUnitCost(
  description: string,
  unit: string,
  billRate = 0,
): { unitCost: number; source: MaterialPriceSource } {
  if (Number.isFinite(billRate) && billRate > 0) {
    return { unitCost: Math.round(billRate * 100) / 100, source: "bill" };
  }
  const normalisedUnit = normalizeBoqUnitForLookup(unit);
  const normalisedDescription = normalizeBoqDescriptionForLookup(description);
  const [fromLibrary] = applyTakeoffRatesToMaterials([
    {
      id: "probe",
      section: "general",
      description: normalisedDescription,
      quantity: 1,
      unit: normalisedUnit,
      unitCost: 0,
      markupPercent: 30,
      supplierRequired: true,
    },
  ]);
  if (fromLibrary && fromLibrary.unitCost > 0) {
    return { unitCost: Math.round(fromLibrary.unitCost * 100) / 100, source: "library" };
  }
  const soft = softGuideUnitCost(normalisedDescription, normalisedUnit);
  if (soft > 0) {
    return { unitCost: Math.round(soft * 100) / 100, source: "soft-guide" };
  }
  return { unitCost: 0, source: "none" };
}

/** Fill £0 material unit costs from rate library + soft guides (sync, no OpenAI). */
export function priceAiTakeoffLinesFromGuides(lines: AiTakeoffLine[]): {
  lines: AiTakeoffLine[];
  filled: number;
  stillZero: number;
} {
  const now = new Date().toISOString();
  let filled = 0;
  const next = lines.map((line) => {
    if (line.kind === "header" || line.kind === "note") return line;
    if (line.unitCost > 0) return line;
    const { unitCost, source } = resolveTakeoffMaterialUnitCost(line.description, line.unit, 0);
    if (!(unitCost > 0)) return line;
    filled += 1;
    return {
      ...line,
      unitCost,
      confidence: source === "library" ? ("Medium" as const) : ("Low" as const),
      updatedAt: now,
    };
  });
  const stillZero = next.filter(
    (line) => line.kind !== "header" && line.kind !== "note" && !(line.unitCost > 0),
  ).length;
  return { lines: next, filled, stillZero };
}

function toKitLines(lines: AiTakeoffLine[]): KitLine[] {
  return lines
    .filter((line) => line.kind !== "header" && line.kind !== "note")
    .map((line) => ({
      id: line.id,
      category: line.costCentre || line.phase || "plumbing",
      description: normalizeBoqDescriptionForLookup(line.description, line.ref),
      qty: line.quantity,
      unit: normalizeBoqUnitForLookup(line.unit),
      unitCost: line.unitCost > 0 ? line.unitCost : 0,
      required: true,
    }));
}

/**
 * Library/soft guides first, then live Blake UK trade ballpark for remaining £0 lines.
 * Prefer provisional budgets over blank — estimator asked for materials prices.
 */
export async function priceAiTakeoffLinesWithBlake(
  lines: AiTakeoffLine[],
  options?: { context?: string; forceBlakeRefresh?: boolean },
): Promise<{
  lines: AiTakeoffLine[];
  guideFilled: number;
  blakeFilled: number;
  stillZero: number;
  aiUsed: boolean;
  error?: string;
}> {
  const guided = priceAiTakeoffLinesFromGuides(lines);
  const needsBlake = guided.lines.filter(
    (line) =>
      line.kind !== "header" &&
      line.kind !== "note" &&
      (!(line.unitCost > 0) || Boolean(options?.forceBlakeRefresh)),
  );
  if (!needsBlake.length) {
    return {
      lines: guided.lines,
      guideFilled: guided.filled,
      blakeFilled: 0,
      stillZero: guided.stillZero,
      aiUsed: false,
    };
  }

  const kitSeed = toKitLines(
    options?.forceBlakeRefresh
      ? guided.lines.map((line) =>
          needsBlake.some((row) => row.id === line.id) ? { ...line, unitCost: 0 } : line,
        )
      : guided.lines,
  );

  const priced = await budgetPriceKitWithBlake(kitSeed, {
    preferBlankWhenUnsure: false,
    chunkSize: 35,
    timeoutMs: 60_000,
    context:
      options?.context ||
      "UK plumbing & heating commercial / health-club BoQ — budget merchant material unit costs (ex VAT)",
  });

  const byId = new Map(priced.lines.map((row) => [row.id, row]));
  const now = new Date().toISOString();
  let blakeFilled = 0;
  const next = guided.lines.map((line) => {
    const kit = byId.get(line.id);
    if (!kit || !(kit.unitCost > 0)) return line;
    if (line.unitCost > 0 && !options?.forceBlakeRefresh) return line;
    if (!(line.unitCost > 0) || options?.forceBlakeRefresh) {
      if (!(line.unitCost > 0)) blakeFilled += 1;
      return {
        ...line,
        unitCost: Math.round(kit.unitCost * 100) / 100,
        confidence: "Medium" as const,
        updatedAt: now,
      };
    }
    return line;
  });
  const stillZero = next.filter(
    (line) => line.kind !== "header" && line.kind !== "note" && !(line.unitCost > 0),
  ).length;

  return {
    lines: next,
    guideFilled: guided.filled,
    blakeFilled,
    stillZero,
    aiUsed: priced.aiUsed,
    error: priced.error,
  };
}

export function summariseMaterialPricing(lines: AiTakeoffLine[]) {
  const measured = lines.filter((line) => line.kind !== "header" && line.kind !== "note");
  const withCost = measured.filter((line) => line.unitCost > 0).length;
  const zero = measured.length - withCost;
  const materialCost = measured.reduce(
    (sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.unitCost),
    0,
  );
  return {
    measured: measured.length,
    withCost,
    zero,
    materialCost: Math.round(materialCost * 100) / 100,
  };
}

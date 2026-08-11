/**
 * Blake budget prices for tender BoQ lines.
 * Reuses blake-budget-prices (rate library first, OpenAI gaps) — maps onto issued BoQ rates.
 */

import {
  budgetPriceKitWithBlake,
  type BlakeBudgetProgress,
} from "@/lib/blake-budget-prices";
import type { KitLine } from "@/lib/heat-design/types";
import { stripDescriptionNoiseForLookup } from "@/lib/takeoff-rate-core";
import {
  computeBoqTotal,
  type TenderBoqLine,
  type TenderBoqPricingSource,
} from "@/lib/tenders-types";
import {
  filterSelectedMeasuredLineIds,
  isBoqLinePriced,
} from "@/lib/tender-boq-sections";

const BUDGET_NOTE = "Blake budget guide — not a firm quote; amend when supplier RFQ returns";
const LIBRARY_NOTE = "NeXa rate library guide — amend when supplier quote lands";

export type TenderBoqBlakeResult = {
  lines: TenderBoqLine[];
  aiUsed: boolean;
  connected: boolean;
  model?: string;
  error?: string;
  pricedCount: number;
  stillOpenCount: number;
  libraryFilled: number;
  blakeFilled: number;
  leftBlank: number;
  budgetTotal: number;
  /** Measured lines offered to Blake / library this run (selection or all). */
  targetedCount: number;
  /** Of the targeted set, how many ended priced. */
  targetedPricedCount: number;
};

export type { BlakeBudgetProgress };

export {
  filterSelectedMeasuredLineIds,
  groupBoqLinesBySection,
  isBoqLinePriced,
  resolveBoqLineSection,
  unpricedMeasuredLineIds,
  type BoqSectionGroup,
} from "@/lib/tender-boq-sections";

/** Normalise BoQ unit strings for rate-library / soft-guide lookup. */
export function normalizeBoqUnitForLookup(unit?: string): string {
  const raw = (unit || "nr").trim().toLowerCase().replace(/\./g, "");
  if (!raw) return "nr";
  if (
    ["item", "ite", "sum", "ls", "lump", "lumpsum", "no", "nos", "each", "ea", "nr", "n", "1"].includes(raw)
  ) {
    return "nr";
  }
  if (["lm", "linm", "lin m", "mtr", "metre", "meter", "linmetre", "linmeter", "m"].includes(raw)) {
    return "m";
  }
  if (raw === "m2" || raw === "sqm" || raw === "m²" || raw === "sq m" || raw === "squaremetre") {
    return "m2";
  }
  if (raw === "m3" || raw === "cum" || raw === "m³") return "m3";
  if (raw === "run" || raw === "rnm") return "m";
  return raw;
}

/** Strip bill refs / qty noise from a BoQ description for pricing lookups. */
export function normalizeBoqDescriptionForLookup(description: string, ref?: string): string {
  let text = (description || "").trim();
  if (ref) {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^${escaped}\\s*[—:\\-–]?\\s*`, "i"), "");
  }
  return stripDescriptionNoiseForLookup(text);
}

export function shouldRefreshBoqLine(line: TenderBoqLine, forceRefresh: boolean): boolean {
  if (line.kind !== "measured") return false;
  if (!isBoqLinePriced(line)) return true;
  if (!forceRefresh) return false;
  return line.pricingSource === "blake-budget" || line.pricingSource === "rate-library";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function guessTradeCategory(section: string | undefined, description: string): string {
  const hay = `${section || ""} ${description}`.toLowerCase();
  if (/\belectr|lighting|socket|switch|cable|consumer unit|containment|t&e\b/.test(hay)) {
    return "Electrical";
  }
  if (/\bheat|radiat|boiler|ashp|cylinder|underfloor|lthw|chw\b/.test(hay)) {
    return "Heating";
  }
  if (/\bdrain|soil|waste|foul|ug\b|sewer|gully\b/.test(hay)) return "Drainage";
  if (/\bventil|extract|mvhr|duct\b|grilles?\b/.test(hay)) return "Ventilation";
  if (/\bsanitary|toilet|basin|doc\s*m|wc\b|urinal\b/.test(hay)) return "Sanitary";
  if (/\bbuilders?\s*work|chase|making\s*good|sleeves?\b/.test(hay)) return "Builders work";
  if (section?.trim()) return section.trim();
  return "MEP BoQ";
}

/** Map a measured BoQ line into a KitLine for Blake / rate-library pricing. */
export function tenderBoqLineToKitLine(line: TenderBoqLine, forceRefresh: boolean): KitLine | null {
  if (line.kind !== "measured") return null;
  const refresh = shouldRefreshBoqLine(line, forceRefresh);
  const existingRate =
    typeof line.rate === "number" && Number.isFinite(line.rate) && line.rate > 0
      ? line.rate
      : typeof line.value === "number"
        && Number.isFinite(line.value)
        && typeof line.quantity === "number"
        && line.quantity > 0
        ? roundMoney(line.value / line.quantity)
        : 0;

  const locked = isBoqLinePriced(line) && !refresh;
  const unitCost = locked ? existingRate : refresh ? 0 : existingRate;
  const pricingSource: KitLine["pricingSource"] = locked
    ? line.pricingSource === "blake-budget" || line.pricingSource === "rate-library"
      ? line.pricingSource
      : "manual"
    : undefined;

  const cleanDescription =
    normalizeBoqDescriptionForLookup(line.description, line.ref)
    || line.description.trim()
    || "BoQ item";

  return {
    id: line.id,
    category: guessTradeCategory(line.section, cleanDescription),
    // Prefer clean item text for library / Blake matching (ref stays on the BoQ line).
    description: cleanDescription,
    qty: typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : 1,
    unit: normalizeBoqUnitForLookup(line.unit),
    unitCost,
    required: true,
    pricingSource,
    pricingNote: locked ? line.note : undefined,
  };
}

/**
 * Merge Blake / library kit results back onto issued BoQ lines.
 * Keeps refs/structure; only fills rate/value (and budget source tags).
 * Never writes £0 — blanks stay unpriced.
 */
export function mergeKitPricesOntoBoqLines(
  original: TenderBoqLine[],
  pricedKits: KitLine[],
  options: { forceRefresh?: boolean; onlyLineIds?: string[] } = {},
): TenderBoqLine[] {
  const byId = new Map(pricedKits.map((line) => [line.id, line]));
  const forceRefresh = Boolean(options.forceRefresh);
  const only = options.onlyLineIds?.length ? new Set(options.onlyLineIds) : null;

  return original.map((line) => {
    if (line.kind !== "measured") return line;
    if (only && !only.has(line.id)) return line;
    if (!shouldRefreshBoqLine(line, forceRefresh) && isBoqLinePriced(line)) {
      return line;
    }

    const kit = byId.get(line.id);
    if (!kit || !(kit.unitCost > 0)) {
      // Prefer blank over fake £0 when Blake/library left it open.
      if (!isBoqLinePriced(line)) {
        return {
          ...line,
          rate: null,
          value: null,
        };
      }
      return line;
    }

    const rate = roundMoney(kit.unitCost);
    const qty = typeof line.quantity === "number" && Number.isFinite(line.quantity) ? line.quantity : null;
    const value = qty !== null ? roundMoney(rate * qty) : rate;
    const source: TenderBoqPricingSource =
      kit.pricingSource === "blake-budget"
        ? "blake-budget"
        : kit.pricingSource === "rate-library" || kit.pricingSource === "rule" || kit.pricingSource === "catalogue"
          ? "rate-library"
          : "blake-budget";
    const note =
      line.note?.trim()
      || (source === "blake-budget" ? BUDGET_NOTE : LIBRARY_NOTE);

    return {
      ...line,
      rate,
      value,
      pricingSource: source,
      note,
    };
  });
}

export function summariseTenderBoqBlake(lines: TenderBoqLine[], focusIds?: string[]) {
  const measured = lines.filter((line) => line.kind === "measured");
  const focus = focusIds?.length ? new Set(focusIds) : null;
  const scoped = focus ? measured.filter((line) => focus.has(line.id)) : measured;
  const priced = measured.filter((line) => isBoqLinePriced(line));
  const scopedPriced = scoped.filter((line) => isBoqLinePriced(line));
  const libraryFilled = priced.filter((line) => line.pricingSource === "rate-library").length;
  const blakeFilled = priced.filter((line) => line.pricingSource === "blake-budget").length;
  return {
    pricedCount: priced.length,
    stillOpenCount: measured.length - priced.length,
    libraryFilled,
    blakeFilled,
    leftBlank: measured.length - priced.length,
    budgetTotal: computeBoqTotal(lines),
    targetedCount: scoped.length,
    targetedPricedCount: scopedPriced.length,
  };
}

/**
 * Rate library / soft guides first, then Blake OpenAI for remaining gaps.
 * Chunked + timed so Core does not hang on large bills.
 * Pass `lineIds` to price only a selected measured subset.
 */
export async function budgetPriceTenderBoqWithBlake(
  lines: TenderBoqLine[],
  options: {
    forceRefresh?: boolean;
    lineIds?: string[];
    context?: string;
    onProgress?: (progress: BlakeBudgetProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TenderBoqBlakeResult> {
  const forceRefresh = Boolean(options.forceRefresh);
  const targetedIds = options.lineIds?.length
    ? filterSelectedMeasuredLineIds(lines, options.lineIds)
    : lines.filter((line) => line.kind === "measured").map((line) => line.id);
  const targetSet = new Set(targetedIds);

  const kitLines = lines
    .filter((line) => targetSet.has(line.id))
    .map((line) => tenderBoqLineToKitLine(line, forceRefresh))
    .filter((line): line is KitLine => Boolean(line));

  if (!kitLines.length) {
    const summary = summariseTenderBoqBlake(lines, targetedIds);
    return {
      lines,
      aiUsed: false,
      connected: false,
      pricedCount: summary.pricedCount,
      stillOpenCount: summary.stillOpenCount,
      libraryFilled: summary.libraryFilled,
      blakeFilled: summary.blakeFilled,
      leftBlank: summary.leftBlank,
      budgetTotal: summary.budgetTotal,
      targetedCount: summary.targetedCount,
      targetedPricedCount: summary.targetedPricedCount,
      error: options.lineIds?.length
        ? "No selected measured BoQ lines to price."
        : "No measured BoQ lines to price.",
    };
  }

  options.onProgress?.({
    stage: "library",
    message: `Matching library · ${kitLines.length} selected…`,
    pricedSoFar: 0,
    openSoFar: kitLines.length,
  });

  const sectionHints = Array.from(
    new Set(
      lines
        .filter((line) => targetSet.has(line.id) && line.section?.trim())
        .map((line) => line.section!.trim()),
    ),
  ).slice(0, 8);
  const contextParts = [options.context, sectionHints.length ? `BoQ sections: ${sectionHints.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");

  const priced = await budgetPriceKitWithBlake(kitLines, {
    forceRefreshBudget: forceRefresh,
    context: contextParts || undefined,
    preferBlankWhenUnsure: true,
    chunkSize: 30,
    timeoutMs: 40_000,
    onProgress: options.onProgress,
    signal: options.signal,
  });

  const nextLines = mergeKitPricesOntoBoqLines(lines, priced.lines, {
    forceRefresh,
    onlyLineIds: targetedIds,
  });
  const summary = summariseTenderBoqBlake(nextLines, targetedIds);

  options.onProgress?.({
    stage: "done",
    message: summary.targetedCount
      ? `Done · ${summary.targetedPricedCount}/${summary.targetedCount} selected priced · ${summary.leftBlank} blank on bill`
      : summary.leftBlank
        ? `Done · ${summary.pricedCount} priced · ${summary.leftBlank} blank`
        : `Done · ${summary.pricedCount} priced`,
    pricedSoFar: summary.targetedPricedCount,
    openSoFar: Math.max(0, summary.targetedCount - summary.targetedPricedCount),
  });

  return {
    lines: nextLines,
    aiUsed: priced.aiUsed,
    connected: priced.connected,
    model: priced.model,
    error: priced.error,
    ...summary,
  };
}

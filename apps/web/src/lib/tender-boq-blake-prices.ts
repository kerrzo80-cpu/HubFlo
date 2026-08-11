/**
 * Blake budget prices for tender BoQ lines.
 * Reuses blake-budget-prices (rate library first, OpenAI gaps) — maps onto issued BoQ rates.
 */

import { budgetPriceKitWithBlake } from "@/lib/blake-budget-prices";
import type { KitLine } from "@/lib/heat-design/types";
import {
  computeBoqTotal,
  type TenderBoqLine,
  type TenderBoqPricingSource,
} from "@/lib/tenders-types";

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
};

export function normalizeBoqUnitForLookup(unit?: string): string {
  const raw = (unit || "nr").trim().toLowerCase();
  if (!raw) return "nr";
  if (["item", "ite", "sum", "ls", "lump", "no", "nos", "each", "ea", "nr"].includes(raw)) {
    return "nr";
  }
  if (["lm", "lin.m", "lin m", "linm", "mtr", "metre", "meter"].includes(raw)) return "m";
  if (raw === "m2" || raw === "sqm" || raw === "m²") return "m2";
  return raw;
}

export function isBoqLinePriced(line: TenderBoqLine): boolean {
  const hasRate = typeof line.rate === "number" && Number.isFinite(line.rate);
  const hasValue = typeof line.value === "number" && Number.isFinite(line.value);
  return hasRate || hasValue;
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

  return {
    id: line.id,
    category: "BoQ",
    description: [line.ref, line.description].filter(Boolean).join(" — ").trim() || line.description,
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
  options: { forceRefresh?: boolean } = {},
): TenderBoqLine[] {
  const byId = new Map(pricedKits.map((line) => [line.id, line]));
  const forceRefresh = Boolean(options.forceRefresh);

  return original.map((line) => {
    if (line.kind !== "measured") return line;
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

export function summariseTenderBoqBlake(lines: TenderBoqLine[]) {
  const measured = lines.filter((line) => line.kind === "measured");
  const priced = measured.filter((line) => isBoqLinePriced(line));
  const libraryFilled = priced.filter((line) => line.pricingSource === "rate-library").length;
  const blakeFilled = priced.filter((line) => line.pricingSource === "blake-budget").length;
  return {
    pricedCount: priced.length,
    stillOpenCount: measured.length - priced.length,
    libraryFilled,
    blakeFilled,
    leftBlank: measured.length - priced.length,
    budgetTotal: computeBoqTotal(lines),
  };
}

/**
 * Rate library / soft guides first, then Blake OpenAI for remaining gaps.
 * Chunked + timed so Core does not hang on large bills.
 */
export async function budgetPriceTenderBoqWithBlake(
  lines: TenderBoqLine[],
  options: { forceRefresh?: boolean; context?: string } = {},
): Promise<TenderBoqBlakeResult> {
  const forceRefresh = Boolean(options.forceRefresh);
  const kitLines = lines
    .map((line) => tenderBoqLineToKitLine(line, forceRefresh))
    .filter((line): line is KitLine => Boolean(line));

  if (!kitLines.length) {
    return {
      lines,
      aiUsed: false,
      connected: false,
      pricedCount: 0,
      stillOpenCount: 0,
      libraryFilled: 0,
      blakeFilled: 0,
      leftBlank: 0,
      budgetTotal: computeBoqTotal(lines),
      error: "No measured BoQ lines to price.",
    };
  }

  const priced = await budgetPriceKitWithBlake(kitLines, {
    forceRefreshBudget: forceRefresh,
    context: options.context,
    preferBlankWhenUnsure: true,
    chunkSize: 30,
    timeoutMs: 40_000,
  });

  const nextLines = mergeKitPricesOntoBoqLines(lines, priced.lines, { forceRefresh });
  const summary = summariseTenderBoqBlake(nextLines);

  return {
    lines: nextLines,
    aiUsed: priced.aiUsed,
    connected: priced.connected,
    model: priced.model,
    error: priced.error,
    ...summary,
  };
}

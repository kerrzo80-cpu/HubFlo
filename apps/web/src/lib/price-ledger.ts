/**
 * Shared commercial Price Ledger — honest prices with provenance.
 *
 * States:
 * - budget: Blake / AI ballpark (planning only)
 * - guide: rate library / rule / catalogue average
 * - rfq: waiting on supplier (often £0 provisional)
 * - firm: supplier quote / manual confirmed cost
 *
 * Sell always comes from markup profiles — never treat budget as a guarantee.
 */

export type PricingState = "budget" | "guide" | "rfq" | "firm";

export type PriceLedgerFields = {
  unitCost?: number | null;
  pricingState?: PricingState | null;
  pricingSource?: string | null;
  pricingNote?: string | null;
  pricedAt?: string | null;
  supplierRequired?: boolean | null;
  status?: string | null;
};

export const PRICING_STATE_LABEL: Record<PricingState, string> = {
  budget: "Budget",
  guide: "Guide",
  rfq: "RFQ",
  firm: "Firm",
};

export const PRICING_STATE_HINT: Record<PricingState, string> = {
  budget: "Blake UK trade ballpark — amend when the supplier quote lands",
  guide: "Rate-library / guide figure — amend when the supplier quote lands",
  rfq: "Supplier price required — provisional until quoted",
  firm: "Confirmed supplier / manual cost",
};

export function hasPositiveCost(unitCost?: number | null): boolean {
  return typeof unitCost === "number" && Number.isFinite(unitCost) && unitCost > 0;
}

/** Derive ledger state from existing cost/source/status signals. */
export function derivePricingState(input: PriceLedgerFields): PricingState {
  if (input.pricingState === "budget" || input.pricingState === "guide" || input.pricingState === "rfq" || input.pricingState === "firm") {
    return input.pricingState;
  }

  const source = String(input.pricingSource || "").toLowerCase();
  if (source === "blake-budget") return "budget";
  if (source === "supplier" || source === "manual") {
    return hasPositiveCost(input.unitCost) ? "firm" : "rfq";
  }
  if (source === "rate-library" || source === "rule" || source === "catalogue") {
    return hasPositiveCost(input.unitCost) ? "guide" : "rfq";
  }

  const status = String(input.status || "").toLowerCase();
  if (status === "supplier rfq" || status === "tbc") return "rfq";
  if (input.supplierRequired && !hasPositiveCost(input.unitCost)) return "rfq";
  if (!hasPositiveCost(input.unitCost)) return "rfq";
  if (status === "confirmed") return "firm";
  return "guide";
}

export function pricingStateFromSource(source?: string | null, unitCost?: number | null): PricingState {
  return derivePricingState({ pricingSource: source, unitCost });
}

export function stampLedgerFields<T extends Record<string, unknown>>(
  line: T,
  patch: {
    unitCost?: number;
    pricingState: PricingState;
    pricingSource?: string;
    pricingNote?: string;
    pricedAt?: string;
    supplierRequired?: boolean;
  },
): T {
  const unitCost = patch.unitCost ?? (typeof line.unitCost === "number" ? line.unitCost : 0);
  const state = patch.pricingState;
  return {
    ...line,
    unitCost,
    pricingState: state,
    pricingSource: patch.pricingSource ?? line.pricingSource ?? state,
    pricingNote: patch.pricingNote ?? line.pricingNote,
    pricedAt: patch.pricedAt ?? new Date().toISOString(),
    supplierRequired:
      patch.supplierRequired ?? (state === "firm" ? false : state === "rfq" ? true : Boolean(line.supplierRequired)),
  };
}

/** Apply a returned supplier / confirmed cost as Firm. */
export function applyFirmSupplierCost<T extends Record<string, unknown>>(
  line: T,
  unitCost: number,
  opts: { note?: string; at?: string; source?: string } = {},
): T {
  const cost = Math.round(Math.max(0, unitCost) * 100) / 100;
  return stampLedgerFields(line, {
    unitCost: cost,
    pricingState: "firm",
    pricingSource: opts.source || "supplier",
    pricingNote: opts.note || "Firm supplier quote — learned into rate library when applied",
    pricedAt: opts.at || new Date().toISOString(),
    supplierRequired: false,
  });
}

/** Tag Blake budget lines. */
export function stampBudgetPrice<T extends Record<string, unknown>>(
  line: T,
  unitCost: number,
  note?: string,
): T {
  return stampLedgerFields(line, {
    unitCost: Math.round(Math.max(0, unitCost) * 100) / 100,
    pricingState: "budget",
    pricingSource: "blake-budget",
    pricingNote: note || PRICING_STATE_HINT.budget,
    supplierRequired: true,
  });
}

/** Tag rate-library / rule guide lines. */
export function stampGuidePrice<T extends Record<string, unknown>>(
  line: T,
  unitCost: number,
  source: "rate-library" | "rule" | "catalogue" = "rate-library",
  note?: string,
): T {
  return stampLedgerFields(line, {
    unitCost: Math.round(Math.max(0, unitCost) * 100) / 100,
    pricingState: "guide",
    pricingSource: source,
    pricingNote: note || PRICING_STATE_HINT.guide,
    supplierRequired: true,
  });
}

/** Mark as RFQ / provisional (often £0). */
export function stampRfqPrice<T extends Record<string, unknown>>(
  line: T,
  note?: string,
): T {
  return stampLedgerFields(line, {
    unitCost: typeof line.unitCost === "number" ? line.unitCost : 0,
    pricingState: "rfq",
    pricingSource: "supplier",
    pricingNote: note || PRICING_STATE_HINT.rfq,
    supplierRequired: true,
  });
}

export function isProvisionalState(state: PricingState): boolean {
  return state === "budget" || state === "guide" || state === "rfq";
}

export function chipClassForPricingState(state: PricingState): string {
  return `price-ledger-chip is-${state}`;
}

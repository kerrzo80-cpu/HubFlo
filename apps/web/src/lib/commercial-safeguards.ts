/**
 * Commercial / operational safeguards raised by live product audit.
 * Prefer rejecting unsafe actions at the API boundary (UI can warn, API must block).
 */

export type PricedMaterialLine = {
  description?: string;
  quantity?: number;
  unitCost?: number | null;
  supplierRequired?: boolean;
  status?: string;
};

/** Lines that must be priced before commercial push (not provisional RFQ). */
export function unpricedCommercialLines(lines: PricedMaterialLine[]): PricedMaterialLine[] {
  return lines.filter((line) => {
    if ((line.quantity ?? 0) <= 0) return false;
    if (line.supplierRequired) return false;
    if (String(line.status || "").toLowerCase().includes("rfq")) return false;
    if (String(line.status || "").toLowerCase() === "supplier rfq") return false;
    const cost = line.unitCost;
    return cost === undefined || cost === null || !Number.isFinite(cost) || cost <= 0;
  });
}

export function assertMaterialsPricedForPush(lines: PricedMaterialLine[]): string | null {
  const bad = unpricedCommercialLines(lines);
  if (!bad.length) return null;
  const sample = bad
    .slice(0, 3)
    .map((line) => line.description || "Untitled line")
    .join("; ");
  return `Cannot push while ${bad.length} material line(s) have no cost (not marked Supplier RFQ). Example: ${sample}`;
}

export function assertVariationSellValue(sellValue: number): string | null {
  if (!Number.isFinite(sellValue) || sellValue <= 0) {
    return "Cannot send a £0 variation for client approval. Enter a sell value first.";
  }
  return null;
}

export type HeatExportCheckInput = {
  coveragePercent?: number | null;
  designLoadKw?: number | null;
  capacityAtFlowKw?: number | null;
  emitterShortfallCount?: number | null;
  force?: boolean;
};

export function assertHeatDesignExportable(input: HeatExportCheckInput): string | null {
  if (input.force) return null;
  const coverage = Number(input.coveragePercent);
  if (Number.isFinite(coverage) && coverage < 95) {
    return `Heat pump covers only ${coverage.toFixed(0)}% of design load. Fix sizing or override with force + audit before print/push.`;
  }
  const design = Number(input.designLoadKw);
  const capacity = Number(input.capacityAtFlowKw);
  if (Number.isFinite(design) && design > 0 && Number.isFinite(capacity) && capacity < design * 0.95) {
    return `Selected heat pump (${capacity.toFixed(1)} kW) is undersized for design load (${design.toFixed(1)} kW).`;
  }
  const shortfalls = Number(input.emitterShortfallCount);
  if (Number.isFinite(shortfalls) && shortfalls > 0) {
    return `${shortfalls} room emitter(s) are below 95% of room heat loss. Upgrade emitters before export.`;
  }
  return null;
}

/** Quote portal may only accept/decline quotes that were actually sent to the client. */
export function assertQuotePortalResponseAllowed(status: string): string | null {
  const normalised = String(status || "").trim();
  if (normalised === "Accepted" || normalised === "Declined" || normalised === "Converted") {
    return `This quote is already ${normalised.toLowerCase()}.`;
  }
  if (normalised !== "Sent") {
    return "Only quotes with status Sent can be accepted or declined online.";
  }
  return null;
}

/** True when bank details are still placeholder / empty and must not print on invoices. */
export function isPlaceholderBankDetails(input: {
  bankName?: string;
  accountName?: string;
  sortCode?: string;
  accountNumber?: string;
}): boolean {
  const sort = String(input.sortCode || "").replace(/\s+/g, "");
  const account = String(input.accountNumber || "").replace(/\s+/g, "");
  const bank = String(input.bankName || "").trim().toLowerCase();
  const name = String(input.accountName || "").trim().toLowerCase();
  if (!sort && !account && !bank && !name) return true;
  if (sort === "00-00-00" || sort === "000000") return true;
  if (account === "00000000" || account === "0") return true;
  if (bank === "business bank" || bank === "company") return true;
  if (name === "company") return true;
  return false;
}

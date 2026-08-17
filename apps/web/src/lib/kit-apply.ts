/**
 * Explode a named kit onto a quote/job cost centre as separate catalogue (or one-off) lines.
 * The kit name (e.g. "Bath") is never posted as a single sell line.
 */

export type KitApplyLineKind = "Material" | "Labour";

export type KitApplyLine = {
  id?: string;
  kind: KitApplyLineKind;
  description: string;
  quantity: number;
  unitCost?: number;
  unitSell?: number;
  unit?: string;
};

export type KitApplyKit = {
  id: string;
  name: string;
  lines?: KitApplyLine[] | null;
};

export type KitApplyCatalogItem = {
  id: string;
  type: "Labour" | "Material" | "Plant" | "Subcontractor";
  name: string;
  costRate: number;
  sellRate: number;
  sku?: string;
};

export type ExplodedJobMaterial = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  markupPercent: number;
  rateSource: "ratebook" | "manual";
};

export type ExplodedJobLabour = {
  id: string;
  catalogItemId?: string;
  role: string;
  hours: number;
  costRate: number;
  markupPercent: number;
  rateSource: "ratebook" | "manual";
};

export type ExplodedQuoteLine = {
  id: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitSell: number;
  rateSource: "ratebook" | "manual";
};

export type KitExplodeOptions = {
  materialMarkupPercent?: number;
  labourMarkupPercent?: number;
  now?: number;
};

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function finiteOr(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function kitLinesOf(kit: KitApplyKit | null | undefined): KitApplyLine[] {
  return Array.isArray(kit?.lines) ? kit.lines : [];
}

export function isSkippableKitLine(line: KitApplyLine) {
  const description = String(line.description || "").trim();
  if (!description) return true;
  const qty = finiteOr(line.quantity, NaN);
  if (!Number.isFinite(qty) || qty <= 0) return true;
  return false;
}

export function matchCatalogItem(
  description: string,
  catalog: KitApplyCatalogItem[],
  type: KitApplyCatalogItem["type"],
): KitApplyCatalogItem | undefined {
  const needle = normalizeName(description);
  if (!needle) return undefined;
  const pool = catalog.filter((item) => item.type === type);
  const exact = pool.find((item) => normalizeName(item.name) === needle);
  if (exact) return exact;
  const sku = pool.find((item) => item.sku && normalizeName(item.sku) === needle);
  if (sku) return sku;
  return undefined;
}

function labourCatalogItem(catalog: KitApplyCatalogItem[]) {
  return (
    catalog.find((item) => item.id === "labour-engineer") ||
    catalog.find((item) => item.type === "Labour") ||
    undefined
  );
}

function markupFromRates(cost: number, sell: number, fallback: number) {
  if (cost > 0 && sell > 0) return roundMoney(((sell / cost) - 1) * 100);
  return fallback;
}

function sellFromMarkup(cost: number, markupPercent: number) {
  return roundMoney(cost * (1 + markupPercent / 100));
}

/**
 * Child materials + labour hours for a job cost centre. Never a parent "Bath" sell line.
 */
export function explodeKitOntoJob(
  kit: KitApplyKit,
  catalog: KitApplyCatalogItem[],
  options?: KitExplodeOptions,
): { materials: ExplodedJobMaterial[]; labour: ExplodedJobLabour[]; skipped: number } {
  const materialMarkup = options?.materialMarkupPercent ?? 30;
  const labourMarkup = options?.labourMarkupPercent ?? 30;
  const now = options?.now ?? Date.now();
  const materials: ExplodedJobMaterial[] = [];
  const labour: ExplodedJobLabour[] = [];
  let skipped = 0;
  const labourItem = labourCatalogItem(catalog);

  kitLinesOf(kit).forEach((line, index) => {
    if (isSkippableKitLine(line)) {
      skipped += 1;
      return;
    }
    if (line.kind === "Labour") {
      const catalogItem = matchCatalogItem(line.description, catalog, "Labour") || labourItem;
      const costRate =
        finiteOr(line.unitCost, 0) > 0 ? finiteOr(line.unitCost, 0) : finiteOr(catalogItem?.costRate, 0);
      const markup =
        line.unitSell && costRate
          ? markupFromRates(costRate, finiteOr(line.unitSell, 0), labourMarkup)
          : catalogItem
            ? markupFromRates(catalogItem.costRate, catalogItem.sellRate, labourMarkup)
            : labourMarkup;
      labour.push({
        id: `labour-kit-${kit.id}-${now}-${index}`,
        catalogItemId: catalogItem?.id,
        role: line.description.trim() || "Labour",
        hours: finiteOr(line.quantity, 0),
        costRate: roundMoney(costRate),
        markupPercent: markup,
        rateSource: catalogItem && !(finiteOr(line.unitCost, 0) > 0) ? "ratebook" : "manual",
      });
      return;
    }

    const catalogItem = matchCatalogItem(line.description, catalog, "Material");
    const unitCost =
      finiteOr(line.unitCost, 0) > 0 ? finiteOr(line.unitCost, 0) : finiteOr(catalogItem?.costRate, 0);
    const markup =
      line.unitSell && unitCost
        ? markupFromRates(unitCost, finiteOr(line.unitSell, 0), materialMarkup)
        : catalogItem
          ? markupFromRates(catalogItem.costRate, catalogItem.sellRate, materialMarkup)
          : materialMarkup;
    materials.push({
      id: `material-kit-${kit.id}-${now}-${index}`,
      catalogItemId: catalogItem?.id || "one-off-material",
      description: line.description.trim(),
      quantity: finiteOr(line.quantity, 0),
      unitCost: roundMoney(unitCost),
      markupPercent: markup,
      rateSource: catalogItem && !(finiteOr(line.unitCost, 0) > 0) ? "ratebook" : "manual",
    });
  });

  return { materials, labour, skipped };
}

/**
 * Quote cost centres use a mixed `lines` array. Labour is posted as hours (qty = hours), not one kit parent.
 */
export function explodeKitOntoQuote(
  kit: KitApplyKit,
  catalog: KitApplyCatalogItem[],
  options?: KitExplodeOptions,
): { lines: ExplodedQuoteLine[]; skipped: number } {
  const exploded = explodeKitOntoJob(kit, catalog, options);
  const lines: ExplodedQuoteLine[] = [];
  const now = options?.now ?? Date.now();

  exploded.materials.forEach((line, index) => {
    lines.push({
      id: `quote-kit-${kit.id}-${now}-m-${index}`,
      catalogItemId: line.catalogItemId,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unitSell: sellFromMarkup(line.unitCost, line.markupPercent),
      rateSource: line.rateSource,
    });
  });
  exploded.labour.forEach((line, index) => {
    lines.push({
      id: `quote-kit-${kit.id}-${now}-l-${index}`,
      catalogItemId: line.catalogItemId || "one-off-labour",
      description: line.role,
      quantity: line.hours,
      unitCost: line.costRate,
      unitSell: sellFromMarkup(line.costRate, line.markupPercent),
      rateSource: line.rateSource,
    });
  });

  return { lines, skipped: exploded.skipped };
}

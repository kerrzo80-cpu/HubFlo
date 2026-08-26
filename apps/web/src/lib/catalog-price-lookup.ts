/**
 * Office materials catalogue lookup for Blake / takeoff / BoQ pricing.
 * Catalogue hits are confirmed office rates (costRate) — preferred over library/soft/Blake budget.
 */

import { getHubDetailState } from "@/lib/hub-detail-store";
import { normalizeDescriptionForRateLookup } from "@/lib/takeoff-rate-core";
import { normalizeBoqUnitForLookup } from "@/lib/tender-boq-blake-prices";

export type CatalogPriceItem = {
  id: string;
  type: "Labour" | "Material" | "Plant" | "Subcontractor" | string;
  name: string;
  unit?: string;
  costRate: number;
  sellRate?: number;
  sku?: string;
  supplierName?: string;
  category?: string;
};

export type CatalogPriceHit = {
  unitCost: number;
  sellRate?: number;
  catalogItemId: string;
  catalogName: string;
  sku?: string;
  supplierName?: string;
  match: "exact" | "sku" | "contains" | "tokens";
};

function asCatalogItem(raw: unknown): CatalogPriceItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const costRate = Number(row.costRate);
  if (!name || !Number.isFinite(costRate) || costRate <= 0) return null;
  const type = typeof row.type === "string" ? row.type : "Material";
  return {
    id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `cat-${name}`,
    type,
    name,
    unit: typeof row.unit === "string" ? row.unit : undefined,
    costRate: Math.round(costRate * 100) / 100,
    sellRate: Number.isFinite(Number(row.sellRate)) ? Math.round(Number(row.sellRate) * 100) / 100 : undefined,
    sku: typeof row.sku === "string" && row.sku.trim() ? row.sku.trim() : undefined,
    supplierName: typeof row.supplierName === "string" ? row.supplierName : undefined,
    category: typeof row.category === "string" ? row.category : undefined,
  };
}

/** Load Material (+ Plant) rows from hub customQuoteCatalog. Safe if hub empty. */
export function listMaterialCatalogItems(catalog?: unknown[]): CatalogPriceItem[] {
  const source =
    Array.isArray(catalog) && catalog.length
      ? catalog
      : (() => {
          try {
            return getHubDetailState().customQuoteCatalog || [];
          } catch {
            return [];
          }
        })();
  const out: CatalogPriceItem[] = [];
  for (const raw of source) {
    const item = asCatalogItem(raw);
    if (!item) continue;
    if (item.type !== "Material" && item.type !== "Plant") continue;
    out.push(item);
  }
  return out;
}

function normalizeCatalogText(value: string) {
  return normalizeDescriptionForRateLookup(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(
    normalizeCatalogText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function unitsCompatible(lineUnit: string | undefined, catalogUnit: string | undefined) {
  if (!lineUnit || !catalogUnit) return true;
  const left = normalizeBoqUnitForLookup(lineUnit);
  const right = normalizeBoqUnitForLookup(catalogUnit);
  if (left === right) return true;
  // Allow nr/item style mismatches when both are count-like.
  if ((left === "nr" || left === "item") && (right === "nr" || right === "item")) return true;
  return false;
}

function scoreTokenOverlap(needle: string, hay: string) {
  const a = tokenSet(needle);
  const b = tokenSet(hay);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const token of a) if (b.has(token)) hit += 1;
  const coverage = hit / a.size;
  const specificity = hit / Math.max(b.size, 1);
  return coverage >= 0.66 ? coverage * 0.7 + specificity * 0.3 : 0;
}

/**
 * Match a BoQ / takeoff description to the office materials catalogue.
 * Prefer exact name/SKU, then contains, then strong token overlap.
 */
export function lookupCatalogUnitCost(
  description: string,
  unit?: string,
  catalog?: CatalogPriceItem[] | unknown[],
): CatalogPriceHit | null {
  const needle = normalizeCatalogText(description);
  if (!needle) return null;
  const poolSource: CatalogPriceItem[] =
    Array.isArray(catalog) && catalog.length > 0 && typeof (catalog[0] as CatalogPriceItem)?.costRate === "number"
      ? (catalog as CatalogPriceItem[]).filter((item) => item.type === "Material" || item.type === "Plant")
      : listMaterialCatalogItems(catalog as unknown[] | undefined);

  const pool = poolSource.filter((item) => unitsCompatible(unit, item.unit));

  if (!pool.length) return null;

  const exact = pool.find((item) => normalizeCatalogText(item.name) === needle);
  if (exact) {
    return {
      unitCost: exact.costRate,
      sellRate: exact.sellRate,
      catalogItemId: exact.id,
      catalogName: exact.name,
      sku: exact.sku,
      supplierName: exact.supplierName,
      match: "exact",
    };
  }

  const skuHit = pool.find((item) => item.sku && normalizeCatalogText(item.sku) === needle);
  if (skuHit) {
    return {
      unitCost: skuHit.costRate,
      sellRate: skuHit.sellRate,
      catalogItemId: skuHit.id,
      catalogName: skuHit.name,
      sku: skuHit.sku,
      supplierName: skuHit.supplierName,
      match: "sku",
    };
  }

  let bestContains: CatalogPriceItem | null = null;
  let bestContainsLen = 0;
  for (const item of pool) {
    const name = normalizeCatalogText(item.name);
    if (!name || name.length < 4) continue;
    if (needle.includes(name) || name.includes(needle)) {
      if (name.length > bestContainsLen) {
        bestContains = item;
        bestContainsLen = name.length;
      }
    }
  }
  if (bestContains && bestContainsLen >= 6) {
    return {
      unitCost: bestContains.costRate,
      sellRate: bestContains.sellRate,
      catalogItemId: bestContains.id,
      catalogName: bestContains.name,
      sku: bestContains.sku,
      supplierName: bestContains.supplierName,
      match: "contains",
    };
  }

  let bestToken: CatalogPriceItem | null = null;
  let bestScore = 0;
  for (const item of pool) {
    const score = scoreTokenOverlap(needle, item.name);
    if (score > bestScore) {
      bestScore = score;
      bestToken = item;
    }
  }
  if (bestToken && bestScore >= 0.72) {
    return {
      unitCost: bestToken.costRate,
      sellRate: bestToken.sellRate,
      catalogItemId: bestToken.id,
      catalogName: bestToken.name,
      sku: bestToken.sku,
      supplierName: bestToken.supplierName,
      match: "tokens",
    };
  }

  return null;
}

import assert from "node:assert/strict";
import test from "node:test";

import { lookupCatalogUnitCost } from "./catalog-price-lookup.ts";
import { resolveTakeoffMaterialUnitCost } from "./ai-takeoff-material-prices.ts";

const catalog = [
  {
    id: "cat-trv",
    type: "Material" as const,
    name: "TRV Angled 15mm",
    unit: "nr",
    costRate: 16.5,
    sellRate: 22,
    sku: "TRV-15",
  },
  {
    id: "cat-basin",
    type: "Material" as const,
    name: "Wash hand basin",
    unit: "nr",
    costRate: 88,
    sellRate: 120,
    sku: "WHB-01",
  },
  {
    id: "cat-labour",
    type: "Labour" as const,
    name: "Engineer",
    unit: "h",
    costRate: 28,
    sellRate: 70,
  },
];

test("lookupCatalogUnitCost exact and sku matches", () => {
  const exact = lookupCatalogUnitCost("Wash hand basin", "nr", catalog);
  assert.ok(exact);
  assert.equal(exact?.unitCost, 88);
  assert.equal(exact?.match, "exact");

  const sku = lookupCatalogUnitCost("TRV-15", "nr", catalog);
  assert.ok(sku);
  assert.equal(sku?.unitCost, 16.5);
  assert.equal(sku?.match, "sku");
});

test("lookupCatalogUnitCost contains match for tender wording", () => {
  const hit = lookupCatalogUnitCost("Supply & fit TRV Angled 15mm to radiator", "nr", catalog);
  assert.ok(hit);
  assert.equal(hit?.unitCost, 16.5);
  assert.ok(hit?.match === "contains" || hit?.match === "tokens");
});

test("lookupCatalogUnitCost ignores labour rows", () => {
  const hit = lookupCatalogUnitCost("Engineer", "h", catalog);
  assert.equal(hit, null);
});

test("resolveTakeoffMaterialUnitCost prefers catalogue over soft guides", () => {
  const priced = resolveTakeoffMaterialUnitCost("Wash hand basin", "nr", 0, catalog);
  assert.equal(priced.source, "catalogue");
  assert.equal(priced.unitCost, 88);

  const softOnly = resolveTakeoffMaterialUnitCost("Mystery gadget with no catalog", "nr", 0, catalog);
  assert.notEqual(softOnly.source, "catalogue");
});

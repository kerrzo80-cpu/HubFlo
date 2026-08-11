import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBoqLinePriced,
  mergeKitPricesOntoBoqLines,
  normalizeBoqUnitForLookup,
  shouldRefreshBoqLine,
  summariseTenderBoqBlake,
  tenderBoqLineToKitLine,
} from "./tender-boq-blake-prices";
import type { KitLine } from "./heat-design/types";
import type { TenderBoqLine } from "./tenders-types";

const sampleLines: TenderBoqLine[] = [
  { id: "h1", kind: "header", description: "SANITARY" },
  {
    id: "l1",
    kind: "measured",
    ref: "8/1/A",
    description: "TRV",
    quantity: 2,
    unit: "nr",
    rate: null,
    value: null,
  },
  {
    id: "l2",
    kind: "measured",
    ref: "8/1/B",
    description: "Obscure flange XYZ-99",
    quantity: 1,
    unit: "ITEM",
    rate: null,
    value: null,
  },
  {
    id: "l3",
    kind: "measured",
    ref: "8/1/C",
    description: "Basin",
    quantity: 1,
    unit: "nr",
    rate: 120,
    value: 120,
    pricingSource: "manual",
  },
];

describe("tender-boq-blake-prices mapping", () => {
  it("normalises BoQ units for rate-library lookup", () => {
    assert.equal(normalizeBoqUnitForLookup("ITEM"), "nr");
    assert.equal(normalizeBoqUnitForLookup("ite"), "nr");
    assert.equal(normalizeBoqUnitForLookup("lm"), "m");
    assert.equal(normalizeBoqUnitForLookup("m"), "m");
  });

  it("only refreshes blanks (or prior budget/guide when forced)", () => {
    assert.equal(shouldRefreshBoqLine(sampleLines[1]!, false), true);
    assert.equal(shouldRefreshBoqLine(sampleLines[3]!, false), false);
    assert.equal(
      shouldRefreshBoqLine(
        { ...sampleLines[3]!, pricingSource: "blake-budget" },
        true,
      ),
      true,
    );
  });

  it("maps measured lines to kit lines without inventing rates", () => {
    const kit = tenderBoqLineToKitLine(sampleLines[1]!, false);
    assert.ok(kit);
    assert.equal(kit!.unitCost, 0);
    assert.equal(kit!.unit, "nr");
    assert.match(kit!.description, /8\/1\/A/);

    const locked = tenderBoqLineToKitLine(sampleLines[3]!, false);
    assert.equal(locked?.unitCost, 120);
    assert.equal(locked?.pricingSource, "manual");
  });

  it("merges positive kit costs onto blanks and leaves unsure lines blank", () => {
    const kits: KitLine[] = [
      {
        id: "l1",
        category: "BoQ",
        description: "TRV",
        qty: 2,
        unitCost: 18,
        required: true,
        unit: "nr",
        pricingSource: "rate-library",
      },
      {
        id: "l2",
        category: "BoQ",
        description: "Obscure flange XYZ-99",
        qty: 1,
        unitCost: 0,
        required: true,
        unit: "nr",
      },
    ];
    const merged = mergeKitPricesOntoBoqLines(sampleLines, kits);
    assert.equal(merged[1]?.rate, 18);
    assert.equal(merged[1]?.value, 36);
    assert.equal(merged[1]?.pricingSource, "rate-library");
    assert.equal(merged[2]?.rate, null);
    assert.equal(merged[2]?.value, null);
    assert.equal(isBoqLinePriced(merged[2]!), false);
    // Manual priced line untouched
    assert.equal(merged[3]?.rate, 120);
    assert.equal(merged[3]?.pricingSource, "manual");

    const summary = summariseTenderBoqBlake(merged);
    assert.equal(summary.libraryFilled, 1);
    assert.equal(summary.leftBlank, 1);
    assert.equal(summary.pricedCount, 2);
  });
});

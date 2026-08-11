import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBoqLinePriced,
  mergeKitPricesOntoBoqLines,
  normalizeBoqDescriptionForLookup,
  normalizeBoqUnitForLookup,
  shouldRefreshBoqLine,
  summariseTenderBoqBlake,
  tenderBoqLineToKitLine,
} from "./tender-boq-blake-prices";
import type { KitLine } from "./heat-design/types";
import type { TenderBoqLine } from "./tenders-types";
import {
  expandTradeSynonymsForLookup,
  lookupLibraryRate,
  stripDescriptionNoiseForLookup,
} from "./takeoff-rate-core";

const sampleLines: TenderBoqLine[] = [
  { id: "h1", kind: "header", description: "SANITARY", section: "SANITARY" },
  {
    id: "l1",
    kind: "measured",
    ref: "8/1/A",
    description: "TRV",
    quantity: 2,
    unit: "nr",
    rate: null,
    value: null,
    section: "SANITARY",
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
    section: "SANITARY",
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
    section: "SANITARY",
  },
  { id: "h2", kind: "header", description: "Heating", section: "Heating" },
  {
    id: "l4",
    kind: "measured",
    ref: "9/1/A",
    description: "Panel radiator 600x1000",
    quantity: 3,
    unit: "nr",
    rate: null,
    value: null,
    section: "Heating",
  },
];

describe("tender-boq-blake-prices mapping", () => {
  it("normalises BoQ units for rate-library lookup", () => {
    assert.equal(normalizeBoqUnitForLookup("ITEM"), "nr");
    assert.equal(normalizeBoqUnitForLookup("ite"), "nr");
    assert.equal(normalizeBoqUnitForLookup("lm"), "m");
    assert.equal(normalizeBoqUnitForLookup("lin.m"), "m");
    assert.equal(normalizeBoqUnitForLookup("mtr"), "m");
    assert.equal(normalizeBoqUnitForLookup("sqm"), "m2");
    assert.equal(normalizeBoqUnitForLookup("m"), "m");
  });

  it("strips bill refs and qty noise from descriptions", () => {
    assert.equal(normalizeBoqDescriptionForLookup("TRV", "8/1/A"), "TRV");
    assert.equal(
      stripDescriptionNoiseForLookup("8/1/A — Thermostatic radiator valve (12nr)"),
      "Thermostatic radiator valve",
    );
    assert.match(
      expandTradeSynonymsForLookup("Wash hand basin as described"),
      /basin/i,
    );
    assert.match(
      expandTradeSynonymsForLookup("Doc M toilet pack"),
      /WC|toilet/i,
    );
  });

  it("matches library rates through noisy BoQ wording", () => {
    assert.ok(lookupLibraryRate("8/1/A — Thermostatic radiator valve qty 12", "nr") > 0);
    assert.ok(lookupLibraryRate("Wash hand basin", "nr") > 0);
    assert.ok(lookupLibraryRate("110mm UG foul drain", "m") > 0);
    assert.ok(lookupLibraryRate("2.5mm T&E twin and earth", "m") > 0);
    assert.ok(lookupLibraryRate("Extract fan", "nr") > 0);
    assert.ok(lookupLibraryRate("Pipe lagging", "m") > 0);
    assert.ok(lookupLibraryRate("Fire collar", "nr") > 0);
    assert.equal(lookupLibraryRate("Mystery widget XYZ-99", "nr"), 0);
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
    assert.equal(kit!.description, "TRV");
    assert.doesNotMatch(kit!.description, /8\/1\/A/);

    const heating = tenderBoqLineToKitLine(sampleLines[5]!, false);
    assert.equal(heating?.category, "Heating");

    const noisy: TenderBoqLine = {
      id: "n1",
      kind: "measured",
      ref: "3/2/A",
      description: "3/2/A — Double socket outlet (4nr)",
      quantity: 4,
      unit: "nr",
      rate: null,
      value: null,
      section: "Electrical",
    };
    const cleaned = tenderBoqLineToKitLine(noisy, false);
    assert.ok(cleaned);
    assert.match(cleaned!.description, /Double socket/i);
    assert.doesNotMatch(cleaned!.description, /\(4nr\)/);
    assert.equal(cleaned!.category, "Electrical");

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
    assert.equal(summary.leftBlank, 2);
    assert.equal(summary.pricedCount, 2);
  });

  it("only merges onto selected measured line ids", () => {
    const kits: KitLine[] = [
      {
        id: "l1",
        category: "Sanitary",
        description: "TRV",
        qty: 2,
        unitCost: 18,
        required: true,
        unit: "nr",
        pricingSource: "blake-budget",
      },
      {
        id: "l4",
        category: "Heating",
        description: "Panel radiator 600x1000",
        qty: 3,
        unitCost: 220,
        required: true,
        unit: "nr",
        pricingSource: "blake-budget",
      },
    ];
    const merged = mergeKitPricesOntoBoqLines(sampleLines, kits, { onlyLineIds: ["l4"] });
    assert.equal(merged[1]?.rate, null);
    assert.equal(merged[5]?.rate, 220);
    assert.equal(merged[5]?.value, 660);
    assert.equal(merged[5]?.pricingSource, "blake-budget");
    assert.equal(merged[3]?.pricingSource, "manual");

    const focused = summariseTenderBoqBlake(merged, ["l4"]);
    assert.equal(focused.targetedCount, 1);
    assert.equal(focused.targetedPricedCount, 1);
  });
});

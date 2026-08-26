import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatBudgetPriceOffer,
  formatOpenRecordBrief,
  looksLikeFillRates,
  looksLikeOpenRecordQs,
  looksLikeRefreshRates,
  summariseTenderForBlake,
} from "./blake-open-record";
import type { Tender, TenderBoqLine } from "./tenders-types";

function line(partial: Partial<TenderBoqLine> & { id: string; description: string }): TenderBoqLine {
  return {
    kind: "measured",
    ...partial,
  };
}

function sampleTender(overrides: Partial<Tender> = {}): Tender {
  const boqLines: TenderBoqLine[] = [
    { id: "h1", kind: "header", description: "SANITARY", section: "SANITARY", sheet: "Bill 4" },
    line({
      id: "l1",
      ref: "8/1/A",
      description: "Doc M toilet pack",
      quantity: 1,
      unit: "nr",
      rate: 1800,
      value: 1800,
      pricingSource: "rate-library",
      section: "SANITARY",
      sheet: "Bill 4",
    }),
    line({
      id: "l2",
      ref: "8/1/B",
      description: "Washbasin",
      quantity: 4,
      unit: "nr",
      rate: null,
      value: null,
      section: "SANITARY",
      sheet: "Bill 4",
    }),
    { id: "h2", kind: "header", description: "SUNDRIES", section: "SUNDRIES", sheet: "Bill 6" },
    line({
      id: "l3",
      ref: "6/9/A",
      description: "Testing and commissioning all mechanical installations",
      quantity: 1,
      unit: "item",
      rate: null,
      value: null,
      section: "SUNDRIES",
      sheet: "Bill 6",
    }),
  ];
  return {
    id: "tender-douneside",
    name: "Douneside House Health Club",
    client: "MacRobert Trust",
    category: "Plumbing",
    area: "Aberdeenshire",
    status: "In Progress",
    owner: "Office",
    bidValue: 1800,
    tenderSum: 1800,
    qualifications: [
      "Tender sum is based on the priced plumbing and heating items in the attached Bill of Quantities only.",
    ],
    daywork: { labourPerHour: 60, materialsUpliftPercent: 25, plantUpliftPercent: 20 },
    boqTitle: "Plumbing(2).xlsx",
    boqLines,
    documents: [
      { id: "d1", kind: "drawing", name: "TD012.pdf", uploadedAt: "2026-08-17T08:00:00.000Z" },
      { id: "d2", kind: "issued-boq", name: "Bill 4.xlsx", uploadedAt: "2026-08-17T08:00:00.000Z" },
    ],
    linkedTakeoffId: "to-1",
    linkedTakeoffRef: "TO-12",
    createdAt: "2026-08-17T08:00:00.000Z",
    updatedAt: "2026-08-17T08:00:00.000Z",
    ...overrides,
  };
}

describe("blake open-record QS", () => {
  it("detects price / walk-through wording from the ChatGPT-style workflow", () => {
    assert.equal(looksLikeFillRates("price this job like a QS using the rate library"), true);
    assert.equal(looksLikeFillRates("fill the rates on their bill"), true);
    assert.equal(looksLikeFillRates("what is still unpriced?"), false);
    assert.equal(looksLikeOpenRecordQs("walk me through this tender"), true);
    assert.equal(looksLikeOpenRecordQs("how's the weather"), false);
    assert.equal(looksLikeRefreshRates("refresh rates — submit today"), true);
  });

  it("summarises BoQ progress, blanks and documents without dumping the whole bill", () => {
    const snap = summariseTenderForBlake(sampleTender());
    assert.equal(snap.name, "Douneside House Health Club");
    assert.equal(snap.boq.measured, 3);
    assert.equal(snap.boq.priced, 1);
    assert.equal(snap.boq.unpriced, 2);
    assert.equal(snap.boq.libraryFilled, 1);
    assert.equal(snap.linkedTakeoff?.ref, "TO-12");
    assert.equal(snap.documents.drawing, 1);
    assert.equal(snap.boq.blankExamples.length, 2);
    assert.ok(snap.boq.blankExamples[0]?.description.includes("Washbasin"));
    assert.equal(snap.boq.sheets.length, 2);
  });

  it("writes an office brief that states FoT, blanks and that this is not a ChatGPT replay", () => {
    const brief = formatOpenRecordBrief({ tender: summariseTenderForBlake(sampleTender()) });
    assert.match(brief, /Douneside House Health Club/);
    assert.match(brief, /2 still blank/);
    assert.match(brief, /£1,800/);
    assert.match(brief, /TO-12/);
    assert.match(brief, /live BoQ in NeXa/);
    assert.doesNotMatch(brief, /chatgpt\.com/);
  });

  it("offers to apply rates only when measured lines exist", () => {
    const withBoq = formatBudgetPriceOffer({ tender: summariseTenderForBlake(sampleTender()) }, false);
    assert.equal(withBoq.canApply, true);
    assert.match(withBoq.detail, /2 blank/);
    assert.match(withBoq.reply, /will not silently drop/);

    const empty = formatBudgetPriceOffer(
      {
        tender: summariseTenderForBlake(
          sampleTender({
            boqLines: [{ id: "h1", kind: "header", description: "Empty bill" }],
            bidValue: 0,
            tenderSum: 0,
          }),
        ),
      },
      false,
    );
    assert.equal(empty.canApply, false);
    assert.match(empty.reply, /Import their bill/);
  });
});

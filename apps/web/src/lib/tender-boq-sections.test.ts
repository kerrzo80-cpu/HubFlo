import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterSelectedMeasuredLineIds,
  groupBoqLinesBySection,
  unpricedMeasuredLineIds,
} from "./tender-boq-sections";
import type { TenderBoqLine } from "./tenders-types";

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

describe("tender-boq-sections", () => {
  it("groups sheet sections for select-all", () => {
    const groups = groupBoqLinesBySection(sampleLines);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.label, "SANITARY");
    assert.deepEqual(groups[0]?.measuredIds, ["l1", "l2", "l3"]);
    assert.equal(groups[1]?.label, "Heating");
    assert.deepEqual(groups[1]?.measuredIds, ["l4"]);
    assert.deepEqual(filterSelectedMeasuredLineIds(sampleLines, ["l4", "missing"]), ["l4"]);
    assert.deepEqual(unpricedMeasuredLineIds(sampleLines), ["l1", "l2", "l4"]);
  });
});

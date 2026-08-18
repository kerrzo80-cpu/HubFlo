import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterBoqLinesBySheet,
  filterSelectedMeasuredLineIds,
  groupBoqLinesBySection,
  listBoqSheetTabs,
  unpricedMeasuredLineIds,
} from "./tender-boq-sections";
import type { TenderBoqLine } from "./tenders-types";

const sampleLines: TenderBoqLine[] = [
  { id: "h1", kind: "header", description: "SANITARY", section: "SANITARY", sheet: "Page 1" },
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
    sheet: "Page 1",
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
    sheet: "Page 1",
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
    sheet: "Page 1",
  },
  { id: "h2", kind: "header", description: "Heating", section: "Heating", sheet: "Page 2" },
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
    sheet: "Page 2",
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

  it("lists workbook sheet tabs and filters lines per tab", () => {
    const tabs = listBoqSheetTabs(sampleLines);
    assert.deepEqual(
      tabs.map((tab) => ({ key: tab.key, measuredIds: tab.measuredIds })),
      [
        { key: "Page 1", measuredIds: ["l1", "l2", "l3"] },
        { key: "Page 2", measuredIds: ["l4"] },
      ],
    );
    assert.deepEqual(
      filterBoqLinesBySheet(sampleLines, "Page 2").map((line) => line.id),
      ["h2", "l4"],
    );
  });

  it("keeps Pipework / Unspecified floor items inside the Heating layer group", () => {
    const lines: TenderBoqLine[] = [
      { id: "h-heat", kind: "header", description: "Heating", section: "Heating", sheet: "Takeoff · House Type A" },
      { id: "h-unspec", kind: "header", description: "Unspecified floor", section: "Unspecified floor", sheet: "Takeoff · House Type A" },
      { id: "h-pipe", kind: "header", description: "Pipework", section: "Pipework", sheet: "Takeoff · House Type A" },
      {
        id: "m-pipe",
        kind: "measured",
        description: "22mm copper",
        quantity: 8,
        unit: "m",
        section: "Pipework",
        sheet: "Takeoff · House Type A",
      },
      { id: "h-cnt", kind: "header", description: "Counts", section: "Counts", sheet: "Takeoff · House Type A" },
      {
        id: "m-trv",
        kind: "measured",
        description: "TRV",
        quantity: 4,
        unit: "nr",
        section: "Counts",
        sheet: "Takeoff · House Type A",
      },
      { id: "h-hc", kind: "header", description: "Hot & cold", section: "Hot & cold", sheet: "Takeoff · House Type A" },
      {
        id: "m-cold",
        kind: "measured",
        description: "15mm copper",
        quantity: 3,
        unit: "m",
        section: "Hot & cold",
        sheet: "Takeoff · House Type A",
      },
    ];
    const groups = groupBoqLinesBySection(lines);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.label, "Heating");
    assert.deepEqual(groups[0]?.measuredIds, ["m-pipe", "m-trv"]);
    assert.equal(groups[1]?.label, "Hot & cold");
    assert.deepEqual(groups[1]?.measuredIds, ["m-cold"]);
  });
});

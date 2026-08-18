import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeBoqTotal,
  parseBoqDelimitedText,
  parseBoqFromRows,
  parseBoqFromWorkbookSheets,
} from "@/lib/tenders-data";
import { listBoqSheetTabs } from "@/lib/tender-boq-sections";

describe("tenders-data BoQ parse", () => {
  it("parses measured lines and section headers from CSV", () => {
    const csv = [
      "Plumbing e-Enquiry [Harlaw]",
      "Ref,Description,Quantity,Units,Rate,Value",
      ",SANITARY APPLIANCES,,,," ,
      "8/1/A,Doc M Toilet Pack,1,nr,1836,1836",
      "8/1/B,Washbasin,4,nr,359,1436",
      "14/1/d,Compressed air removal,1,ITEM,,",
    ].join("\n");

    const parsed = parseBoqDelimitedText(csv);
    assert.equal(parsed.title, "Plumbing e-Enquiry [Harlaw]");
    assert.equal(parsed.lines[0]?.kind, "header");
    assert.equal(parsed.lines[0]?.section, "SANITARY APPLIANCES");
    assert.equal(parsed.lines[1]?.ref, "8/1/A");
    assert.equal(parsed.lines[1]?.section, "SANITARY APPLIANCES");
    assert.equal(parsed.lines[1]?.rate, 1836);
    assert.equal(parsed.lines[3]?.ref, "14/1/d");
    assert.equal(parsed.lines[3]?.rate, null);
    assert.equal(parsed.lines[3]?.value, null);
    assert.equal(computeBoqTotal(parsed.lines), 3272);
  });

  it("keeps multi-line quoted wording instead of truncating at the newline", () => {
    const csv = [
      "Ref,Description,Quantity,Units,Rate,Value",
      '"8/1/A","Doc M Toilet Pack, complete with Grab Rails',
      'complete installation as per drawings and specification",1,nr,,',
    ].join("\n");

    const parsed = parseBoqDelimitedText(csv);
    assert.equal(parsed.lines.length, 1);
    assert.match(parsed.lines[0]?.description || "", /Grab Rails/);
    assert.match(parsed.lines[0]?.description || "", /complete installation as per drawings/);
  });

  it("merges description + specification columns into full wording", () => {
    const parsed = parseBoqFromRows([
      ["Ref", "Description", "Specification", "Quantity", "Units", "Rate", "Value"],
      [
        "8/1/A",
        "Doc M Toilet Pack",
        "complete with Grab Rails; install as drawings",
        "1",
        "nr",
        "",
        "",
      ],
      ["8/1/B", "Washbasin", "Profile 21 50cm Semi Countertop", "4", "nr", "", ""],
    ]);

    assert.equal(parsed.lines.length, 2);
    assert.equal(
      parsed.lines[0]?.description,
      "Doc M Toilet Pack\ncomplete with Grab Rails; install as drawings",
    );
    assert.equal(parsed.lines[1]?.description, "Washbasin\nProfile 21 50cm Semi Countertop");
  });

  it("stamps workbook sheet tabs and keeps section headings inside each sheet", () => {
    const parsed = parseBoqFromWorkbookSheets([
      {
        name: "Page 1",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["", "SANITARY APPLIANCES", "", "", "", ""],
          ["8/1/A", "Doc M pack\nwith rails", "1", "nr", "", ""],
        ],
      },
      {
        name: "Page 2",
        rows: [
          ["Ref", "Description", "Specification", "Qty", "Units", "Rate", "Amount"],
          ["8/2/A", "Basin", "Armitage Shanks Profile 21", "2", "nr", "", ""],
        ],
      },
    ]);

    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.equal(measured.length, 2);
    assert.equal(measured[0]?.sheet, "Page 1");
    assert.equal(measured[0]?.section, "SANITARY APPLIANCES");
    assert.equal(measured[0]?.description, "Doc M pack\nwith rails");
    assert.equal(measured[1]?.sheet, "Page 2");
    assert.equal(measured[1]?.description, "Basin\nArmitage Shanks Profile 21");

    const tabs = listBoqSheetTabs(parsed.lines);
    assert.deepEqual(
      tabs.map((tab) => tab.key),
      ["Page 1", "Page 2"],
    );
    assert.deepEqual(tabs[0]?.measuredIds.length, 1);
    assert.deepEqual(tabs[1]?.measuredIds.length, 1);
  });

  it("uses Line Total (not Item Total) and skips section TOTAL rows so Bid value is not double-counted", () => {
    // Mirrors priced flat BoQs: materials Item Total + labour Line Total, with
    // Section=TOTAL summary rows that would inflate Bid value if imported.
    const parsed = parseBoqFromRows([
      [
        "Section",
        "Ref",
        "Description",
        "Qty",
        "Unit",
        "Rate",
        "Item Total",
        "Labour Hours",
        "Labour Rate",
        "Labour Total",
        "Line Total",
      ],
      ["Heating", "A1", "Boiler package", "1", "nr", "1000", "1000", "2", "70", "140", "1140"],
      ["Heating", "A2", "Controls", "2", "nr", "50", "100", "1", "70", "70", "170"],
      ["TOTAL", "", "Materials and clip costs", "", "", "", "1100", "", "", "", "1100"],
      ["TOTAL", "", "Labour", "", "", "", "", "3", "70", "210", "210"],
      ["TOTAL", "", "FLAT TOTAL", "", "", "", "", "3", "70", "210", "1310"],
      ["", "", "PAGE TOTAL", "", "", "", "", "", "", "", "1310"],
      ["", "", "SUBTOTAL", "", "", "", "9999", "", "", "", "9999"],
    ]);

    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.equal(measured.length, 2);
    assert.equal(measured[0]?.value, 1140);
    assert.equal(measured[0]?.rate, 1000);
    assert.equal(measured[1]?.value, 170);
    // Naive sum of Item Total + TOTAL rows would be 1000+100+1100+9999 = 12199 (or worse).
    // Correct Bid value is Line Total of measured lines only.
    assert.equal(computeBoqTotal(parsed.lines), 1310);
  });

  it("prefers Amount column over qty×rate and does not double-count both", () => {
    const parsed = parseBoqFromRows([
      ["Ref", "Description", "Quantity", "Units", "Rate", "Amount"],
      // Amount disagrees with qty×rate on purpose — Bid value must use Amount once.
      ["1", "Priced item", "10", "nr", "5", "40"],
      ["2", "Another", "2", "nr", "100", "250"],
    ]);

    assert.equal(parsed.lines[0]?.value, 40);
    assert.equal(parsed.lines[1]?.value, 250);
    assert.equal(computeBoqTotal(parsed.lines), 290);
    assert.notEqual(computeBoqTotal(parsed.lines), 10 * 5 + 40 + 2 * 100 + 250);
  });

  it("when Line Total bill sheets exist, skips Client/Heating restatement tabs", () => {
    const parsed = parseBoqFromWorkbookSheets([
      {
        name: "Flat - Ground",
        rows: [
          [
            "Section",
            "Ref",
            "Description",
            "Qty",
            "Unit",
            "Rate",
            "Item Total",
            "Labour Hours",
            "Labour Rate",
            "Labour Total",
            "Line Total",
          ],
          ["Works", "1", "Boiler", "1", "nr", "1000", "1000", "2", "70", "140", "1140"],
          ["TOTAL", "", "FLAT TOTAL", "", "", "", "", "", "", "", "1140"],
        ],
      },
      {
        name: "Client - Ground",
        rows: [
          ["Work Package", "Summary of Works", "", "", "", "", "Amount"],
          ["Heating", "Supply and install heating", "", "", "", "", "1140"],
          ["TOTAL PRICE FOR THIS FLAT", "", "", "", "", "", "1140"],
        ],
      },
      {
        name: "Ground Floor Heating",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["B1", "Boiler materials only", "1", "nr", "1000", "1000"],
          ["", "PAGE TOTAL", "", "", "", "1000"],
        ],
      },
    ]);

    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.equal(measured.length, 1);
    assert.equal(measured[0]?.sheet, "Flat - Ground");
    assert.equal(computeBoqTotal(parsed.lines), 1140);
  });
});

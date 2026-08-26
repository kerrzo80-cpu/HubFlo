import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";

import { parseBoqFromWorkbookSheets } from "@/lib/tenders-data";
import { listBoqSheetTabs } from "@/lib/tender-boq-sections";
import {
  allSheetRowsFromWorkbookBuffer,
  sheetRowsFromWorkbookBuffer,
  workbookBoqSheetsFromBuffer,
} from "@/lib/tenders-xlsx";

function workbookBuffer(sheets: Array<{ name: string; rows: unknown[][] }>) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("tenders-xlsx multi-sheet BoQ", () => {
  it("sheetRowsFromWorkbookBuffer still returns only sheet 0 (tracker path)", () => {
    const bytes = workbookBuffer([
      {
        name: "Page 1",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["8/1/A", "Doc M pack", 1, "nr", 100, 100],
        ],
      },
      {
        name: "Page 2",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["8/2/A", "Basin", 2, "nr", 50, 100],
        ],
      },
    ]);

    const firstOnly = sheetRowsFromWorkbookBuffer(bytes);
    assert.equal(firstOnly.length, 2);
    assert.equal(firstOnly[1]?.[0], "8/1/A");
  });

  it("workbookBoqSheetsFromBuffer preserves each worksheet for tabs + full wording", () => {
    const bytes = workbookBuffer([
      {
        name: "Page 1",
        rows: [
          ["Ref", "Description", "Specification", "Quantity", "Units", "Rate", "Value"],
          [
            "8/1/A",
            "Doc M Toilet Pack, complete with Grab Rails",
            "complete installation as per drawings",
            1,
            "nr",
            1836,
            1836,
          ],
        ],
      },
      {
        name: "Page 2",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["8/2/A", "Washbasin", 4, "nr", 359, 1436],
          ["14/1/d", "Compressed air removal", 1, "ITEM", "", ""],
        ],
      },
    ]);

    const sheets = workbookBoqSheetsFromBuffer(bytes);
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0]?.name, "Page 1");
    assert.equal(sheets[1]?.name, "Page 2");

    const parsed = parseBoqFromWorkbookSheets(sheets);
    const tabs = listBoqSheetTabs(parsed.lines);
    assert.deepEqual(
      tabs.map((tab) => tab.label),
      ["Page 1", "Page 2"],
    );
    assert.equal(parsed.lines.filter((line) => line.kind === "measured").length, 3);
    assert.equal(parsed.lines.find((line) => line.ref === "8/1/A")?.sheet, "Page 1");
    assert.equal(parsed.lines.find((line) => line.ref === "8/2/A")?.sheet, "Page 2");
    assert.match(
      parsed.lines.find((line) => line.ref === "8/1/A")?.description || "",
      /Grab Rails/,
    );
    assert.match(
      parsed.lines.find((line) => line.ref === "8/1/A")?.description || "",
      /complete installation as per drawings/,
    );
  });

  it("allSheetRowsFromWorkbookBuffer still merges pages with sheet markers", () => {
    const bytes = workbookBuffer([
      {
        name: "Page 1",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["8/1/A", "Doc M pack", 1, "nr", 1836, 1836],
        ],
      },
      {
        name: "Page 2",
        rows: [
          ["Ref", "Description", "Quantity", "Units", "Rate", "Value"],
          ["8/2/A", "Washbasin", 4, "nr", 359, 1436],
        ],
      },
    ]);

    const rows = allSheetRowsFromWorkbookBuffer(bytes);
    assert.ok(rows.some((row) => row[0] === "§SHEET§" && row[1] === "Page 1"));
    assert.ok(rows.some((row) => row[0] === "§SHEET§" && row[1] === "Page 2"));
    assert.ok(rows.some((row) => row[0] === "8/1/A"));
    assert.ok(rows.some((row) => row[0] === "8/2/A"));
  });
});

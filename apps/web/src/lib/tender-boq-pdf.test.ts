import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseBoqFromWorkbookSheets } from "@/lib/tenders-data";
import { listBoqSheetTabs } from "@/lib/tender-boq-sections";
import {
  pdfPageToBoqRows,
  syntheticPdfPage,
  workbookBoqSheetsFromPdfDocument,
} from "@/lib/tender-boq-pdf";
import type { ExtractedPdfDocument } from "@/lib/takeoff-pdf-extract";

describe("tender-boq-pdf", () => {
  it("rebuilds Ref / Description / Qty / Unit columns from positioned text", () => {
    const page = syntheticPdfPage(1, [
      { text: "Ref", x: 40, y: 700 },
      { text: "Description", x: 120, y: 700 },
      { text: "Quantity", x: 360, y: 700 },
      { text: "Units", x: 440, y: 700 },
      { text: "Rate", x: 500, y: 700 },
      { text: "8/1/A", x: 40, y: 680 },
      { text: "Copper", x: 120, y: 680 },
      { text: "pipe", x: 160, y: 680, width: 20 },
      { text: "22mm", x: 200, y: 680 },
      { text: "12", x: 360, y: 680 },
      { text: "m", x: 440, y: 680 },
      { text: "18.50", x: 500, y: 680 },
    ]);

    const rows = pdfPageToBoqRows(page);
    assert.ok(rows.length >= 2);
    const header = rows[0]!;
    assert.ok(header.some((c) => /ref/i.test(c)));
    assert.ok(header.some((c) => /description/i.test(c)));

    const data = rows[1]!;
    assert.equal(data[0], "8/1/A");
    assert.match(data.join(" "), /Copper/);
    assert.match(data.join(" "), /12/);
    assert.match(data.join(" "), /\bm\b/);
  });

  it("imports multi-page PDF sheets into BoQ tabs + measured lines", () => {
    const page1 = syntheticPdfPage(1, [
      { text: "Ref", x: 40, y: 700 },
      { text: "Description", x: 120, y: 700 },
      { text: "Quantity", x: 360, y: 700 },
      { text: "Units", x: 440, y: 700 },
      { text: "8/1/A", x: 40, y: 680 },
      { text: "Doc M Toilet Pack", x: 120, y: 680 },
      { text: "1", x: 360, y: 680 },
      { text: "nr", x: 440, y: 680 },
    ]);
    const page2 = syntheticPdfPage(2, [
      { text: "Ref", x: 40, y: 700 },
      { text: "Description", x: 120, y: 700 },
      { text: "Quantity", x: 360, y: 700 },
      { text: "Units", x: 440, y: 700 },
      { text: "8/2/A", x: 40, y: 680 },
      { text: "Washbasin", x: 120, y: 680 },
      { text: "4", x: 360, y: 680 },
      { text: "nr", x: 440, y: 680 },
    ]);

    const doc: ExtractedPdfDocument = {
      fileName: "boq.pdf",
      pageCount: 2,
      pages: [page1, page2],
    };
    const sheets = workbookBoqSheetsFromPdfDocument(doc);
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0]?.name, "Page 1");
    assert.equal(sheets[1]?.name, "Page 2");

    const parsed = parseBoqFromWorkbookSheets(sheets);
    const tabs = listBoqSheetTabs(parsed.lines);
    assert.deepEqual(
      tabs.map((tab) => tab.label),
      ["Page 1", "Page 2"],
    );
    assert.equal(parsed.lines.filter((line) => line.kind === "measured").length, 2);
    assert.equal(parsed.lines.find((line) => line.ref === "8/1/A")?.sheet, "Page 1");
    assert.equal(parsed.lines.find((line) => line.ref === "8/2/A")?.quantity, 4);
  });

  it("rejects PDFs with no selectable text", () => {
    const doc: ExtractedPdfDocument = {
      fileName: "scan.pdf",
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          width: 600,
          height: 800,
          textItems: [],
          fullText: "",
          hasSelectableText: false,
        },
      ],
    };
    assert.throws(
      () => workbookBoqSheetsFromPdfDocument(doc),
      /no selectable text/i,
    );
  });
});

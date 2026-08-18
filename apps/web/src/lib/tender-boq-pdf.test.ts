import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseBoqFromWorkbookSheets } from "@/lib/tenders-data";
import { listBoqSheetTabs } from "@/lib/tender-boq-sections";
import {
  pdfPageToBoqRows,
  pdfPageToSupplierQuoteRows,
  pdfPageToWilliamWilsonQuoteRows,
  syntheticPdfPage,
  workbookBoqSheetsFromPdfDocument,
} from "@/lib/tender-boq-pdf";
import type { ExtractedPdfDocument } from "@/lib/takeoff-pdf-extract";

const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/william-wilson-heating");

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
    assert.equal(sheets[0]?.name, "boq · Page 1");
    assert.equal(sheets[1]?.name, "boq · Page 2");

    const parsed = parseBoqFromWorkbookSheets(sheets);
    const tabs = listBoqSheetTabs(parsed.lines);
    assert.deepEqual(
      tabs.map((tab) => tab.label),
      ["boq · Page 1", "boq · Page 2"],
    );
    assert.equal(parsed.lines.filter((line) => line.kind === "measured").length, 2);
    assert.equal(parsed.lines.find((line) => line.ref === "8/1/A")?.sheet, "boq · Page 1");
    assert.equal(parsed.lines.find((line) => line.ref === "8/2/A")?.quantity, 4);
  });

  it("parses Filpumps-style sales order / quotation PDFs into priced lines", () => {
    const page = syntheticPdfPage(1, [
      { text: "Filpumps", x: 38, y: 800 },
      { text: "Quotation", x: 104, y: 800 },
      { text: "Qty", x: 27, y: 532 },
      { text: "Ordered", x: 48, y: 532 },
      { text: "Product", x: 94, y: 532 },
      { text: "Code", x: 131, y: 532 },
      { text: "Product", x: 176, y: 532 },
      { text: "Description", x: 212, y: 532 },
      { text: "Unit", x: 394, y: 532 },
      { text: "Price", x: 415, y: 532 },
      { text: "Net", x: 454, y: 532 },
      { text: "Price", x: 471, y: 532 },
      { text: "VAT", x: 499, y: 532 },
      { text: "Amount", x: 522, y: 532 },
      { text: "0.00", x: 70, y: 501 },
      { text: "M", x: 94, y: 501 },
      { text: "3", x: 159, y: 501 },
      { text: "QUEENS", x: 165, y: 501 },
      { text: "TERRACE", x: 199, y: 501 },
      { text: "0.00", x: 423, y: 501 },
      { text: "0.00", x: 479, y: 501 },
      { text: "1.00", x: 70, y: 487 },
      { text: "S1", x: 94, y: 487 },
      { text: "ESYTANK", x: 159, y: 487 },
      { text: "PRO", x: 199, y: 487 },
      { text: "1500AG", x: 216, y: 487 },
      { text: "8,147.15", x: 409, y: 487 },
      { text: "8,147.15", x: 465, y: 487 },
      { text: "1,629.43", x: 527, y: 487 },
      { text: "1.00", x: 70, y: 472 },
      { text: "LOWUK1100006", x: 94, y: 472 },
      { text: "60LTR", x: 159, y: 472 },
      { text: "LOWARA", x: 185, y: 472 },
      { text: "VESSEL", x: 310, y: 472 },
      { text: "164.00", x: 415, y: 472 },
      { text: "164.00", x: 471, y: 472 },
      { text: "1.00", x: 70, y: 444 },
      { text: "S1", x: 94, y: 444 },
      { text: "CARRIAGE", x: 159, y: 444 },
      { text: "100.00", x: 415, y: 444 },
      { text: "100.00", x: 471, y: 444 },
      { text: "Total", x: 357, y: 163 },
      { text: "Net", x: 382, y: 163 },
      { text: "Amount", x: 399, y: 163 },
      { text: "8,411.15", x: 504, y: 163 },
    ]);

    const rows = pdfPageToSupplierQuoteRows(page);
    assert.ok(rows);
    assert.equal(rows![0]?.[0], "Ref");
    assert.equal(rows!.length, 4); // header + 3 priced lines (memo skipped)
    assert.equal(rows![1]?.[0], "S1");
    assert.match(rows![1]![1] || "", /ESYTANK/);
    assert.equal(rows![1]?.[2], "1");
    assert.equal(rows![1]?.[4], "8147.15");
    assert.equal(rows![2]?.[0], "LOWUK1100006");
    assert.equal(rows![3]?.[1], "CARRIAGE");

    const sheets = workbookBoqSheetsFromPdfDocument({
      fileName: "Sales Order 20668.pdf",
      pageCount: 1,
      pages: [page],
    });
    const parsed = parseBoqFromWorkbookSheets(sheets);
    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.equal(measured.length, 3);
    assert.equal(measured[0]?.rate, 8147.15);
    assert.equal(measured[1]?.quantity, 1);
    assert.equal(measured[2]?.description, "CARRIAGE");
    assert.equal(sheets[0]?.name, "Sales Order 20668");
  });

  it("parses William Wilson LINE / PRODUCT CODE / QTY. / PRICE / NET VALUE quotes", () => {
    // x positions mirror real WW FOP quotes: value cells sit left of wide header labels.
    const page = syntheticPdfPage(1, [
      { text: "William", x: 500, y: 700 },
      { text: "Wilson", x: 545, y: 700 },
      { text: "Quotation", x: 370, y: 690 },
      { text: "LINE", x: 17, y: 520 },
      { text: "PRODUCT CODE", x: 82, y: 520 },
      { text: "PRODUCT DESCRIPTION", x: 354, y: 520 },
      { text: "QTY.", x: 624, y: 520 },
      { text: "PRICE", x: 664, y: 520 },
      { text: "NET VALUE", x: 778, y: 520 },
      { text: "10", x: 17, y: 500 },
      { text: "ZTEXT", x: 41, y: 500 },
      { text: "Apartment 1", x: 193, y: 500 },
      { text: "1", x: 644, y: 500 },
      { text: "0.00", x: 682, y: 500 },
      { text: "0.00", x: 809, y: 500 },
      { text: "20", x: 17, y: 480 },
      { text: "VLT0010036013", x: 41, y: 480 },
      { text: "VAILLANT ECOTEC PLUS 630 30KW SYSTEM BOILER", x: 193, y: 480 },
      { text: "1", x: 644, y: 480 },
      { text: "1697.33", x: 668, y: 480 },
      { text: "1697.33", x: 796, y: 480 },
      { text: "40", x: 17, y: 460 },
      { text: "VLT303203", x: 41, y: 460 },
      { text: "VAILLANT AIR/FLUE DUCT EXTENSION (970MM)", x: 193, y: 460 },
      { text: "4", x: 644, y: 460 },
      { text: "63.18", x: 677, y: 460 },
      { text: "252.72", x: 800, y: 460 },
      { text: "TOTAL GOODS (Excl VAT)", x: 600, y: 200 },
      { text: "12775.89", x: 790, y: 200 },
    ]);

    const rows = pdfPageToWilliamWilsonQuoteRows(page);
    assert.ok(rows);
    assert.equal(rows![0]?.[0], "Ref");
    // ZTEXT → section header row (blank qty/rate), plus 2 priced lines
    assert.ok(rows!.length >= 4);
    assert.equal(rows![1]?.[1], "Apartment 1");
    assert.equal(rows![1]?.[2], "");
    assert.equal(rows![2]?.[0], "VLT0010036013");
    assert.match(rows![2]![1] || "", /VAILLANT ECOTEC/);
    assert.equal(rows![2]?.[2], "1");
    assert.equal(rows![2]?.[4], "1697.33");
    assert.equal(rows![3]?.[2], "4");
    assert.equal(rows![3]?.[5], "252.72");

    const sheets = workbookBoqSheetsFromPdfDocument({
      fileName: "Lower Ground Heating.pdf",
      pageCount: 2,
      pages: [
        page,
        syntheticPdfPage(2, [
          { text: "William Wilson", x: 500, y: 700 },
          { text: "LINE", x: 17, y: 520 },
          { text: "PRODUCT CODE", x: 82, y: 520 },
          { text: "PRODUCT DESCRIPTION", x: 354, y: 520 },
          { text: "QTY.", x: 624, y: 520 },
          { text: "PRICE", x: 664, y: 520 },
          { text: "NET VALUE", x: 778, y: 520 },
          { text: "250", x: 17, y: 480 },
          { text: "HTM-NE0STATV3WH", x: 41, y: 480 },
          { text: "HEATMISER NEO STAT V3 PROG. THERMOSTAT WHITE", x: 193, y: 480 },
          { text: "9", x: 644, y: 480 },
          { text: "63.37", x: 677, y: 480 },
          { text: "570.36", x: 796, y: 480 },
        ]),
      ],
    });
    // Supplier quotes merge into one filename tab (not Page 1 / Page 2).
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0]?.name, "Lower Ground Heating");
    const parsed = parseBoqFromWorkbookSheets(sheets);
    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.equal(measured.length, 3);
    assert.ok(parsed.lines.some((line) => line.kind === "header" && /Apartment 1/i.test(line.description)));
    assert.equal(measured.find((line) => /ECOTEC/i.test(line.description))?.rate, 1697.33);
    assert.equal(measured.find((line) => /NEO STAT V3/i.test(line.description))?.quantity, 9);
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

  it("imports the Sales Order 20668.pdf fixture when present", async () => {
    const fixture = resolve(process.cwd(), "../../tmp/Sales Order 20668.pdf");
    const alt = resolve(process.cwd(), "tmp/Sales Order 20668.pdf");
    const path = existsSync(fixture) ? fixture : existsSync(alt) ? alt : "";
    if (!path) {
      // Optional local fixture — skip quietly in CI without the desktop PDF copy.
      return;
    }
    const { workbookBoqSheetsFromPdfBuffer } = await import("@/lib/tender-boq-pdf");
    const sheets = await workbookBoqSheetsFromPdfBuffer(readFileSync(path), "Sales Order 20668.pdf");
    const parsed = parseBoqFromWorkbookSheets(sheets);
    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.ok(measured.length >= 3, `expected >=3 measured, got ${measured.length}`);
    assert.ok(measured.some((line) => /ESYTANK|ESYBOX/i.test(line.description)));
    assert.ok(measured.some((line) => /LOWARA|VESSEL|LOWUK/i.test(`${line.ref || ""} ${line.description}`)));
    assert.ok(measured.some((line) => /CARRIAGE/i.test(line.description)));
    assert.equal(measured.find((line) => /ESYTANK|ESYBOX/i.test(line.description))?.rate, 8147.15);
  });

  it("sales-order fixture tab never includes Cold pipe runs / takeoff metres", async () => {
    const fixture = resolve(process.cwd(), "../../tmp/Sales Order 20668.pdf");
    const alt = resolve(process.cwd(), "tmp/Sales Order 20668.pdf");
    const path = existsSync(fixture) ? fixture : existsSync(alt) ? alt : "";
    if (!path) return;

    const { workbookBoqSheetsFromPdfBuffer } = await import("@/lib/tender-boq-pdf");
    const sheets = await workbookBoqSheetsFromPdfBuffer(readFileSync(path), "Sales Order 33888.pdf");
    const parsed = parseBoqFromWorkbookSheets(sheets);
    const measured = parsed.lines.filter((line) => line.kind === "measured");
    assert.ok(measured.length >= 3);
    assert.ok(
      measured.every((line) => !/cold\s+pipe\s+runs?/i.test(line.description)),
      "supplier PDF tab must not invent Cold pipe runs",
    );
    assert.ok(measured.every((line) => line.unit === "nr" || !line.unit));
    assert.ok(measured.some((line) => /CARRIAGE/i.test(line.description)));
  });

  it("skips takeoff pipe-metre rows even if they appear in a supplier quote parse", () => {
    const page = syntheticPdfPage(1, [
      { text: "Filpumps", x: 38, y: 800 },
      { text: "Quotation", x: 104, y: 800 },
      { text: "Qty", x: 27, y: 532 },
      { text: "Ordered", x: 48, y: 532 },
      { text: "Product", x: 94, y: 532 },
      { text: "Code", x: 131, y: 532 },
      { text: "Product", x: 176, y: 532 },
      { text: "Description", x: 212, y: 532 },
      { text: "Unit", x: 394, y: 532 },
      { text: "Price", x: 415, y: 532 },
      { text: "Net", x: 454, y: 532 },
      { text: "Price", x: 471, y: 532 },
      { text: "1.00", x: 70, y: 500 },
      { text: "PIPE", x: 94, y: 500 },
      { text: "15mm", x: 176, y: 500 },
      { text: "Copper", x: 210, y: 500 },
      { text: "-", x: 250, y: 500 },
      { text: "Cold", x: 260, y: 500 },
      { text: "pipe", x: 290, y: 500 },
      { text: "runs", x: 320, y: 500 },
      { text: "9.50", x: 415, y: 500 },
      { text: "9.50", x: 471, y: 500 },
      { text: "1.00", x: 70, y: 480 },
      { text: "S1", x: 94, y: 480 },
      { text: "CARRIAGE", x: 176, y: 480 },
      { text: "100.00", x: 415, y: 480 },
      { text: "100.00", x: 471, y: 480 },
    ]);
    const rows = pdfPageToSupplierQuoteRows(page);
    assert.ok(rows);
    assert.equal(rows!.length, 2); // header + CARRIAGE only
    assert.equal(rows![1]?.[1], "CARRIAGE");
  });

  it("parses each William Wilson flat heating fixture to >0 measured lines", async () => {
    assert.ok(existsSync(FIXTURE_DIR), `missing fixtures at ${FIXTURE_DIR}`);
    const files = readdirSync(FIXTURE_DIR).filter((name) => name.toLowerCase().endsWith(".pdf")).sort();
    assert.equal(files.length, 4, `expected 4 heating PDFs, got ${files.join(", ")}`);

    const { workbookBoqSheetsFromPdfBuffer } = await import("@/lib/tender-boq-pdf");
    const counts: Record<string, number> = {};
    for (const file of files) {
      const sheets = await workbookBoqSheetsFromPdfBuffer(readFileSync(join(FIXTURE_DIR, file)), file);
      assert.equal(sheets.length, 1, `${file} should be one tab`);
      assert.equal(sheets[0]?.name, file.replace(/\.pdf$/i, "").trim());
      const parsed = parseBoqFromWorkbookSheets(sheets);
      const measured = parsed.lines.filter((line) => line.kind === "measured");
      counts[file] = measured.length;
      assert.ok(measured.length > 0, `${file}: expected >0 measured, got 0`);
      assert.ok(
        measured.some((line) => /VAILLANT|HEATMISER|ECOTEC|UFH/i.test(`${line.ref || ""} ${line.description}`)),
        `${file}: expected boiler/UFH style lines`,
      );
      assert.ok(measured.every((line) => line.sheet === sheets[0]?.name));
    }
    // All four flats share the same priced SKU count on these quotes.
    for (const [file, count] of Object.entries(counts)) {
      assert.ok(count >= 15, `${file}: expected >=15 measured, got ${count}`);
    }
  });
});

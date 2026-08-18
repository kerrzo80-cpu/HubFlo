import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReportsBoardPackPdf, buildReportsExcelXml, buildManagerBoardPackRows } from "./reports-board-pack";

describe("reports board pack", () => {
  it("builds a PDF with executive rows", async () => {
    const pdf = await buildReportsBoardPackPdf({
      companyName: "Errol Watson Group",
      dateLabel: "This week",
      rows: [
        ["Executive", "Revenue", 12000, "Invoices"],
        ["Jobs", "J-100", 2400, "Acme · 28% margin"],
      ],
    });
    assert.ok(pdf.byteLength > 500);
    assert.equal(pdf[0], 0x25); // %PDF
    assert.equal(String.fromCharCode(pdf[1]!, pdf[2]!, pdf[3]!), "PDF");
  });

  it("builds Excel XML with one sheet per section", () => {
    const xml = buildReportsExcelXml({
      dateLabel: "This week",
      rows: [
        ["Executive", "Revenue", 12000, "Invoices"],
        ["Jobs", "J-100", 2400, "Acme"],
      ],
    });
    assert.match(xml, /ss:Name="Executive"/);
    assert.match(xml, /ss:Name="Jobs"/);
    assert.match(xml, /Workbook/);
  });

  it("buildManagerBoardPackRows returns titled pack metadata", () => {
    const pack = buildManagerBoardPackRows({
      asAt: "2026-08-06T09:00:00.000Z",
      snapshot: { invoices: [], jobs: [] },
    });
    assert.match(pack.title, /Manager board pack/);
    assert.equal(pack.rows.length >= 1, true);
  });
});

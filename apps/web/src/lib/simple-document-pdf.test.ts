import assert from "node:assert/strict";
import test from "node:test";

import { createSimpleDocumentPdf, simpleDocumentFilename } from "./simple-document-pdf";

test("createSimpleDocumentPdf returns a PDF buffer with rows and totals", async () => {
  const pdf = await createSimpleDocumentPdf({
    filename: "acme-statement.pdf",
    title: "Customer statement",
    businessName: "Errol Watson Group",
    reference: "STMT-2026-08-07",
    recipient: "Acme Ltd",
    subject: "Outstanding balance as at 2026-08-07",
    rows: [
      {
        description: "INV-1 · due 2026-07-01 · 37d overdue",
        detail: "Boiler service",
        value: "£120.00",
      },
      {
        description: "INV-2 · due 2026-08-01",
        detail: "Call out",
        value: "£60.00",
      },
    ],
    subtotal: "£180.00",
    vat: "£0.00",
    total: "£180.00",
  });

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500);
  assert.equal(pdf.subarray(0, 4).toString("utf8"), "%PDF");
  assert.equal(simpleDocumentFilename({ filename: "acme-statement" }), "acme-statement.pdf");
});

test("createSimpleDocumentPdf paginates long row lists", async () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({
    description: `INV-${index + 1} · due 2026-08-01 · ${index}d overdue`,
    detail: `Line ${index + 1}`,
    value: `£${(index + 1).toFixed(2)}`,
  }));
  const pdf = await createSimpleDocumentPdf({
    title: "Customer statement",
    businessName: "EWG",
    reference: "STMT-LONG",
    recipient: "Busy Client",
    subject: "Outstanding",
    rows,
    subtotal: "£1000.00",
    vat: "£0.00",
    total: "£1000.00",
  });
  assert.ok(pdf.length > 2000);
  assert.equal(pdf.subarray(0, 4).toString("utf8"), "%PDF");
});

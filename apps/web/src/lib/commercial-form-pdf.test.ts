import assert from "node:assert/strict";
import test from "node:test";

import { createBrandedCommercialPdf, shouldUseBrandedCommercialPdf } from "./commercial-form-pdf.ts";

test("shouldUseBrandedCommercialPdf when form template is present", () => {
  assert.equal(
    shouldUseBrandedCommercialPdf({
      title: "Invoice",
      reference: "INV-1",
      formTemplate: {
        id: "form-template-invoice-description",
        layout: "invoice",
        name: "Invoice · description",
        title: "Invoice",
      },
    }),
    true,
  );
  assert.equal(shouldUseBrandedCommercialPdf({ title: "Invoice", reference: "INV-1" }), false);
});

test("createBrandedCommercialPdf returns a PDF buffer with branded layout inputs", async () => {
  const pdf = await createBrandedCommercialPdf({
    filename: "INV-TEST.pdf",
    title: "Invoice",
    businessName: "Errol Watson Group",
    reference: "INV-TEST",
    recipient: "Example Client Ltd",
    subject: "Bathroom refurbishment works",
    rows: [{ description: "Completed plumbing works", value: "£2,400.00" }],
    subtotal: "£2,400.00",
    vat: "£480.00",
    total: "£2,880.00",
    subtotalAmount: 2400,
    vatAmount: 480,
    totalAmount: 2880,
    formTemplate: {
      id: "form-template-invoice-description",
      layout: "invoice",
      name: "Invoice · description",
      title: "Invoice",
      headerNote: "Summary invoice",
      intro: "Invoice for completed and approved works.",
      terms: "Payment due within 30 days.",
      footer: "Please use the invoice reference when making payment.",
      includeBankDetails: true,
      showLogo: false,
    },
    businessSettings: {
      tradingName: "Errol Watson Group",
      companyName: "Errol Watson Group",
      address: "Aberdeen AB10 1UT",
      phone: "01224 000000",
      contactEmail: "admin@errolwatsongroup.com",
      brandPrimaryColor: "#157fa8",
    },
    recipientAddress: "Aberdeen",
    issueLine: "Issued 2026-07-15",
    bankDetails: "Bank · Account · 00-00-00 · 12345678",
  });

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.subarray(0, 4).toString("utf8").startsWith("%PDF"));
  assert.ok(pdf.length > 1200);
});

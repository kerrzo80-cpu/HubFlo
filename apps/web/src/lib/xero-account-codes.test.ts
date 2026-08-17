import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeXeroAccountCodes,
  resolvePurchaseAccountCode,
  resolveSalesAccountCode,
  resolveSalesTaxType,
  xeroAccountCodesFromFinanceSettings,
} from "./xero-account-codes";

test("resolveSalesAccountCode uses claim type and CIS before line category", () => {
  const codes = normalizeXeroAccountCodes({
    salesStandard: "200",
    salesLabour: "210",
    salesMaterials: "220",
    salesDeposit: "230",
    salesRetention: "240",
    salesCreditNote: "250",
    salesCis: "260",
  });

  assert.equal(resolveSalesAccountCode({ codes, claimType: "full", lineCategory: "Labour" }), "210");
  assert.equal(resolveSalesAccountCode({ codes, claimType: "full", lineCategory: "Materials" }), "220");
  assert.equal(resolveSalesAccountCode({ codes, claimType: "deposit", lineCategory: "Labour" }), "230");
  assert.equal(resolveSalesAccountCode({ codes, claimType: "retention-release" }), "240");
  assert.equal(resolveSalesAccountCode({ codes, claimType: "credit-note" }), "250");
  assert.equal(resolveSalesAccountCode({ codes, claimType: "full", cis: true }), "260");
  assert.equal(resolveSalesAccountCode({ codes, claimType: "progress-claim" }), "200");
});

test("blank optional codes fall back to standard", () => {
  const codes = normalizeXeroAccountCodes({ salesStandard: "401" });
  assert.equal(resolveSalesAccountCode({ codes, claimType: "deposit", lineCategory: "Labour" }), "401");
  assert.equal(resolvePurchaseAccountCode(codes), "310");
});

test("resolveSalesTaxType uses Setup tax codes and VAT treatment", () => {
  const setup = [
    { name: "Standard 20%", xeroTaxType: "OUTPUT2", rate: 20 },
    { name: "Zero rated", xeroTaxType: "NONE", rate: 0 },
    { name: "Domestic reverse charge", xeroTaxType: "RRCOUTPUT", rate: 0 },
  ];
  assert.equal(resolveSalesTaxType({ vatRate: 20, vatTreatment: "Standard 20%", setupTaxCodes: setup }), "OUTPUT2");
  assert.equal(resolveSalesTaxType({ vatRate: 0, vatTreatment: "Zero rated", setupTaxCodes: setup }), "NONE");
  assert.equal(
    resolveSalesTaxType({ vatRate: 0, vatTreatment: "Domestic reverse charge", setupTaxCodes: setup }),
    "RRCOUTPUT",
  );
});

test("xeroAccountCodesFromFinanceSettings reads nested codes, payment alias and default seeds", () => {
  const codes = xeroAccountCodesFromFinanceSettings({
    xeroPaymentAccountCode: "090",
    xeroAccountCodes: { salesStandard: "200", salesRetention: "241" },
  });
  assert.equal(codes.salesStandard, "200");
  assert.equal(codes.salesRetention, "241");
  assert.equal(codes.paymentBank, "090");
  assert.equal(codes.purchaseBill, "310");
  assert.equal(codes.contractorInvoice, "312");
});

test("retention seed is 630 when not overridden", () => {
  const codes = xeroAccountCodesFromFinanceSettings({});
  assert.equal(codes.salesRetention, "630");
  assert.equal(codes.freight, "429");
  assert.equal(codes.cisTaxSuffered, "821");
});


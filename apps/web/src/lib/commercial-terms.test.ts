import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommercialDiscountToLines,
  applyMainContractorDiscount,
  resolveCommercialTerms,
} from "./commercial-terms";

test("resolveCommercialTerms: site overrides client for CIS, retention, discount, VAT", () => {
  const terms = resolveCommercialTerms(
    {
      vatTreatment: "Standard 20%",
      vatRateOverride: "20",
      cis: false,
      retentionPercent: "5",
      mainContractorDiscountPercent: "2.5",
    },
    {
      vatTreatment: "Domestic reverse charge",
      vatRateOverride: "20",
      cis: true,
      retentionPercent: "3",
      mainContractorDiscountPercent: "1",
    },
  );
  assert.equal(terms.vatTreatment, "Domestic reverse charge");
  assert.equal(terms.cis, true);
  assert.equal(terms.retentionPercent, 3);
  assert.equal(terms.mainContractorDiscountPercent, 1);
  assert.equal(terms.sources.cis, "site");
  assert.equal(terms.sources.retention, "site");
});

test("resolveCommercialTerms: retention cap inherits and site overrides", () => {
  const inherited = resolveCommercialTerms(
    { retentionCapAmount: "10000" },
    {},
  );
  assert.equal(inherited.retentionCapAmount, 10000);
  assert.equal(inherited.sources.retentionCap, "client");

  const overridden = resolveCommercialTerms(
    { retentionCapAmount: "10000" },
    { retentionCapAmount: "15000" },
  );
  assert.equal(overridden.retentionCapAmount, 15000);
  assert.equal(overridden.sources.retentionCap, "site");
});

test("resolveCommercialTerms: blank site inherits client", () => {
  const terms = resolveCommercialTerms(
    {
      vatTreatment: "Zero rated",
      cis: true,
      retentionPercent: "5",
      mainContractorDiscountPercent: "2",
    },
    {
      // no commercial overrides
    },
  );
  assert.equal(terms.vatTreatment, "Zero rated");
  assert.equal(terms.cis, true);
  assert.equal(terms.retentionPercent, 5);
  assert.equal(terms.mainContractorDiscountPercent, 2);
  assert.equal(terms.sources.cis, "client");
});

test("resolveCommercialTerms: site can force CIS off when client is on", () => {
  const terms = resolveCommercialTerms({ cis: true }, { cis: false });
  assert.equal(terms.cis, false);
  assert.equal(terms.sources.cis, "site");
});

test("applyMainContractorDiscount reduces charge", () => {
  const result = applyMainContractorDiscount(1000, 2.5);
  assert.equal(result.discountAmount, 25);
  assert.equal(result.chargeTotal, 975);
});

test("applyCommercialDiscountToLines appends negative line", () => {
  const result = applyCommercialDiscountToLines(
    [
      {
        id: "line-1",
        description: "Work",
        category: "Other",
        costToUs: 100,
        chargeToClient: 1000,
      },
    ],
    1000,
    2.5,
  );
  assert.equal(result.chargeTotal, 975);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[1]?.chargeToClient, -25);
});

test("resolveCommercialTerms: reverse charge VAT is selected from site", () => {
  const terms = resolveCommercialTerms(
    { vatTreatment: "Standard 20%" },
    { vatTreatment: "Domestic reverse charge", vatRateOverride: "20" },
  );
  assert.equal(terms.vatTreatment, "Domestic reverse charge");
  assert.equal(terms.sources.vat, "site");
});

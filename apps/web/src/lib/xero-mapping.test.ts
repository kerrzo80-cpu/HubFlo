import assert from "node:assert/strict";
import test from "node:test";

import {
  matchXeroAccount,
  mergeXeroCostCentreMappings,
  normalizeXeroDefaultAccounts,
  normalizeXeroTaxCodeMappings,
} from "./xero-mapping";

test("seeds simPRO default account codes", () => {
  const defaults = normalizeXeroDefaultAccounts();
  assert.equal(defaults.income.accountCode, "200");
  assert.equal(defaults.income.taxType, "OUTPUT2");
  assert.equal(defaults.expense.accountCode, "310");
  assert.equal(defaults.expense.taxType, "INPUT2");
  assert.equal(defaults.contractorInvoice.accountCode, "312");
  assert.equal(defaults.retentionAsset.accountCode, "630");
  assert.equal(defaults.retentionAsset.accountName, "Retention");
  assert.equal(defaults.freight.accountCode, "429");
  assert.equal(defaults.freight.taxType, "EXEMPTINPUT");
  assert.equal(defaults.cisTaxSuffered.accountCode, "821");
  assert.equal(defaults.cisLiability.accountCode, "826");
  assert.equal(defaults.deposit.accountName, "Petty Cash");
  assert.equal(defaults.deposit.accountCode, "");
  assert.equal(defaults.deposit.taxType, "NONE");
});

test("cost centres seed 200/310 except Membership petty cash", () => {
  const rows = mergeXeroCostCentreMappings(null, ["Bathroom refurbishment"]);
  const bathrooms = rows.find((row) => row.costCentre === "Bathrooms");
  const membership = rows.find((row) => row.costCentre === "Membership");
  const bathroomRefurb = rows.find((row) => row.costCentre === "Bathroom refurbishment");
  assert.equal(bathrooms?.incomeAccountCode, "200");
  assert.equal(bathrooms?.expenseAccountCode, "310");
  assert.equal(bathrooms?.incomeTaxType, "OUTPUT2");
  assert.equal(bathrooms?.expenseTaxType, "INPUT2");
  assert.equal(membership?.incomeAccountName, "Petty Cash");
  assert.equal(membership?.incomeAccountCode, "");
  assert.equal(membership?.expenseTaxType, "NONE");
  assert.equal(bathroomRefurb?.incomeAccountCode, "200");
});

test("tax codes seed VAT EXC DRC income and expense types", () => {
  const rows = normalizeXeroTaxCodeMappings();
  assert.deepEqual(
    rows.map((row) => row.code),
    ["VAT", "EXC", "DRC"],
  );
  assert.equal(rows[0]?.incomeTaxType, "OUTPUT2");
  assert.equal(rows[0]?.expenseTaxType, "INPUT2");
  assert.equal(rows[1]?.incomeTaxType, "ZERORATEDOUTPUT");
  assert.equal(rows[2]?.incomeTaxType, "RRCOUTPUT");
  assert.equal(rows[2]?.expenseTaxType, "RRCINPUT");
});

test("kept office edits win over seeds", () => {
  const defaults = normalizeXeroDefaultAccounts({
    income: { accountCode: "210", accountName: "Sales", taxType: "OUTPUT2" },
  });
  assert.equal(defaults.income.accountCode, "210");
  const rows = mergeXeroCostCentreMappings([
    {
      costCentre: "Bathrooms",
      incomeAccountCode: "201",
      incomeAccountName: "Sales",
      incomeTaxType: "OUTPUT2",
      expenseAccountCode: "310",
      expenseAccountName: "Cost of Goods Sold",
      expenseTaxType: "INPUT2",
    },
  ]);
  assert.equal(rows.find((row) => row.costCentre === "Bathrooms")?.incomeAccountCode, "201");
});

test("matchXeroAccount prefers code then petty-cash name", () => {
  const accounts = [
    { code: "090", name: "Petty Cash", type: "BANK", taxType: "NONE", status: "ACTIVE" },
    { code: "200", name: "Sales", type: "REVENUE", taxType: "OUTPUT2", status: "ACTIVE" },
  ];
  assert.equal(matchXeroAccount({ accountCode: "200", accountName: "Sales" }, accounts)?.code, "200");
  assert.equal(matchXeroAccount({ accountCode: "", accountName: "Petty Cash" }, accounts)?.code, "090");
});

test("superseded first-dump codes move to the current screenshot", () => {
  const defaults = normalizeXeroDefaultAccounts({
    retentionAsset: { accountCode: "502", accountName: "Retentions", taxType: "NONE" },
    freight: { accountCode: "433", accountName: "Postage, Freight & Courier", taxType: "EXEMPTINPUT" },
    cisTaxSuffered: { accountCode: "825", accountName: "CIS Liability", taxType: "NONE" },
  });
  assert.equal(defaults.retentionAsset.accountCode, "630");
  assert.equal(defaults.freight.accountCode, "429");
  assert.equal(defaults.cisTaxSuffered.accountCode, "821");
});

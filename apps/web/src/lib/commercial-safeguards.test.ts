import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertHeatDesignExportable,
  assertMaterialsPricedForPush,
  assertQuotePortalResponseAllowed,
  assertVariationSellValue,
  isPlaceholderBankDetails,
  isPlaceholderCompanyRegistration,
} from "./commercial-safeguards.ts";

test("blocks unpriced commercial materials but allows RFQ", () => {
  assert.ok(
    assertMaterialsPricedForPush([
      { description: "Copper", quantity: 10, unitCost: 0 },
    ]),
  );
  assert.equal(
    assertMaterialsPricedForPush([
      { description: "Valve", quantity: 2, unitCost: 0, supplierRequired: true },
      { description: "Pipe", quantity: 5, unitCost: 12.5 },
    ]),
    null,
  );
});

test("blocks zero-value variation sends", () => {
  assert.ok(assertVariationSellValue(0));
  assert.equal(assertVariationSellValue(150), null);
});

test("quote portal only accepts Sent quotes", () => {
  assert.ok(assertQuotePortalResponseAllowed("Draft"));
  assert.equal(assertQuotePortalResponseAllowed("Sent"), null);
  assert.ok(assertQuotePortalResponseAllowed("Accepted"));
});

test("heat design export hard-fails undersized pumps", () => {
  assert.ok(assertHeatDesignExportable({ coveragePercent: 50, designLoadKw: 20, capacityAtFlowKw: 10 }));
  assert.equal(
    assertHeatDesignExportable({ coveragePercent: 100, designLoadKw: 10, capacityAtFlowKw: 12, emitterShortfallCount: 0 }),
    null,
  );
  assert.equal(
    assertHeatDesignExportable({ coveragePercent: 50, force: true }),
    null,
  );
});

test("placeholder bank and company registration scrubbing", () => {
  assert.equal(isPlaceholderBankDetails({}), true);
  assert.equal(isPlaceholderBankDetails({ sortCode: "00-00-00", accountNumber: "00000000" }), true);
  assert.equal(
    isPlaceholderBankDetails({
      bankName: "Barclays",
      accountName: "EWG Ltd",
      sortCode: "20-00-00",
      accountNumber: "12345678",
    }),
    false,
  );
  assert.equal(isPlaceholderCompanyRegistration({}), true);
  assert.equal(isPlaceholderCompanyRegistration({ vatNumber: "GB000000000", companyNumber: "00000000" }), true);
  assert.equal(isPlaceholderCompanyRegistration({ vatNumber: "GB123456789", companyNumber: "" }), false);
});

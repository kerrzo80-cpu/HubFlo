import assert from "node:assert/strict";
import test from "node:test";

import { checkQuoteConversion } from "./quote-conversion";

test("allows accepted quotes to convert into jobs", () => {
  assert.deepEqual(checkQuoteConversion({ status: "Accepted" }), {
    allowed: true,
  });
});

test("blocks quotes that have not been accepted", () => {
  assert.deepEqual(checkQuoteConversion({ status: "Sent" }), {
    allowed: false,
    code: "QUOTE_NOT_ACCEPTED",
    detail: "Only accepted quotes can be converted into jobs.",
  });
});

test("blocks quotes that are already converted by status", () => {
  assert.deepEqual(checkQuoteConversion({ status: "Converted" }), {
    allowed: false,
    code: "QUOTE_ALREADY_CONVERTED",
    detail: "Converted quotes cannot create another job.",
  });
});

test("blocks quotes that already have a converted job link", () => {
  assert.deepEqual(
    checkQuoteConversion({
      status: "Accepted",
      convertedJobId: "job-123",
    }),
    {
      allowed: false,
      code: "QUOTE_ALREADY_CONVERTED",
      detail: "Converted quotes cannot create another job.",
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  clampDesignExternalTemp,
  isDecimalDraft,
  isSignedDecimalDraft,
  numberFromInput,
} from "./calc-number.ts";

test("isSignedDecimalDraft accepts minus drafts used while typing UK outdoor temps", () => {
  assert.equal(isSignedDecimalDraft(""), true);
  assert.equal(isSignedDecimalDraft("-"), true);
  assert.equal(isSignedDecimalDraft("-5"), true);
  assert.equal(isSignedDecimalDraft("-5.5"), true);
  assert.equal(isSignedDecimalDraft("3"), true);
  assert.equal(isSignedDecimalDraft("--"), false);
  assert.equal(isSignedDecimalDraft("a"), false);
  assert.equal(isDecimalDraft("-5"), false);
});

test("numberFromInput parses leading minus", () => {
  assert.equal(numberFromInput("-5"), -5);
  assert.equal(numberFromInput("-3.5"), -3.5);
});

test("clampDesignExternalTemp keeps UK outdoor design range", () => {
  assert.equal(clampDesignExternalTemp(-5), -5);
  assert.equal(clampDesignExternalTemp(-20), -20);
  assert.equal(clampDesignExternalTemp(-21), -20);
  assert.equal(clampDesignExternalTemp(20), 20);
  assert.equal(clampDesignExternalTemp(21), 20);
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeBusinessSettings } from "./hub-state-merge";

describe("mergeBusinessSettings", () => {
  it("keeps real server VAT when client autosave sends demo placeholder", () => {
    const merged = mergeBusinessSettings(
      { vatNumber: "GB123456789", companyNumber: "SC654321", companyName: "Real Co Ltd" },
      { vatNumber: "GB000000000", companyNumber: "SC000000", companyName: "Real Co Ltd" },
    );
    assert.equal(merged.vatNumber, "GB123456789");
    assert.equal(merged.companyNumber, "SC654321");
  });

  it("accepts intentional client updates when values are not placeholders", () => {
    const merged = mergeBusinessSettings(
      { vatNumber: "GB000000000", phone: "01224 000000" },
      { vatNumber: "GB998877665", phone: "01224 555123", utrNumber: "1234567890" },
    );
    assert.equal(merged.vatNumber, "GB998877665");
    assert.equal(merged.phone, "01224 555123");
    assert.equal(merged.utrNumber, "1234567890");
  });
});

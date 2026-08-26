import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareReferenceDesc, referenceNumber } from "@/lib/numbering";

describe("compareReferenceDesc", () => {
  it("puts the highest number at the top", () => {
    assert.deepEqual(
      ["Q-2001", "Q-2003", "Q-2002"].sort(compareReferenceDesc),
      ["Q-2003", "Q-2002", "Q-2001"],
    );
    assert.deepEqual(
      ["J-1048", "J-1056", "J-1039"].sort(compareReferenceDesc),
      ["J-1056", "J-1048", "J-1039"],
    );
    assert.deepEqual(
      ["INV-3001", "INV-3012", "INV-3005"].sort(compareReferenceDesc),
      ["INV-3012", "INV-3005", "INV-3001"],
    );
  });

  it("reads trailing numbers", () => {
    assert.equal(referenceNumber("PO-1010"), 1010);
  });
});

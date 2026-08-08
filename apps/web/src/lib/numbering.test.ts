import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareReferenceDesc, referenceNumber } from "@/lib/numbering";

describe("compareReferenceDesc", () => {
  it("orders higher reference numbers first", () => {
    const refs = ["L-1001", "L-1003", "L-1002"];
    assert.deepEqual(
      [...refs].sort(compareReferenceDesc),
      ["L-1003", "L-1002", "L-1001"],
    );
  });

  it("reads the trailing number from mixed prefixes", () => {
    assert.equal(referenceNumber("INV-3012"), 3012);
    assert.equal(referenceNumber("PO-1003"), 1003);
    assert.equal(referenceNumber(""), 0);
  });
});

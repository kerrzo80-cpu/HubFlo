import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareNewestRecord, compareReferenceDesc, referenceNumber } from "@/lib/numbering";

describe("compareReferenceDesc", () => {
  it("puts the highest number at the top", () => {
    const refs = ["Q-2001", "Q-2003", "Q-2002"];
    assert.deepEqual(
      [...refs].sort(compareReferenceDesc),
      ["Q-2003", "Q-2002", "Q-2001"],
    );
  });

  it("works for jobs, invoices and POs", () => {
    assert.deepEqual(
      ["J-1048", "J-1056", "J-1039"].sort(compareReferenceDesc),
      ["J-1056", "J-1048", "J-1039"],
    );
    assert.deepEqual(
      ["INV-3001", "INV-3012", "INV-3005"].sort(compareReferenceDesc),
      ["INV-3012", "INV-3005", "INV-3001"],
    );
    assert.deepEqual(
      ["PO-1003", "PO-1010", "PO-1001"].sort(compareReferenceDesc),
      ["PO-1010", "PO-1003", "PO-1001"],
    );
  });

  it("reads the trailing number from mixed prefixes", () => {
    assert.equal(referenceNumber("INV-3012"), 3012);
    assert.equal(referenceNumber("PO-1003"), 1003);
  });
});

describe("compareNewestRecord", () => {
  it("is highest-number-first for directory rows", () => {
    const rows = [
      { ref: "Q-2001", externalId: "900" },
      { ref: "Q-2003", externalId: "100" },
      { ref: "Q-2002", externalId: "500" },
    ];
    assert.deepEqual(
      [...rows].sort(compareNewestRecord).map((row) => row.ref),
      ["Q-2003", "Q-2002", "Q-2001"],
    );
  });
});

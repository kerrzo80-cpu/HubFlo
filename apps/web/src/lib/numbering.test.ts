import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareNewestRecord,
  compareReferenceDesc,
  referenceNumber,
  sortableDateValue,
} from "@/lib/numbering";

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

describe("compareNewestRecord", () => {
  it("prefers newer ISO dates over reference order", () => {
    const rows = [
      { ref: "Q-2100", date: "2026-01-01", externalId: "10" },
      { ref: "Q-2001", date: "2026-08-01", externalId: "11" },
    ];
    assert.deepEqual(
      [...rows].sort(compareNewestRecord).map((row) => row.ref),
      ["Q-2001", "Q-2100"],
    );
  });

  it("uses higher external/simPRO ids when NeXa refs were assigned import-first", () => {
    const rows = [
      { ref: "Q-2001", externalId: "900" }, // newest simPRO, imported first → low NeXa ref
      { ref: "Q-2003", externalId: "100" },
      { ref: "Q-2002", externalId: "500" },
    ];
    assert.deepEqual(
      [...rows].sort(compareNewestRecord).map((row) => row.ref),
      ["Q-2001", "Q-2002", "Q-2003"],
    );
  });

  it("parses day-month-year timestamps", () => {
    assert.ok(sortableDateValue("08 Aug 2026 21:30"));
    assert.equal(sortableDateValue("Today"), null);
  });
});

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
  it("puts newest simPRO imports first by ascending NeXa ref", () => {
    const rows = [
      { ref: "Q-2003", externalId: "100" }, // oldest business, imported last / highest ref
      { ref: "Q-2001", externalId: "900" }, // newest business, imported first / lowest ref
      { ref: "Q-2002", externalId: "500" },
    ];
    assert.deepEqual(
      [...rows].sort(compareNewestRecord).map((row) => row.ref),
      ["Q-2001", "Q-2002", "Q-2003"],
    );
  });

  it("still uses ascending NeXa refs when external ids are non-numeric", () => {
    const rows = [
      { ref: "Q-2003", externalId: "x" },
      { ref: "Q-2001", externalId: "y" },
      { ref: "Q-2002", externalId: "z" },
    ];
    assert.deepEqual(
      [...rows].sort(compareNewestRecord).map((row) => row.ref),
      ["Q-2001", "Q-2002", "Q-2003"],
    );
  });

  it("keeps native in-app rows newest-ref-first like leads", () => {
    const rows = [
      { ref: "Q-2101" },
      { ref: "Q-2103" },
      { ref: "Q-2102" },
    ];
    assert.deepEqual(
      [...rows].sort(compareNewestRecord).map((row) => row.ref),
      ["Q-2103", "Q-2102", "Q-2101"],
    );
  });

  it("puts a new local row above historical imports", () => {
    const rows = [
      { ref: "Q-2001", externalId: "900" },
      { ref: "Q-2100" },
    ];
    assert.equal([...rows].sort(compareNewestRecord)[0]?.ref, "Q-2100");
  });

  it("prefers newer issued dates for invoices", () => {
    const rows = [
      { ref: "INV-1", date: "2026-01-01", externalId: "10" },
      { ref: "INV-2", date: "2026-08-01", externalId: "11" },
    ];
    assert.equal([...rows].sort(compareNewestRecord)[0]?.ref, "INV-2");
  });

  it("keeps YYYY-MM-DD dates timezone stable", () => {
    assert.equal(sortableDateValue("2026-06-30"), "2026-06-30T00:00:00.000Z");
    assert.equal(sortableDateValue("Today"), null);
  });
});

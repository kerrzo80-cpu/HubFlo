import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeBoqTotal, parseBoqDelimitedText } from "@/lib/tenders-data";

describe("tenders-data BoQ parse", () => {
  it("parses measured lines and section headers from CSV", () => {
    const csv = [
      "Plumbing e-Enquiry [Harlaw]",
      "Ref,Description,Quantity,Units,Rate,Value",
      ",SANITARY APPLIANCES,,,," ,
      "8/1/A,Doc M Toilet Pack,1,nr,1836,1836",
      "8/1/B,Washbasin,4,nr,359,1436",
      "14/1/d,Compressed air removal,1,ITEM,,",
    ].join("\n");

    const parsed = parseBoqDelimitedText(csv);
    assert.equal(parsed.title, "Plumbing e-Enquiry [Harlaw]");
    assert.equal(parsed.lines[0]?.kind, "header");
    assert.equal(parsed.lines[0]?.section, "SANITARY APPLIANCES");
    assert.equal(parsed.lines[1]?.ref, "8/1/A");
    assert.equal(parsed.lines[1]?.section, "SANITARY APPLIANCES");
    assert.equal(parsed.lines[1]?.rate, 1836);
    assert.equal(parsed.lines[3]?.ref, "14/1/d");
    assert.equal(parsed.lines[3]?.rate, null);
    assert.equal(parsed.lines[3]?.value, null);
    assert.equal(computeBoqTotal(parsed.lines), 3272);
  });
});

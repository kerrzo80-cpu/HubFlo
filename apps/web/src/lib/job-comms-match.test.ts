import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractJobRefForTest } from "./job-comms-match";

describe("job inbound matching helpers", () => {
  it("extracts job refs from subjects", () => {
    assert.equal(extractJobRefForTest("Re: JOB-1042 site visit"), "JOB-1042");
    assert.equal(extractJobRefForTest("About J-880 tomorrow"), "J-880");
    assert.equal(extractJobRefForTest("Hello there"), "");
  });
});

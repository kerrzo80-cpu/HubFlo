import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { operatorCapabilities } from "@/lib/blake-core/operator-capabilities";
import { looksLikeBlakeWriteRequest } from "@/lib/blake-write-operator";

describe("Blake write operator routing", () => {
  it("recognises natural create and update requests", () => {
    assert.equal(looksLikeBlakeWriteRequest("Create a quote for Test Test called Test Quote for £1,500"), true);
    assert.equal(looksLikeBlakeWriteRequest("Make a new job for John Smith at 17 Hillside Drive"), true);
    assert.equal(looksLikeBlakeWriteRequest("Change Q-1042 value to £4,500"), true);
    assert.equal(looksLikeBlakeWriteRequest("Update J-1007 manager to Murray Skinner"), true);
  });

  it("does not hijack informational how-to questions", () => {
    assert.equal(looksLikeBlakeWriteRequest("How do I create a quote in NeXa?"), false);
    assert.equal(looksLikeBlakeWriteRequest("Show me how to edit a job"), false);
  });

  it("registers the first quote and job write capabilities", () => {
    assert.deepEqual(
      operatorCapabilities.map((item) => item.definition.name),
      ["create_quote", "update_quote", "create_job", "update_job"],
    );
    assert.ok(operatorCapabilities.every((item) => item.definition.mode === "write"));
    assert.ok(operatorCapabilities.every((item) => item.definition.requiresConfirmation === true));
  });
});

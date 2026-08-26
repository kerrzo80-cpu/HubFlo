import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  takeoffDrawingDisplayLabel,
  takeoffHouseTypeNote,
  takeoffSourceFolderLabel,
  takeoffSourceTenderDocId,
  withHouseTypeNote,
  withSourceFolderNote,
} from "@/lib/takeoff-drawing-labels";

describe("takeoff drawing labels", () => {
  it("reads source tender doc + folder tags from notes", () => {
    const notes = [
      "Copied from tender drawings on Send to Takeoff.",
      "sourceTenderDoc:doc-1",
      "sourceFolder:Heating",
    ];
    assert.equal(takeoffSourceTenderDocId(notes), "doc-1");
    assert.equal(takeoffSourceFolderLabel(notes), "Heating");
    assert.equal(takeoffDrawingDisplayLabel("plan.pdf", notes), "Heating / plan.pdf");
  });

  it("upserts folder labels without duplicating the tag", () => {
    const once = withSourceFolderNote(["sourceTenderDoc:x"], "Hot & cold");
    assert.deepEqual(once, ["sourceTenderDoc:x", "sourceFolder:Hot & cold"]);
    const twice = withSourceFolderNote(once, "Gas");
    assert.deepEqual(twice, ["sourceTenderDoc:x", "sourceFolder:Gas"]);
  });

  it("stores house-type folder assignments", () => {
    const notes = withHouseTypeNote(["sourceTenderDoc:doc-1"], "House Type A");
    assert.equal(takeoffHouseTypeNote(notes), "House Type A");
    const cleared = withHouseTypeNote(notes, "Ungrouped");
    assert.equal(takeoffHouseTypeNote(cleared), undefined);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  takeoffDrawingDisplayLabel,
  takeoffHouseTypeLabel,
  takeoffSourceFolderLabel,
  takeoffSourceTenderDocId,
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

  it("uses the top-level folder as the house-type tab", () => {
    assert.equal(takeoffHouseTypeLabel(["sourceFolder:Belerno"]), "Belerno");
    assert.equal(takeoffHouseTypeLabel(["sourceFolder:Belerno / Hot & cold"]), "Belerno");
    assert.equal(takeoffHouseTypeLabel(["sourceFolder:Drawings"]), "Unassigned");
    assert.equal(takeoffHouseTypeLabel([]), "Unassigned");
  });
});

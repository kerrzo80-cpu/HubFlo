import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignDrawingHouseType,
  extractHouseTypeToken,
  groupTakeoffDrawings,
  inferDrawingFolderMeta,
  inferSharedHouseTypePrefix,
  UNGROUPED_HOUSE_TYPE,
} from "@/lib/takeoff-drawing-folders";
import { takeoffHouseTypeNote } from "@/lib/takeoff-drawing-labels";

describe("takeoff drawing folders", () => {
  it("splits tender folder path into house type and discipline", () => {
    const meta = inferDrawingFolderMeta({
      id: "d1",
      fileName: "plan.pdf",
      notes: ["sourceFolder:House type 1 / Heating"],
    });
    assert.equal(meta.houseType, "House Type 1");
    assert.equal(meta.discipline, "Heating");
  });

  it("groups by house type then discipline", () => {
    const folders = groupTakeoffDrawings([
      { id: "a", fileName: "a.pdf", notes: ["sourceFolder:House type 1 / Heating"] },
      { id: "b", fileName: "b.pdf", notes: ["sourceFolder:House type 1 / Gas"] },
      { id: "c", fileName: "c.pdf", notes: ["sourceFolder:House type 2 / Heating"] },
    ]);
    assert.equal(folders.length, 2);
    assert.equal(folders[0]!.label, "House Type 1");
    assert.equal(folders[0]!.disciplines.length, 2);
    assert.equal(folders[1]!.label, "House Type 2");
  });

  it("parses HT-12 and shared filename prefixes", () => {
    assert.equal(extractHouseTypeToken("HT-12 heating layout.pdf"), "HT-12");
    assert.equal(
      inferSharedHouseTypePrefix("House Type A - ground.pdf", [
        "House Type A - ground.pdf",
        "House Type A - first.pdf",
      ]),
      "House Type A",
    );
  });

  it("stores manual house-type assignment on notes", () => {
    const docs = assignDrawingHouseType(
      [{ id: "x", fileName: "misc.pdf", notes: [] }],
      "x",
      "House Type C",
    );
    assert.equal(takeoffHouseTypeNote(docs[0]!.notes), "House Type C");
    const meta = inferDrawingFolderMeta(docs[0]!);
    assert.equal(meta.houseType, "House Type C");
    assert.equal(meta.assigned, true);
  });

  it("puts unmatched drawings in Ungrouped", () => {
    const folders = groupTakeoffDrawings([{ id: "z", fileName: "plan.pdf", notes: [] }]);
    assert.equal(folders.length, 1);
    assert.equal(folders[0]!.label, UNGROUPED_HOUSE_TYPE);
  });
});

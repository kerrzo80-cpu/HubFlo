import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveTenderDocumentFolderKind,
  tenderDocumentFolderDepth,
  tenderDocumentFolderPathLabel,
  tenderDrawingSetLabel,
  type TenderDocumentFolder,
} from "@/lib/tender-document-folders";

describe("tender document folders", () => {
  const folders: TenderDocumentFolder[] = [
    { id: "f-arch", name: "Architect", parentId: "drawing" },
    { id: "f-heat", name: "Heating", parentId: "drawing" },
    { id: "f-heat-iso", name: "Isometrics", parentId: "f-heat" },
  ];

  it("resolves built-in kinds for nested folders", () => {
    assert.equal(resolveTenderDocumentFolderKind(folders, "f-arch"), "drawing");
    assert.equal(resolveTenderDocumentFolderKind(folders, "f-heat-iso"), "drawing");
    assert.equal(resolveTenderDocumentFolderKind(folders, "drawing"), "drawing");
  });

  it("measures nesting depth under a kind", () => {
    assert.equal(tenderDocumentFolderDepth(folders, "f-arch"), 1);
    assert.equal(tenderDocumentFolderDepth(folders, "f-heat-iso"), 2);
  });

  it("builds path labels", () => {
    assert.equal(
      tenderDocumentFolderPathLabel(folders, "f-heat-iso", { drawing: "Drawings" }),
      "Drawings / Heating / Isometrics",
    );
  });

  it("builds takeoff drawing-set labels without the Drawings kind prefix", () => {
    assert.equal(tenderDrawingSetLabel(folders, null), "Drawings");
    assert.equal(tenderDrawingSetLabel(folders, "drawing"), "Drawings");
    assert.equal(tenderDrawingSetLabel(folders, "f-heat"), "Heating");
    assert.equal(tenderDrawingSetLabel(folders, "f-heat-iso"), "Heating / Isometrics");
  });
});

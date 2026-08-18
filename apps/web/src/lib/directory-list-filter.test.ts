import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  directoryFirstName,
  directoryLetterOf,
  filterDirectoryList,
  matchesDirectoryLetter,
  sortByDirectoryFirstName,
} from "@/lib/directory-list-filter";

describe("directory list filter", () => {
  it("uses first-name token and comma form", () => {
    assert.equal(directoryFirstName("Alice Brown"), "Alice");
    assert.equal(directoryFirstName("Brown, Alice"), "Alice");
    assert.equal(directoryLetterOf("Alice Brown"), "A");
    assert.equal(directoryLetterOf("123 Supplies"), "#");
  });

  it("filters by letter and sorts first-name first", () => {
    const rows = [
      { name: "Zane Parks" },
      { name: "Alice Brown" },
      { name: "Adam Cole" },
      { name: "Ben Adams" },
    ];
    const aOnly = filterDirectoryList(rows, { getName: (row) => row.name, letter: "A" });
    assert.deepEqual(
      aOnly.map((row) => row.name),
      ["Adam Cole", "Alice Brown"],
    );
    assert.equal(matchesDirectoryLetter("Ben Adams", "B"), true);
    assert.deepEqual(
      sortByDirectoryFirstName(rows, (row) => row.name).map((row) => row.name),
      ["Adam Cole", "Alice Brown", "Ben Adams", "Zane Parks"],
    );
  });
});

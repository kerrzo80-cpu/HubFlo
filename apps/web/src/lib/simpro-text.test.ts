import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { looksLikeHtml, simproPlainDescription, stripSimproHtml } from "@/lib/simpro-text";

describe("simpro text sanitise", () => {
  it("strips HTML email gibberish into readable plain text", () => {
    const raw =
      '<div style="font-size: 10pt;">Hi Lesley&nbsp;</div><div style="font-size: 10pt;">&nbsp;</div><div style="font-size: 10pt;">We have amended the quote below; this is now based on the Baxi boiler.</div>';
    const plain = stripSimproHtml(raw);
    assert.equal(looksLikeHtml(raw), true);
    assert.equal(looksLikeHtml(plain), false);
    assert.match(plain, /Hi Lesley/);
    assert.match(plain, /Baxi boiler/);
    assert.doesNotMatch(plain, /font-size|nbsp|&nbsp;|<div/i);
  });

  it("prefers a short title over a long HTML description body", () => {
    const description = simproPlainDescription(
      {
        title: "Baxi boiler amendment — kitchen",
        body: '<div style="font-size: 10pt;">Hi Lesley&nbsp;</div>'.repeat(8) + " long email about worktops and boilers",
      },
      "Imported simPRO quote",
    );
    assert.equal(description, "Baxi boiler amendment — kitchen");
  });

  it("falls back to stripped body when title is missing", () => {
    const description = simproPlainDescription(
      {
        body: "<p>Replace bathroom suite&nbsp;and extract fan</p>",
      },
      "Imported simPRO quote",
    );
    assert.equal(description, "Replace bathroom suite and extract fan");
  });
});

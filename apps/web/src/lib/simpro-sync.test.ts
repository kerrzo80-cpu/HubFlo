import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildJobInput,
  buildQuoteInput,
  isPlaceholderSimproValue,
  isUsableEmailForMatch,
  processClient,
  processSite,
} from "@/lib/simpro-sync";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "simpro-fixtures");

describe("simpro sync preview quality", () => {
  it("treats To confirm style values as placeholders, not match keys", () => {
    assert.equal(isPlaceholderSimproValue("To confirm"), true);
    assert.equal(isPlaceholderSimproValue("Address to confirm"), true);
    assert.equal(isPlaceholderSimproValue("donna@northfieldproperties.co.uk"), false);
    assert.equal(isUsableEmailForMatch("To confirm"), false);
    assert.equal(isUsableEmailForMatch("accounts@morrisonco.com"), true);
  });

  it("maps nested Total.ExTax so quote/job values are not blank", () => {
    const header = JSON.parse(readFileSync(join(fixtureDir, "sample-job-header.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const quote = buildQuoteInput(header);
    const job = buildJobInput(header);
    assert.equal(quote.value, 1200);
    assert.equal(job.value, 1200);
    assert.equal(quote.customer, "Example Customer Ltd");
    assert.equal(job.customer, "Example Customer Ltd");
    assert.match(quote.description, /Replace bathroom suite|Sample Job/);
  });

  it("does not conflict-match customers solely on placeholder email", () => {
    const first = processClient(
      {
        ID: 9001,
        CompanyName: "Unique Plumbing Imports Ltd",
        Email: "To confirm",
        Phone: "To confirm",
      },
      "preview",
    );
    const second = processClient(
      {
        ID: 9002,
        CompanyName: "Another Fresh Import Co",
        Email: "To confirm",
        Phone: "To confirm",
        Address: "12 Test Street, Aberdeen",
      },
      "preview",
    );

    assert.equal(first.action, "create");
    assert.equal(second.action, "create");
    assert.notEqual(first.action, "conflict");
    assert.notEqual(second.action, "conflict");
    assert.match(first.summary, /Missing on simPRO record: email/);
  });

  it("previews sites as create when customer is not linked yet but Customer.ID exists", () => {
    const op = processSite(
      {
        ID: 501,
        Name: "Main site",
        Customer: { ID: 55, CompanyName: "Example Customer Ltd" },
        Address: { Address: "1 High Street", City: "Aberdeen", PostalCode: "AB10 1AA" },
      },
      "preview",
    );
    assert.equal(op.action, "create");
    assert.match(op.summary, /after customer Example Customer Ltd/);
    assert.notEqual(op.action, "conflict");
  });

  it("still conflicts when a site has no customer id at all", () => {
    const op = processSite(
      {
        ID: 777,
        Name: "Orphan site",
        Address: "Somewhere",
      },
      "preview",
    );
    assert.equal(op.action, "conflict");
    assert.match(op.summary, /customer is linked/i);
  });
});

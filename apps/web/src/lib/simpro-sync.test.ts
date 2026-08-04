import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildJobInput,
  buildQuoteInput,
  isImportableSimproJob,
  isOpenSimproQuote,
  isPlaceholderSimproValue,
  isUnpaidSimproInvoice,
  isUsableEmailForMatch,
  jobStatusFromSimpro,
  processClient,
  processSite,
  scopeSimproRecords,
} from "@/lib/simpro-sync";
import { mergeHubDetailState } from "@/lib/hub-state-merge";

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
    assert.equal(job.status, "Completed");
    assert.equal(job.site, "Main site");
  });

  it("maps simPRO job statuses onto NeXa folder statuses", () => {
    assert.equal(jobStatusFromSimpro("Complete"), "Completed");
    assert.equal(jobStatusFromSimpro("Progress"), "In progress");
    assert.equal(jobStatusFromSimpro("Scheduled"), "Scheduled");
    assert.equal(jobStatusFromSimpro("Imported"), "Pending");
    assert.equal(jobStatusFromSimpro(""), "Pending");
  });

  it("exposes clearSimproLinksForNexaRecord for delete/re-import", async () => {
    const { clearSimproLinksForNexaRecord } = await import("@/lib/simpro-sync");
    assert.equal(typeof clearSimproLinksForNexaRecord, "function");
    const result = clearSimproLinksForNexaRecord("jobs", "missing-nexa-id");
    assert.equal(result.syncLinksRemoved, 0);
  });

  it("scopes import to open quotes, live jobs, and latest unpaid invoices", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "simpro-sync.ts"), "utf8");
    assert.match(source, /SIMPRO_INVOICE_IMPORT_LIMIT = 30/);
    assert.match(source, /IsPaid/);
    assert.match(source, /isOpenSimproQuote/);

    assert.equal(isOpenSimproQuote({ Status: { Name: "Quote Sent" } }), true);
    assert.equal(isOpenSimproQuote({ Status: { Name: "Lost" } }), false);
    assert.equal(isOpenSimproQuote({ Stage: "Complete" }), false);
    assert.equal(isOpenSimproQuote({ Archived: true, Status: { Name: "Draft" } }), false);

    assert.equal(isImportableSimproJob({ Stage: "Pending" }), true);
    assert.equal(isImportableSimproJob({ Stage: "Progress" }), true);
    assert.equal(isImportableSimproJob({ Status: { Name: "Complete" } }), true);
    assert.equal(isImportableSimproJob({ Stage: "Invoiced" }), false);
    assert.equal(isImportableSimproJob({ Stage: "Archived" }), false);

    assert.equal(isUnpaidSimproInvoice({ IsPaid: false, Status: { Name: "Sent" } }), true);
    assert.equal(isUnpaidSimproInvoice({ IsPaid: true }), false);
    assert.equal(isUnpaidSimproInvoice({ IsVoided: true }), false);

    const invoices = scopeSimproRecords("invoices", [
      { ID: 1, IsPaid: false, DateIssued: "2026-01-01", InvoiceNo: "OLD" },
      { ID: 2, IsPaid: true, DateIssued: "2026-07-01", InvoiceNo: "PAID" },
      { ID: 3, IsPaid: false, DateIssued: "2026-07-20", InvoiceNo: "NEW" },
    ]);
    assert.equal(invoices.length, 2);
    assert.equal(invoices[0]?.ID, 3);
  });

  it("keeps richer server quote cost centres when the browser sends an empty map", () => {
    const merged = mergeHubDetailState(
      {
        quoteCostCentres: {
          "quote-1": [{ id: "cc-1", name: "First fix", clientDescription: "Client brief", engineerDescription: "Engineer brief", lines: [] }],
        },
        jobSchedulePlans: {
          "job-1": [{ id: "sched-1", employeeName: "Alex" }],
        },
      },
      {
        quoteCostCentres: {},
        jobSchedulePlans: {},
      },
    );
    assert.equal((merged.quoteCostCentres as Record<string, unknown[]>)["quote-1"]?.length, 1);
    assert.equal((merged.jobSchedulePlans as Record<string, unknown[]>)["job-1"]?.length, 1);
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

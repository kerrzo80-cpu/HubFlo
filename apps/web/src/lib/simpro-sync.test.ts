import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  billingAddressFromRecord,
  buildJobInput,
  buildQuoteInput,
  isImportableSimproJob,
  isOpenSimproQuote,
  isPlaceholderSimproValue,
  isUnpaidSimproInvoice,
  isUsableEmailForMatch,
  jobStatusFromSimpro,
  preferNexaJobWorkflowStatus,
  processClient,
  processSite,
  scopeSimproRecords,
  siteAddressFromRecord,
  SIMPRO_CLIENT_IMPORT_LIMIT,
  SIMPRO_DEEP_HIERARCHY_LIMIT,
  SIMPRO_JOB_IMPORT_LIMIT,
  SIMPRO_QUOTE_IMPORT_LIMIT,
  SIMPRO_SITE_IMPORT_LIMIT,
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

  it("prefers a positive Total.ExTax and skips zero placeholders", () => {
    const quote = buildQuoteInput({
      ID: 2217,
      Name: "Aberbuild works",
      Customer: { CompanyName: "Aberbuild" },
      Total: { ExTax: 0, IncTax: 4537.48 },
    });
    assert.equal(quote.value, 4537.48);
    const quoteEx = buildQuoteInput({
      ID: 2218,
      Name: "Aberbuild works",
      Customer: { CompanyName: "Aberbuild" },
      Total: { ExTax: 4537.48, Tax: 907.5, IncTax: 5444.98 },
    });
    assert.equal(quoteEx.value, 4537.48);
  });

  it("maps simPRO job statuses onto NeXa folder statuses", () => {
    assert.equal(jobStatusFromSimpro("Complete"), "Completed");
    assert.equal(jobStatusFromSimpro("Progress"), "In progress");
    assert.equal(jobStatusFromSimpro("Scheduled"), "Scheduled");
    assert.equal(jobStatusFromSimpro("Imported"), "Pending");
    assert.equal(jobStatusFromSimpro(""), "Pending");
  });

  it("keeps Ready to invoice when simPRO still reports Complete", () => {
    assert.equal(preferNexaJobWorkflowStatus("Ready to invoice", "Completed"), "Ready to invoice");
    assert.equal(preferNexaJobWorkflowStatus("Invoiced", "Completed"), "Invoiced");
    assert.equal(preferNexaJobWorkflowStatus("Completed", "Ready to invoice"), "Ready to invoice");
    assert.equal(preferNexaJobWorkflowStatus("In progress", "Completed"), "Completed");
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
    assert.match(source, /SIMPRO_QUOTE_IMPORT_LIMIT = 30/);
    assert.match(source, /SIMPRO_JOB_IMPORT_LIMIT = 80/);
    assert.match(source, /SIMPRO_SITE_IMPORT_LIMIT = 80/);
    assert.match(source, /SIMPRO_CLIENT_IMPORT_LIMIT = 80/);
    assert.match(source, /SIMPRO_DEEP_HIERARCHY_LIMIT = 80/);
    assert.match(source, /IsPaid/);
    assert.match(source, /isOpenSimproQuote/);
    assert.match(source, /hydrateCustomersForRecords/);
    assert.match(source, /hydrateSitesForRecords/);
    assert.match(source, /return clone\(persisted\)/);
    assert.equal(SIMPRO_QUOTE_IMPORT_LIMIT, 30);
    assert.equal(SIMPRO_JOB_IMPORT_LIMIT, 80);
    assert.equal(SIMPRO_DEEP_HIERARCHY_LIMIT, 80);

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

    const quotes = scopeSimproRecords(
      "quotes",
      Array.from({ length: 60 }, (_, index) => ({
        ID: index + 1,
        Status: { Name: "Quote Sent" },
        DateModified: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
      })),
    );
    assert.equal(quotes.length, SIMPRO_QUOTE_IMPORT_LIMIT);

    const jobs = scopeSimproRecords(
      "jobs",
      Array.from({ length: 100 }, (_, index) => ({
        ID: index + 1,
        Stage: "Pending",
        DateModified: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
      })),
    );
    assert.equal(jobs.length, SIMPRO_JOB_IMPORT_LIMIT);

    const sites = scopeSimproRecords(
      "sites",
      Array.from({ length: 120 }, (_, index) => ({
        ID: index + 1,
        Name: `Site ${index + 1}`,
        DateModified: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
      })),
    );
    assert.equal(sites.length, SIMPRO_SITE_IMPORT_LIMIT);
    assert.equal(SIMPRO_CLIENT_IMPORT_LIMIT, 80);
  });

  it("never labels quotes/jobs as literal simPRO customer when a real name or id exists", () => {
    const named = buildQuoteInput({
      ID: 1,
      Description: "Bathroom",
      Customer: { ID: 55, CompanyName: "Morrison Co" },
      Total: { ExTax: 100 },
    });
    assert.equal(named.customer, "Morrison Co");

    const idOnly = buildQuoteInput({
      ID: 2,
      Description: "Boiler",
      Customer: { ID: 88 },
      Total: { ExTax: 50 },
    });
    assert.equal(idOnly.customer, "Customer 88");
    assert.notEqual(idOnly.customer.toLowerCase(), "simpro customer");

    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "simpro-sync.ts"), "utf8");
    assert.match(source, /hydrateCustomersForRecords/);
    assert.match(source, /hydrateSitesForRecords/);
    assert.match(source, /fetchSimproCustomerDetail/);
    assert.match(source, /fetchSimproSiteDetail/);
    assert.match(source, /fallbackCustomerLabel/);
    assert.match(source, /siteAddressFromRecord/);
  });

  it("does not reuse customer billing as the site address for every quote", () => {
    const billing = {
      Address: "4 Forvie Terrace",
      City: "Bridge Of Don",
      State: "Aberdeenshire",
      PostalCode: "AB22 8TH",
    };
    const quoteA = {
      ID: 2022,
      Name: "Baxi boiler amendment",
      Description:
        '<div style="font-size: 10pt;">Hi Lesley&nbsp;</div><div>We have amended the quote below; this is now based on the Baxi boiler</div>',
      Customer: { ID: 12, CompanyName: "Lesley Customer", BillingAddress: billing },
      BillingAddress: billing,
      Site: { ID: 401 },
      Total: { ExTax: 28503 },
      Status: { Name: "Draft" },
    };
    const quoteB = {
      ID: 2033,
      Name: "Kitchen extract fan",
      Description: "Imported notes",
      Customer: { ID: 12, CompanyName: "Lesley Customer", BillingAddress: billing },
      BillingAddress: billing,
      Site: {
        ID: 402,
        Name: "Other site",
        Address: { Address: "18 King Street", City: "Aberdeen", PostalCode: "AB24 5AA" },
      },
      Total: { ExTax: 4537 },
      Status: { Name: "Draft" },
    };

    assert.equal(siteAddressFromRecord(quoteA), "");
    assert.equal(billingAddressFromRecord(quoteA), "4 Forvie Terrace, Bridge Of Don, Aberdeenshire, AB22 8TH");
    assert.equal(siteAddressFromRecord(quoteB), "18 King Street, Aberdeen, AB24 5AA");
    assert.notEqual(siteAddressFromRecord(quoteB), billingAddressFromRecord(quoteA));

    const mappedA = buildQuoteInput(quoteA);
    const mappedB = buildQuoteInput(quoteB);
    assert.equal(mappedA.description, "Baxi boiler amendment");
    assert.doesNotMatch(mappedA.description, /<div|font-size|&nbsp;/i);
    assert.equal(mappedB.description, "Kitchen extract fan");
    assert.equal(mappedA.next, "Review imported quote");

    // Bare numeric Customer/Site IDs must still resolve (list payloads often look like this).
    const bareIds = buildQuoteInput({
      ID: 3952,
      Name: "Wall removal quote",
      Description: "Hi Lesley We have amended the quote below, this is now based on the Baxi boiler",
      Customer: 991,
      Site: 402,
      Total: { ExTax: 100 },
      Status: { Name: "Draft" },
    });
    assert.equal(bareIds.customer, "Customer 991");
    assert.notEqual(bareIds.customer, "Customer to confirm");
    assert.equal(bareIds.description, "Wall removal quote");
    assert.ok(bareIds.description.length <= 72);

    const emailOnly = buildQuoteInput({
      ID: 2002,
      Description: "Hi Lesley We have amended the quote below, this is now based on the Baxi boiler",
      Total: { ExTax: 28545 },
      Status: { Name: "Draft" },
    });
    assert.equal(emailOnly.description, "Quote 2002");
    assert.doesNotMatch(emailOnly.description, /^Hi Lesley/i);

    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "simpro-sync.ts"), "utf8");
    assert.match(source, /hydrateQuoteOrJobRecordForImport/);
    assert.match(source, /fetchSimproEntityDetail/);
    assert.match(source, /simproGetEntityDetail/);
    assert.match(source, /never poison the Apply run with a cached null/i);
    assert.doesNotMatch(
      source.slice(source.indexOf("async function fetchSimproEntityDetail"), source.indexOf("function mergeEntityDetailOntoRecord")),
      /entityDetailCache\.set\(cacheKey, null\)/,
    );

    const deepSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "simpro-deep-import.ts"), "utf8");
    assert.match(deepSource, /export async function fetchFullEntity/);
    assert.match(deepSource, /Ignore thin\/incomplete prefetch/);
    assert.match(deepSource, /simproGetEntityDetail/);
    assert.match(deepSource, /if \(!hasCustomer && !hasSite\)/);

    const clientSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "simpro-client.ts"), "utf8");
    assert.match(clientSource, /export async function simproGetEntityDetail/);
    assert.match(clientSource, /simproEntityDetailPaths/);
    assert.match(clientSource, /listSimproCompanyIds/);
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

  it("keeps richer imported quote lines when a stale browser tab sends empty lines", () => {
    const merged = mergeHubDetailState(
      {
        quoteCostCentres: {
          "quote-1": [
            {
              id: "cc-1",
              name: "First fix",
              clientDescription: "Full client brief from simPRO",
              lines: [{ id: "l1", description: "Copper", quantity: 2 }],
            },
          ],
        },
      },
      {
        quoteCostCentres: {
          "quote-1": [{ id: "cc-1", name: "First fix", clientDescription: "", lines: [] }],
        },
      },
    );
    const centre = (merged.quoteCostCentres as Record<string, Array<Record<string, unknown>>>)["quote-1"]?.[0];
    assert.equal((centre?.lines as unknown[])?.length, 1);
    assert.match(String(centre?.clientDescription || ""), /Full client brief/);
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

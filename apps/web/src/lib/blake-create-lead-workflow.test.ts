import assert from "node:assert/strict";
import test from "node:test";

import { isLeadWorkflowReply, locallyExtractLeadData } from "./blake-create-lead-workflow";

test("lead workflow retains labelled details when AI extraction is unavailable", () => {
  const result = locallyExtractLeadData(
    "Customer: North Test Ltd, Address: 14 Union Street, Town: Aberdeen, Postcode: AB10 1AA, Enquiry: Boiler repair, Source: Phone call",
    {},
  );

  assert.deepEqual(result, {
    customerName: "North Test Ltd",
    addressLine1: "14 Union Street",
    town: "Aberdeen",
    postcode: "AB10 1AA",
    description: "Boiler repair",
    source: "Phone call",
  });
});

test("an unfinished lead never hijacks an unrelated NeXa question", () => {
  assert.equal(isLeadWorkflowReply("what jobs have tight margins?", "collecting_information"), false);
  assert.equal(isLeadWorkflowReply("show me overdue invoices", "collecting_information"), false);
  assert.equal(isLeadWorkflowReply("that's wrong, sections are areas of work and cost centres sit within sections", "collecting_information"), false);
  assert.equal(isLeadWorkflowReply("Customer: Murray Ltd", "collecting_information"), true);
  assert.equal(isLeadWorkflowReply("cancel that", "collecting_information"), true);
});

test("lead workflow preserves existing values and extracts contact details", () => {
  const result = locallyExtractLeadData(
    "Email is office@example.com and telephone 01224 123456",
    { customerName: "Existing customer" },
  );

  assert.equal(result.customerName, "Existing customer");
  assert.equal(result.email, "office@example.com");
  assert.equal(result.phone, "01224 123456");
});

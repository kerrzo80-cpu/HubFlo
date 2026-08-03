import assert from "node:assert/strict";
import test from "node:test";

import {
  safeMissingFieldAccess,
  sanitizeSimproPayload,
  summarizeSimproShape,
} from "./simpro-sanitize.ts";

test("sanitizeSimproPayload redacts tokens and secrets", () => {
  const cleaned = sanitizeSimproPayload({
    ID: 12,
    AccessToken: "secret-token-value",
    Nested: { refresh_token: "abc", Name: "Acme Ltd" },
  });
  assert.equal((cleaned as { AccessToken: string }).AccessToken, "[REDACTED]");
  assert.equal((cleaned as { Nested: { refresh_token: string } }).Nested.refresh_token, "[REDACTED]");
  assert.equal((cleaned as { Nested: { Name: string } }).Nested.Name, "Acme Ltd");
  assert.equal((cleaned as { ID: number }).ID, 12);
});

test("sanitizeSimproPayload redacts emails and phones", () => {
  const cleaned = sanitizeSimproPayload({
    Email: "person@customer.com",
    Phone: "07700900123",
    Description: "Boiler swap",
  }) as Record<string, string>;
  assert.equal(cleaned.Email, "redacted@example.com");
  assert.equal(cleaned.Phone, "REDACTED");
  assert.equal(cleaned.Description, "Boiler swap");
});

test("summarizeSimproShape handles empty and nested structures", () => {
  const shape = summarizeSimproShape({
    ID: 1,
    Sections: [],
    CostCenters: [{ ID: 9, Name: "Plumbing", Items: null }],
  });
  assert.deepEqual(shape, {
    ID: "number",
    Sections: [],
    CostCenters: [
      {
        ID: "number",
        Name: "string",
        Items: null,
      },
    ],
  });
});

test("safeMissingFieldAccess tolerates nulls and missing paths", () => {
  assert.equal(safeMissingFieldAccess(null, ["Customer", "CompanyName"], "n/a"), "n/a");
  assert.equal(
    safeMissingFieldAccess({ Customer: { CompanyName: "Acme" } }, ["Customer", "CompanyName"], "n/a"),
    "Acme",
  );
  assert.equal(safeMissingFieldAccess({ Customer: null }, ["Customer", "CompanyName"], "n/a"), "n/a");
});

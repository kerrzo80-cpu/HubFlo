import assert from "node:assert/strict";
import test from "node:test";

import { formatOutboundEmailError } from "./outbound-email-errors.ts";

test("maps Microsoft SMTP disabled tenant error to admin guidance", () => {
  const raw =
    "Invalid login: 535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.";
  const formatted = formatOutboundEmailError(raw, "Outlook");
  assert.match(formatted, /Microsoft 365 has SMTP turned off/i);
  assert.match(formatted, /Authenticated SMTP/i);
});

test("passes through unknown errors unchanged", () => {
  assert.equal(formatOutboundEmailError("Network timeout", "Outlook"), "Network timeout");
});

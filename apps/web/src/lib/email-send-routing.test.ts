import assert from "node:assert/strict";
import test, { before } from "node:test";

process.env.NEXA_EMAIL_SETTINGS_SECRET = "unit-test-email-secret";

let resolveOutboundEmailRoute: typeof import("./email-integration-store.ts").resolveOutboundEmailRoute;
let saveEmailIntegrationSettings: typeof import("./email-integration-store.ts").saveEmailIntegrationSettings;
let saveEmployeeMailboxSettings: typeof import("./employee-mailbox-store.ts").saveEmployeeMailboxSettings;
let clearEmployeeMailbox: typeof import("./employee-mailbox-store.ts").clearEmployeeMailbox;

const employeeId = "emp-brian";

before(async () => {
  const emailMod = await import("./email-integration-store.ts");
  const mailboxMod = await import("./employee-mailbox-store.ts");
  resolveOutboundEmailRoute = emailMod.resolveOutboundEmailRoute;
  saveEmailIntegrationSettings = emailMod.saveEmailIntegrationSettings;
  saveEmployeeMailboxSettings = mailboxMod.saveEmployeeMailboxSettings;
  clearEmployeeMailbox = mailboxMod.clearEmployeeMailbox;
});

test("personal mailbox wins when employee mailbox is configured", () => {
  saveEmailIntegrationSettings({
    provider: "Outlook",
    senderEmail: "office@company.com",
    username: "office@company.com",
    secret: "company-app-password",
  });
  saveEmployeeMailboxSettings(employeeId, {
    provider: "Outlook",
    senderEmail: "brian@company.com",
    username: "brian@company.com",
    secret: "brian-app-password",
    displayName: "Brian",
  });

  assert.equal(resolveOutboundEmailRoute(employeeId), "employee");
});

test("company mailbox is used when employee has no personal mailbox", () => {
  clearEmployeeMailbox(employeeId);
  assert.equal(resolveOutboundEmailRoute(employeeId), "company");
});

test("returns null when neither personal nor company mailbox is configured", () => {
  clearEmployeeMailbox(employeeId);
  saveEmailIntegrationSettings({
    provider: "Outlook",
    senderEmail: "",
    username: "",
    secret: "",
  });
  assert.equal(resolveOutboundEmailRoute(employeeId), null);
});

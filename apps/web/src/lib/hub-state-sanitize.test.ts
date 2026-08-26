import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeHubStateForClient } from "./hub-state-sanitize.ts";
import type { HubDetailState } from "./hub-detail-store.ts";

describe("hub-state sanitize", () => {
  it("strips employee passwords from client payload", () => {
    const state = {
      employees: [
        {
          id: "emp-1",
          name: "Test",
          login: { username: "test", password: "super-secret", enabled: true },
        },
      ],
      integrationSettings: {
        smtpPassword: "mail-secret",
        displayName: "NeXa",
      },
    } as HubDetailState;

    const sanitized = sanitizeHubStateForClient(state);
    const employee = (sanitized.employees as Array<Record<string, unknown>>)[0]!;
    const login = employee.login as Record<string, unknown>;
    assert.equal(login.password, "");
    assert.equal(login.hasPassword, true);
    assert.equal(
      (sanitized.integrationSettings as Record<string, unknown>).smtpPassword,
      "[redacted]",
    );
    assert.equal(
      (sanitized.integrationSettings as Record<string, unknown>).displayName,
      "NeXa",
    );
  });
});

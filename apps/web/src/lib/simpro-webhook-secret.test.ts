import assert from "node:assert/strict";
import { describe, it, after } from "node:test";

import { isValidWebhookSecret } from "./simpro-webhook-auth.ts";

describe("simPRO webhook secret fail-closed", () => {
  const keys = ["SIMPRO_WEBHOOK_SECRET", "NEXA_AUTH_MODE", "NEXA_WORKSPACE_MODE"] as const;
  const previous: Record<string, string | undefined> = {};

  after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  function snapshotEnv() {
    for (const key of keys) previous[key] = process.env[key];
  }

  it("rejects missing secret in live users mode", () => {
    snapshotEnv();
    delete process.env.SIMPRO_WEBHOOK_SECRET;
    process.env.NEXA_AUTH_MODE = "users";
    process.env.NEXA_WORKSPACE_MODE = "live";
    assert.equal(isValidWebhookSecret(new Headers()), false);
  });

  it("accepts matching secret", () => {
    snapshotEnv();
    process.env.SIMPRO_WEBHOOK_SECRET = "s3cret";
    process.env.NEXA_AUTH_MODE = "users";
    const headers = new Headers({ "x-simpro-secret": "s3cret" });
    assert.equal(isValidWebhookSecret(headers), true);
  });

  it("rejects wrong secret", () => {
    snapshotEnv();
    process.env.SIMPRO_WEBHOOK_SECRET = "s3cret";
    process.env.NEXA_AUTH_MODE = "users";
    assert.equal(isValidWebhookSecret(new Headers({ "x-simpro-secret": "nope" })), false);
  });
});

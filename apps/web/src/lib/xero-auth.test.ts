import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-xero-auth-"));
process.env.NEXA_STORE_DIR = storeDir;
process.env.NEXA_STORE_PATH = "";
process.env.NEXT_PUBLIC_APP_URL = "https://nexa-pilot.onrender.com";
delete process.env.XERO_REDIRECT_URI;

test("xero oauth start URL, PKCE, and missing-credentials office message", async (t) => {
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));
  delete process.env.XERO_CLIENT_ID;
  delete process.env.XERO_CLIENT_SECRET;
  const { startXeroAuthorization, getXeroAuthStatus, XERO_MISSING_CREDENTIALS_MESSAGE } = await import("./xero-auth");

  const missing = getXeroAuthStatus();
  assert.equal(missing.canConnect, false);
  assert.ok(missing.officeMessage?.includes("XERO_CLIENT_ID"));
  assert.throws(() => startXeroAuthorization(), /XERO_CLIENT_ID/);
  assert.ok(XERO_MISSING_CREDENTIALS_MESSAGE.includes("XERO_CLIENT_ID"));

  process.env.XERO_CLIENT_ID = "test-client-id";
  process.env.XERO_CLIENT_SECRET = "test-client-secret";
  const started = startXeroAuthorization();
  const url = new URL(started.authUrl);
  assert.equal(url.origin + url.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://nexa-pilot.onrender.com/api/integrations/xero/callback",
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.ok(url.searchParams.get("state"));
  const status = getXeroAuthStatus();
  assert.equal(status.canConnect, true);
  assert.ok(status.redirectUrisToRegister.includes("https://nexa-pilot.onrender.com/api/integrations/xero/callback"));
  assert.ok(status.redirectUrisToRegister.includes("https://nexa-live.onrender.com/api/integrations/xero/callback"));
});

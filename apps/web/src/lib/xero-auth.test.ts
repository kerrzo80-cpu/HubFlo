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

const SAMPLE_CLIENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SAMPLE_CLIENT_SECRET = "nexa-platform-xero-secret";

test("xero oauth start URL, PKCE, placeholders, and office copy", async (t) => {
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));
  delete process.env.XERO_CLIENT_ID;
  delete process.env.XERO_CLIENT_SECRET;
  const {
    startXeroAuthorization,
    getXeroAuthStatus,
    officeMessageForXeroOAuthError,
    pickXeroTenantFromConnections,
    XERO_MISSING_CREDENTIALS_MESSAGE,
    XERO_OFFICE_CONNECT_COPY,
    XERO_UNAUTHORIZED_CLIENT_MESSAGE,
  } = await import("./xero-auth");
  const { isUsableXeroClientId, sanitizeXeroCredential } = await import("./accounting-provider-store");

  assert.equal(sanitizeXeroCredential('  "real-id"  '), "real-id");
  assert.equal(isUsableXeroClientId("changeme"), false);
  assert.equal(isUsableXeroClientId("your-client-id"), false);
  assert.equal(isUsableXeroClientId("test-client-id"), false);
  assert.equal(isUsableXeroClientId(SAMPLE_CLIENT_ID), true);

  const missing = getXeroAuthStatus();
  assert.equal(missing.canConnect, false);
  assert.ok(missing.officeMessage?.includes("XERO_CLIENT_ID"));
  assert.ok(missing.officeMessage?.includes("don’t need a developer account") || missing.officeMessage?.includes("don't need a developer account"));
  assert.throws(() => startXeroAuthorization(), /XERO_CLIENT_ID/);
  assert.ok(XERO_MISSING_CREDENTIALS_MESSAGE.includes("XERO_CLIENT_ID"));
  assert.ok(XERO_OFFICE_CONNECT_COPY.includes("don’t need a Xero developer account") || XERO_OFFICE_CONNECT_COPY.includes("don't need a Xero developer account"));
  assert.equal(
    officeMessageForXeroOAuthError("unauthorized_client", "Unknown client or client not enabled."),
    XERO_UNAUTHORIZED_CLIENT_MESSAGE,
  );

  process.env.XERO_CLIENT_ID = "changeme";
  process.env.XERO_CLIENT_SECRET = "placeholder";
  assert.equal(getXeroAuthStatus().canConnect, false);
  assert.throws(() => startXeroAuthorization(), /XERO_CLIENT_ID/);

  process.env.XERO_CLIENT_ID = `"${SAMPLE_CLIENT_ID}"`;
  process.env.XERO_CLIENT_SECRET = `"${SAMPLE_CLIENT_SECRET}"`;
  const started = startXeroAuthorization();
  const url = new URL(started.authUrl);
  assert.equal(url.origin + url.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), SAMPLE_CLIENT_ID);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://nexa-pilot.onrender.com/api/integrations/xero/callback",
  );
  assert.equal(url.searchParams.get("scope")?.includes("openid"), false);
  assert.equal(url.searchParams.get("scope")?.includes("offline_access"), true);
  assert.equal(url.searchParams.get("scope")?.includes("accounting.invoices"), true);
  assert.equal(url.searchParams.get("scope")?.includes("accounting.payments"), true);
  assert.equal(url.searchParams.get("scope")?.includes("accounting.contacts"), true);
  assert.equal(url.searchParams.get("scope")?.includes("accounting.settings"), true);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  assert.ok(url.searchParams.get("state"));
  assert.ok(url.searchParams.get("prompt")?.includes("login"));
  assert.ok(url.searchParams.get("prompt")?.includes("consent"));
  const status = getXeroAuthStatus();
  assert.equal(status.canConnect, true);
  assert.ok(status.officeMessage?.includes("don’t need a Xero developer account") || status.officeMessage?.includes("don't need a Xero developer account"));
  assert.ok(status.redirectUrisToRegister.includes("https://nexa-pilot.onrender.com/api/integrations/xero/callback"));
  assert.ok(status.redirectUrisToRegister.includes("https://nexa-live.onrender.com/api/integrations/xero/callback"));

  process.env.XERO_SCOPES = "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.attachments";
  const filtered = startXeroAuthorization();
  const filteredUrl = new URL(filtered.authUrl);
  assert.equal(
    filteredUrl.searchParams.get("scope"),
    "offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings",
  );
  process.env.XERO_SCOPES = "offline_access accounting.invoices accounting.contacts";
  const fallback = startXeroAuthorization();
  const fallbackUrl = new URL(fallback.authUrl);
  assert.equal(
    fallbackUrl.searchParams.get("scope"),
    "offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings",
  );
  delete process.env.XERO_SCOPES;

  const demoTenant = {
    tenantId: "demo-tenant",
    tenantName: "Demo Company",
    authEventId: "event-old",
    updatedDateUtc: "2024-01-01T00:00:00Z",
  };
  const liveTenant = {
    tenantId: "live-tenant",
    tenantName: "EWG Ltd",
    authEventId: "event-new",
    updatedDateUtc: "2026-08-18T00:00:00Z",
  };
  const token = `x.${Buffer.from(JSON.stringify({ authentication_event_id: "event-new" })).toString("base64url")}.y`;
  const picked = pickXeroTenantFromConnections([demoTenant, liveTenant], token);
  assert.equal(picked.tenantId, "live-tenant");
  assert.equal(picked.tenantName, "EWG Ltd");
});

import assert from "node:assert/strict";
import test from "node:test";

import { encryptTenantSecret, decryptTenantSecret, maskApiKeyLastFour } from "./secret-crypto.ts";
import {
  normaliseTenantSlug,
  isReservedTenantSlug,
  defaultEwgTenant,
  toPublicTenantView,
  type TenantRecord,
} from "./types.ts";
import { resolveTenantFromHost } from "./resolve-tenant.ts";
import { createTenant, findTenantByHost, getTenantBySlug, listTenants } from "./tenant-store.ts";
import { tenantStoreKey } from "./tenant-server-store.ts";

test("normalises and reserves slugs", () => {
  assert.equal(normaliseTenantSlug(" EWG Co! "), "ewg-co");
  assert.equal(isReservedTenantSlug("www"), true);
  assert.equal(isReservedTenantSlug("ewg"), false);
});

test("boots with EWG tenant and resolves legacy hosts", () => {
  const tenants = listTenants();
  assert.ok(tenants.some((tenant: TenantRecord) => tenant.slug === "ewg"));
  assert.ok(findTenantByHost("nexa-live.onrender.com")?.slug === "ewg");
  assert.ok(findTenantByHost("localhost")?.slug === "ewg");
  const resolved = resolveTenantFromHost("nexa-pilot.onrender.com");
  assert.equal(resolved?.tenant.slug, "ewg");
});

test("creates isolated tenants by slug and namespaces stores", () => {
  const slug = `co${Date.now().toString(36)}`;
  const tenant = createTenant({
    name: "Acme Plumbing",
    slug,
    branding: { primaryColor: "#114488" },
  });
  assert.equal(tenant.slug, slug);
  assert.ok(getTenantBySlug(slug));
  assert.equal(tenantStoreKey(tenant.id, "hub-detail-store"), `tenant__${tenant.id}__hub-detail-store`);
  const publicView = toPublicTenantView(tenant, `${slug}.nexaapp.com`);
  assert.equal(publicView.branding.primaryColor, "#114488");
  assert.ok(!("encryptedApiKey" in publicView));
});

test("encrypts tenant secrets and masks last four", () => {
  const key = "sk-test-abcdefghijklmnopqrstuvwxyz";
  const encrypted = encryptTenantSecret(key);
  assert.notEqual(encrypted, key);
  assert.equal(decryptTenantSecret(encrypted), key);
  assert.equal(maskApiKeyLastFour(key), key.slice(-4));
});

test("exposes public EWG branding without secrets", () => {
  const ewg = defaultEwgTenant();
  const view = toPublicTenantView(ewg, "ewg.nexaapp.com");
  assert.equal(view.name, "Errol Watson Group");
  assert.ok(view.urlHint.includes("ewg."));
});

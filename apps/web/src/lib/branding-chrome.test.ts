import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultBusinessBrandingSettings, resolveBrandChromeLogoUrl, resolveBrandLogoUrl } from "@/lib/branding";

describe("resolveBrandChromeLogoUrl", () => {
  it("prefers the wide company wordmark over a square CORE mark in chrome bars", () => {
    const brand = {
      ...defaultBusinessBrandingSettings,
      logoUrl: "/ewg-logo.png",
      coreLogoUrl: "/api/branding/assets/logo-core?v=1",
      fieldLogoUrl: "/api/branding/assets/logo-field?v=1",
    };
    assert.equal(resolveBrandLogoUrl(brand, "core"), "/api/branding/assets/logo-core?v=1");
    assert.equal(resolveBrandChromeLogoUrl(brand, "core"), "/ewg-logo.png");
    assert.equal(resolveBrandChromeLogoUrl(brand, "field"), "/api/branding/assets/logo-field?v=1");
  });

  it("falls back to company logo when a per-app chrome logo is empty", () => {
    const brand = {
      ...defaultBusinessBrandingSettings,
      logoUrl: "/ewg-logo.png",
      fieldLogoUrl: "",
    };
    assert.equal(resolveBrandChromeLogoUrl(brand, "field"), "/ewg-logo.png");
  });

  it("does not invent an EWG logo when the company has none", () => {
    assert.equal(defaultBusinessBrandingSettings.logoUrl, "");
    assert.equal(resolveBrandChromeLogoUrl(defaultBusinessBrandingSettings, "core"), "");
    assert.equal(resolveBrandLogoUrl(defaultBusinessBrandingSettings, "core"), "");
  });
});

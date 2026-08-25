import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultBusinessBrandingSettings, resolveBrandChromeLogoUrl, resolveBrandLogoUrl } from "@/lib/branding";

const BLAKE_WORDMARK = "/brand/blake-wordmark-dark.svg";

describe("resolveBrandChromeLogoUrl", () => {
  it("prefers the blake. wordmark over a square CORE mark in chrome bars", () => {
    const brand = {
      ...defaultBusinessBrandingSettings,
      logoUrl: "/ewg-logo.png",
      coreLogoUrl: "/api/branding/assets/logo-core?v=1",
      fieldLogoUrl: "/api/branding/assets/logo-field?v=1",
    };
    assert.equal(resolveBrandLogoUrl(brand, "core"), "/api/branding/assets/logo-core?v=1");
    assert.equal(resolveBrandChromeLogoUrl(brand, "core"), BLAKE_WORDMARK);
    assert.equal(resolveBrandChromeLogoUrl(brand, "field"), "/api/branding/assets/logo-field?v=1");
  });

  it("falls back to the blake. wordmark when a per-app chrome logo is empty", () => {
    const brand = {
      ...defaultBusinessBrandingSettings,
      logoUrl: "/ewg-logo.png",
      fieldLogoUrl: "",
    };
    assert.equal(resolveBrandChromeLogoUrl(brand, "field"), BLAKE_WORDMARK);
  });

  it("does not invent an EWG logo when the company has none", () => {
    assert.equal(defaultBusinessBrandingSettings.logoUrl, "");
    assert.equal(resolveBrandChromeLogoUrl(defaultBusinessBrandingSettings, "core"), BLAKE_WORDMARK);
    assert.equal(resolveBrandLogoUrl(defaultBusinessBrandingSettings, "core"), BLAKE_WORDMARK);
  });
});

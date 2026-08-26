import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyEnvCompanyFallback,
  defaultBusinessBrandingSettings,
  displayCompanyName,
  normalizeBusinessBranding,
} from "./branding";
import { isTrialCompanyResetAllowed, isTrialInstance, useDemoSeedData } from "./workspace-mode";

describe("empty / trial workspace branding", () => {
  it("does not default company name, logos or product chrome to Errol Watson Group", () => {
    const blob = JSON.stringify(defaultBusinessBrandingSettings);
    assert.equal(/errol watson|ewg-logo|\bEWG\b|chris lawson/i.test(blob), false);
    assert.equal(defaultBusinessBrandingSettings.companyName, "Company");
    assert.equal(defaultBusinessBrandingSettings.logoUrl, "");
    assert.equal(normalizeBusinessBranding({}).companyName, "Company");
    assert.equal(normalizeBusinessBranding({}).logoUrl, "");
    assert.equal(displayCompanyName({}), "Company");
  });

  it("fills a blank company name from NEXA_COMPANY_NAME without forcing EWG", () => {
    const brand = applyEnvCompanyFallback({}, { NEXA_COMPANY_NAME: "Trial company" } as NodeJS.ProcessEnv);
    assert.equal(brand.companyName, "Trial company");
    assert.equal(/errol watson/i.test(JSON.stringify(brand)), false);
  });

  it("does not overwrite a saved office company name", () => {
    const brand = applyEnvCompanyFallback(
      { companyName: "Errol Watson Group", tradingName: "Errol Watson Group Ltd" },
      { NEXA_COMPANY_NAME: "Trial company" } as NodeJS.ProcessEnv,
    );
    assert.equal(brand.companyName, "Errol Watson Group");
  });
});

describe("trial reset guards", () => {
  it("allows reset only on the trial live instance", () => {
    assert.equal(
      isTrialCompanyResetAllowed({
        NEXA_WORKSPACE_MODE: "live",
        NEXT_PUBLIC_APP_URL: "https://nexa-trial.onrender.com",
        NEXA_TRIAL: "1",
      } as NodeJS.ProcessEnv),
      true,
    );
  });

  it("never allows reset on nexa-live even if NEXA_TRIAL=1", () => {
    assert.equal(
      isTrialCompanyResetAllowed({
        NEXA_WORKSPACE_MODE: "live",
        NEXT_PUBLIC_APP_URL: "https://nexa-live.onrender.com",
        NEXA_TRIAL: "1",
      } as NodeJS.ProcessEnv),
      false,
    );
    assert.equal(
      isTrialInstance({
        NEXT_PUBLIC_APP_URL: "https://nexa-live.onrender.com",
        NEXA_TRIAL: "1",
      } as NodeJS.ProcessEnv),
      false,
    );
  });

  it("does not treat nexa-trial URL as a trial instance without NEXA_TRIAL", () => {
    assert.equal(
      isTrialCompanyResetAllowed({
        NEXA_WORKSPACE_MODE: "live",
        NEXT_PUBLIC_APP_URL: "https://nexa-trial.onrender.com",
      } as NodeJS.ProcessEnv),
      false,
    );
  });

  it("does not seed demo data in live or trial mode", () => {
    assert.equal(useDemoSeedData({ NEXA_WORKSPACE_MODE: "live" } as NodeJS.ProcessEnv), false);
    assert.equal(useDemoSeedData({ NEXA_WORKSPACE_MODE: "trial" } as NodeJS.ProcessEnv), false);
    assert.equal(useDemoSeedData({ NEXA_WORKSPACE_MODE: "demo" } as NodeJS.ProcessEnv), true);
  });

  it("never allows reset on nexa-pilot", () => {
    assert.equal(
      isTrialCompanyResetAllowed({
        NEXA_WORKSPACE_MODE: "live",
        NEXT_PUBLIC_APP_URL: "https://nexa-pilot.onrender.com",
        NEXA_TRIAL: "1",
      } as NodeJS.ProcessEnv),
      false,
    );
  });

  it("treats NEXA_WORKSPACE_MODE=trial as a live empty store", () => {
    assert.equal(
      isTrialCompanyResetAllowed({
        NEXA_WORKSPACE_MODE: "trial",
        NEXT_PUBLIC_APP_URL: "https://nexa-trial.onrender.com",
        NEXA_TRIAL: "1",
      } as NodeJS.ProcessEnv),
      true,
    );
  });
});

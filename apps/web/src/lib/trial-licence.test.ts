import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULT_TRIAL_DAYS,
  TRIAL_ENDED_PATH,
  TRIAL_LICENCE_FILE_NAME,
  TRIAL_LICENCE_STORE_NAME,
  ensureTrialLicenceStartedAt,
  getTrialLicenceStatus,
  isTrialAccessExpired,
  isTrialExpiredAllowedPath,
  resetTrialLicenceCache,
} from "./trial-licence";
import { TRIAL_WIPE_KEEP_STORES } from "./trial-workspace";

const trialEnvBase = {
  NEXA_TRIAL: "1",
  NEXT_PUBLIC_APP_URL: "https://nexa-trial.onrender.com",
} as const;

function tempLicenceEnv(extra: NodeJS.ProcessEnv = {}): { env: NodeJS.ProcessEnv; dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "nexa-trial-licence-"));
  const file = path.join(dir, TRIAL_LICENCE_FILE_NAME);
  return {
    dir,
    file,
    env: {
      ...trialEnvBase,
      NEXA_STORE_DIR: dir,
      NEXA_TRIAL_LICENCE_PATH: file,
      ...extra,
    } as NodeJS.ProcessEnv,
  };
}

afterEach(() => {
  resetTrialLicenceCache();
});

describe("trial licence clock", () => {
  it("never expires nexa-live even if NEXA_TRIAL=1", () => {
    const status = getTrialLicenceStatus({
      NEXA_TRIAL: "1",
      NEXT_PUBLIC_APP_URL: "https://nexa-live.onrender.com",
      NEXA_TRIAL_EXPIRES_AT: "2000-01-01",
    } as NodeJS.ProcessEnv);
    assert.equal(status.trial, false);
    assert.equal(status.expired, false);
    assert.equal(isTrialAccessExpired({
      NEXA_TRIAL: "1",
      NEXT_PUBLIC_APP_URL: "https://nexa-live.onrender.com",
      NEXA_TRIAL_EXPIRES_AT: "2000-01-01",
    } as NodeJS.ProcessEnv), false);
  });

  it("never expires nexa-pilot", () => {
    const status = getTrialLicenceStatus({
      NEXA_TRIAL: "1",
      NEXT_PUBLIC_APP_URL: "https://nexa-pilot.onrender.com",
      NEXA_TRIAL_EXPIRES_AT: "2000-01-01",
    } as NodeJS.ProcessEnv);
    assert.equal(status.trial, false);
    assert.equal(status.expired, false);
  });

  it("does nothing when NEXA_TRIAL is unset", () => {
    const { env, file, dir } = tempLicenceEnv({ NEXA_TRIAL: "" });
    try {
      const status = getTrialLicenceStatus(env);
      assert.equal(status.trial, false);
      assert.equal(existsSync(file), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records first-boot startedAt and lasts 30 days", () => {
    const { env, file, dir } = tempLicenceEnv();
    try {
      const now = new Date("2026-08-18T13:00:00.000Z");
      const first = getTrialLicenceStatus(env, now);
      assert.equal(first.trial, true);
      assert.equal(first.expired, false);
      assert.equal(first.daysGranted, DEFAULT_TRIAL_DAYS);
      assert.equal(first.daysRemaining, 30);
      assert.equal(existsSync(file), true);
      const saved = JSON.parse(readFileSync(file, "utf8")) as { startedAt: string };
      assert.equal(saved.startedAt, now.toISOString());

      const lastDay = getTrialLicenceStatus(env, new Date("2026-09-16T13:00:01.000Z"));
      assert.equal(lastDay.expired, false);
      assert.equal(lastDay.daysRemaining, 1);

      const day31 = getTrialLicenceStatus(env, new Date("2026-09-17T13:00:00.000Z"));
      assert.equal(day31.expired, true);
      assert.equal(day31.daysRemaining, 0);
      assert.equal(isTrialAccessExpired(env, new Date("2026-09-17T13:00:00.000Z")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not restart the clock on a second boot or env started-at edit", () => {
    const { env, file, dir } = tempLicenceEnv();
    try {
      const firstBoot = new Date("2026-08-18T13:00:00.000Z");
      ensureTrialLicenceStartedAt(env, firstBoot);
      resetTrialLicenceCache();

      const laterEnv = {
        ...env,
        NEXA_TRIAL_STARTED_AT: "2026-12-01T00:00:00.000Z",
      } as NodeJS.ProcessEnv;
      const again = ensureTrialLicenceStartedAt(laterEnv, new Date("2026-08-25T00:00:00.000Z"));
      assert.equal(again, firstBoot.toISOString());
      const saved = JSON.parse(readFileSync(file, "utf8")) as { startedAt: string };
      assert.equal(saved.startedAt, firstBoot.toISOString());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extends the window with NEXA_TRIAL_DAYS without rewriting startedAt", () => {
    const { env, file, dir } = tempLicenceEnv();
    try {
      const started = new Date("2026-08-18T13:00:00.000Z");
      ensureTrialLicenceStartedAt(env, started);
      const extended = getTrialLicenceStatus(
        { ...env, NEXA_TRIAL_DAYS: "45" } as NodeJS.ProcessEnv,
        new Date("2026-09-20T13:00:00.000Z"),
      );
      assert.equal(extended.expired, false);
      assert.equal(extended.daysGranted, 45);
      const saved = JSON.parse(readFileSync(file, "utf8")) as { startedAt: string };
      assert.equal(saved.startedAt, started.toISOString());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours NEXA_TRIAL_EXPIRES_AT as an exact end date", () => {
    const { env, dir } = tempLicenceEnv({ NEXA_TRIAL_EXPIRES_AT: "2026-09-01T00:00:00.000Z" });
    try {
      ensureTrialLicenceStartedAt(env, new Date("2026-08-18T13:00:00.000Z"));
      const before = getTrialLicenceStatus(env, new Date("2026-08-31T23:00:00.000Z"));
      assert.equal(before.expired, false);
      const after = getTrialLicenceStatus(env, new Date("2026-09-01T00:00:00.000Z"));
      assert.equal(after.expired, true);
      assert.equal(after.expiresAt, "2026-09-01T00:00:00.000Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seeds from NEXA_TRIAL_STARTED_AT only when no licence file exists", () => {
    const { env, file, dir } = tempLicenceEnv({
      NEXA_TRIAL_STARTED_AT: "2026-07-01T00:00:00.000Z",
    });
    try {
      const status = getTrialLicenceStatus(env, new Date("2026-07-10T00:00:00.000Z"));
      assert.equal(status.startedAt, "2026-07-01T00:00:00.000Z");
      assert.equal(JSON.parse(readFileSync(file, "utf8")).startedAt, "2026-07-01T00:00:00.000Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("trial licence wipe protection", () => {
  it("keeps the licence store name out of company data wipes", () => {
    assert.equal(TRIAL_LICENCE_STORE_NAME, "trial-licence");
    assert.ok((TRIAL_WIPE_KEEP_STORES as readonly string[]).includes(TRIAL_LICENCE_STORE_NAME));
  });

  it("leaves an existing licence file in place when the store dir is otherwise cleared", () => {
    const { env, file, dir } = tempLicenceEnv();
    try {
      const started = "2026-08-01T09:00:00.000Z";
      writeFileSync(file, JSON.stringify({ startedAt: started }), "utf8");
      const status = getTrialLicenceStatus(env, new Date("2026-08-18T13:00:00.000Z"));
      assert.equal(status.startedAt, started);
      assert.equal(existsSync(file), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("expired-path allowlist", () => {
  it("allows the ended page, login, health and branding after expiry", () => {
    assert.equal(isTrialExpiredAllowedPath(TRIAL_ENDED_PATH), true);
    assert.equal(isTrialExpiredAllowedPath("/login"), true);
    assert.equal(isTrialExpiredAllowedPath("/api/health"), true);
    assert.equal(isTrialExpiredAllowedPath("/api/health/smoke"), true);
    assert.equal(isTrialExpiredAllowedPath("/api/trial-licence"), true);
    assert.equal(isTrialExpiredAllowedPath("/api/branding"), true);
    assert.equal(isTrialExpiredAllowedPath("/api/branding/favicon"), true);
  });

  it("blocks Core, Takeoff and other APIs after expiry", () => {
    assert.equal(isTrialExpiredAllowedPath("/"), false);
    assert.equal(isTrialExpiredAllowedPath("/setup"), false);
    assert.equal(isTrialExpiredAllowedPath("/takeoff"), false);
    assert.equal(isTrialExpiredAllowedPath("/api/auth/login"), false);
    assert.equal(isTrialExpiredAllowedPath("/api/hub-state"), false);
  });
});

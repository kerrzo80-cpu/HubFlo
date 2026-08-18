import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PILOT_BACKUP_STORE_NAMES,
  redactBackupStoreValue,
  restorePilotBackup,
  runRestoreFireDrill,
  summariseStore,
  verifyPilotBackup,
} from "./pilot-backup";
import { writeServerStore } from "./server-store";

describe("pilot-backup", () => {
  it("summarises present and missing stores", () => {
    const present = summariseStore("lead-store", { leads: [{ id: "1" }, { id: "2" }] });
    assert.equal(present.present, true);
    assert.equal(present.approxItems, 2);
    assert.ok(present.sha256);
    const missing = summariseStore("lead-store", null);
    assert.equal(missing.present, false);
    assert.equal(missing.bytes, 0);
  });

  it("verifies backup shape and dry-runs restore", () => {
    const backup = {
      product: "NeXa company backup",
      purpose: "test",
      generatedAt: new Date().toISOString(),
      version: 3,
      stores: Object.fromEntries(PILOT_BACKUP_STORE_NAMES.map((name) => [name, { ok: true, name }])),
    };
    const verification = verifyPilotBackup(backup);
    assert.equal(verification.ok, true);
    if (!verification.ok) return;
    assert.equal(verification.presentStoreCount, PILOT_BACKUP_STORE_NAMES.length);

    const dry = restorePilotBackup(backup, { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.applied, false);
    assert.equal(dry.written.length, PILOT_BACKUP_STORE_NAMES.length);
    assert.equal(dry.requiresRestart, false);
  });

  it("rejects invalid backup", () => {
    const bad = verifyPilotBackup({ hello: true });
    assert.equal(bad.ok, false);
  });

  it("strips API keys and mailbox secrets from backup snapshots", () => {
    const openai = redactBackupStoreValue("nexa-openai-config", { apiKey: "sk-live-office-secret", model: "gpt-4.1-mini" });
    const json = JSON.stringify(openai);
    assert.equal(json.includes("sk-live-office-secret"), false);
    assert.equal((openai as { model?: string }).model, "gpt-4.1-mini");
    const mail = redactBackupStoreValue("employee-mailboxes", {
      byEmployeeId: { "emp-1": { senderEmail: "office@example.com", encryptedSecret: "very-secret-app-password" } },
    });
    const mailJson = JSON.stringify(mail);
    assert.equal(mailJson.includes("very-secret-app-password"), false);
    assert.equal(mailJson.includes("office@example.com"), true);
    assert.equal(redactBackupStoreValue("auth-store", { users: [{ password: "x" }] }), null);
  });

  it("runs a shadow restore fire-drill against written stores", () => {
    // Seed a couple of real stores so the drill has something to round-trip.
    writeServerStore("lead-store", { leads: [{ id: "drill-1" }] });
    writeServerStore("workflow-store", { quotes: [], jobs: [], purchaseRequests: [] });
    const result = runRestoreFireDrill({ persist: true });
    assert.equal(result.ok, true);
    assert.ok(result.storesChecked >= 2);
    assert.equal(result.storesMatched, result.storesChecked);
    assert.equal(result.mismatches.length, 0);
  });
});

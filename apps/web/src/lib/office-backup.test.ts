import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  OFFICE_BACKUP_NAME_RE,
  isSecretDiskFileName,
  officeBackupFileName,
  officeBackupWorkspaceLabel,
  selectBackupsToDelete,
} from "./office-backup";
import { officeBackupS3ObjectKey } from "./office-backup-s3";
import { redactBackupStoreValue } from "./pilot-backup";

describe("office-backup", () => {
  it("names backups with workspace and UTC timestamp", () => {
    const name = officeBackupFileName({
      workspace: "pilot",
      at: new Date("2026-08-18T02:15:00.000Z"),
    });
    assert.equal(name, "nexa-pilot-backup-20260818T021500Z.tar.gz");
    assert.equal(OFFICE_BACKUP_NAME_RE.test(name), true);
    assert.equal(officeBackupFileName({ workspace: "NeXa Live!", at: new Date("2026-08-18T02:15:00.000Z") }), "nexa-nexalive-backup-20260818T021500Z.tar.gz");
  });

  it("labels workspace from the public URL so live and pilot stay separate", () => {
    assert.equal(officeBackupWorkspaceLabel({ NEXT_PUBLIC_APP_URL: "https://nexa-pilot.onrender.com" }), "pilot");
    assert.equal(officeBackupWorkspaceLabel({ NEXT_PUBLIC_APP_URL: "https://nexa-live.onrender.com" }), "live");
    assert.equal(officeBackupWorkspaceLabel({ NEXT_PUBLIC_APP_URL: "https://nexa-trial.onrender.com" }), "trial");
    assert.equal(officeBackupWorkspaceLabel({ NEXA_WORKSPACE_MODE: "demo" }), "local");
  });

  it("keeps the newest N daily backups and prunes the rest", () => {
    const files = [
      { name: "nexa-pilot-backup-20260801T020000Z.tar.gz", mtimeMs: 1, bytes: 100 },
      { name: "nexa-pilot-backup-20260810T020000Z.tar.gz", mtimeMs: 10, bytes: 100 },
      { name: "nexa-pilot-backup-20260818T020000Z.tar.gz", mtimeMs: 18, bytes: 100 },
      { name: "readme.txt", mtimeMs: 99, bytes: 10 },
    ];
    const deleted = selectBackupsToDelete(files, { keep: 2, maxTotalBytes: 10_000 });
    assert.deepEqual(deleted, ["nexa-pilot-backup-20260801T020000Z.tar.gz"]);
  });

  it("prunes older backups when the backup folder would fill the disk", () => {
    const files = [
      { name: "nexa-pilot-backup-20260818T020000Z.tar.gz", mtimeMs: 18, bytes: 800 },
      { name: "nexa-pilot-backup-20260817T020000Z.tar.gz", mtimeMs: 17, bytes: 800 },
      { name: "nexa-pilot-backup-20260816T020000Z.tar.gz", mtimeMs: 16, bytes: 800 },
    ];
    const deleted = selectBackupsToDelete(files, { keep: 14, maxTotalBytes: 1000 });
    assert.deepEqual(deleted, [
      "nexa-pilot-backup-20260817T020000Z.tar.gz",
      "nexa-pilot-backup-20260816T020000Z.tar.gz",
    ]);
  });

  it("does not backup secrets or token files", () => {
    assert.equal(isSecretDiskFileName("simpro_refresh_token.txt"), true);
    assert.equal(isSecretDiskFileName("/var/data/simpro_refresh_token.txt"), true);
    assert.equal(isSecretDiskFileName(".env"), true);
    assert.equal(isSecretDiskFileName("nexa-email-secret.json"), true);
    assert.equal(isSecretDiskFileName("takeoff-files/proj/drawing.pdf"), false);
    assert.equal(isSecretDiskFileName("nexa-pilot.sqlite"), false);

    const openai = redactBackupStoreValue("nexa-openai-config", { apiKey: "sk-office-must-not-leak", model: "gpt-4.1-mini" });
    assert.equal(JSON.stringify(openai).includes("sk-office-must-not-leak"), false);
    const xero = redactBackupStoreValue("nexa-xero-auth-v1", { refreshToken: "xero-refresh", tenantName: "EWG" });
    assert.equal(xero, null);
    const accounting = redactBackupStoreValue("nexa-accounting-provider-v1", {
      provider: "xero",
      xeroClientSecret: "platform-xero-secret",
    });
    assert.equal(JSON.stringify(accounting).includes("platform-xero-secret"), false);
  });

  it("keeps S3 keys namespaced by workspace", () => {
    const previous = { ...process.env };
    process.env.BACKUP_S3_PREFIX = "";
    try {
      const key = officeBackupS3ObjectKey({
        workspace: "pilot",
        filename: "nexa-pilot-backup-20260818T021500Z.tar.gz",
      });
      assert.equal(key, "nexa/pilot/nexa-pilot-backup-20260818T021500Z.tar.gz");
    } finally {
      process.env.BACKUP_S3_PREFIX = previous.BACKUP_S3_PREFIX;
    }
  });

  it("writes a real archive that can be listed by filename rules", () => {
    const dir = path.join(os.tmpdir(), `nexa-backup-test-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    try {
      const name = officeBackupFileName({ workspace: "local", at: new Date("2026-08-18T12:00:00.000Z") });
      writeFileSync(path.join(dir, name), "backup");
      assert.equal(OFFICE_BACKUP_NAME_RE.test(name), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

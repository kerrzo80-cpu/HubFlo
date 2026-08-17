import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("importKitsFromXlsx merges bathroom template into store", async (t) => {
  const storeDir = mkdtempSync(path.join(tmpdir(), "hubflo-kits-"));
  process.env.NEXA_STORE_DIR = storeDir;
  process.env.NEXA_STORE_PATH = "";
  process.env.NEXA_WORKSPACE_MODE = "live";
  t.after(() => rmSync(storeDir, { recursive: true, force: true }));

  const { writeServerStore } = await import("./server-store");
  writeServerStore("nexa-prebuilds-v1", { kits: [] });

  const { importKitsFromXlsx, listKits } = await import("./prebuild-data");
  const fixture = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/kits-prebuilds-template.xlsx",
  );
  const result = importKitsFromXlsx(readFileSync(fixture), {
    mode: "replace",
    fileName: "kits-prebuilds-template.xlsx",
  });
  assert.ok(result.imported >= 10);
  assert.equal(result.created, result.imported);
  const kits = listKits();
  assert.ok(kits.some((kit) => /^bath$/i.test(kit.name)));
  assert.ok(kits.some((kit) => /toilet/i.test(kit.name)));
  const again = importKitsFromXlsx(readFileSync(fixture), {
    mode: "merge",
    fileName: "kits-prebuilds-template.xlsx",
  });
  assert.equal(again.created, 0);
  assert.ok(again.updated >= 10);
});

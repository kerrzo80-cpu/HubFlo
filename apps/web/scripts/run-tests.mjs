#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const storeDirectory = mkdtempSync(path.join(tmpdir(), "nexa-web-tests-"));

try {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", "src/**/*.test.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXA_STORE_DIR: storeDirectory,
        NEXA_STORE_PATH: "",
        NEXA_POSTGRES_MIRROR: "0",
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(storeDirectory, { recursive: true, force: true });
}

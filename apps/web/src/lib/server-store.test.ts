import assert from "node:assert/strict";
import test, { before } from "node:test";
import path from "node:path";
import { rmSync } from "node:fs";

// Reproduce the previously-buggy configuration: env vars present but empty.
// server-store reads these at module load, so set them before importing it
// (via the before() hook, since this package compiles tests as CommonJS).
process.env.NEXA_STORE_DIR = "";
process.env.NEXA_STORE_PATH = "";

let loadServerStore: typeof import("./server-store.ts").loadServerStore;
let writeServerStore: typeof import("./server-store.ts").writeServerStore;
let getServerStoreDirectory: typeof import("./server-store.ts").getServerStoreDirectory;
let getServerStoreBackend: typeof import("./server-store.ts").getServerStoreBackend;

before(async () => {
  const mod = await import("./server-store.ts");
  ({ loadServerStore, writeServerStore, getServerStoreDirectory, getServerStoreBackend } = mod);
});

test("empty NEXA_STORE_DIR falls back to .hubflo-runtime, not the process CWD", () => {
  const dir = getServerStoreDirectory();
  assert.equal(path.basename(dir), ".hubflo-runtime");
  assert.notEqual(path.resolve(dir), path.resolve(process.cwd()));
});

test("empty NEXA_STORE_PATH uses the JSON backend (not SQLite)", () => {
  assert.equal(getServerStoreBackend(), "json");
});

test("writeServerStore / loadServerStore round-trips a value", () => {
  const name = `unit-test-store-${process.pid}`;
  const file = path.join(getServerStoreDirectory(), `${name}.json`);
  try {
    writeServerStore(name, { hello: "world", count: 42 });
    const loaded = loadServerStore<{ hello: string; count: number }>(name, { hello: "", count: 0 });
    assert.deepEqual(loaded, { hello: "world", count: 42 });
  } finally {
    rmSync(file, { force: true });
  }
});

test("loadServerStore returns the fallback for an unknown store", () => {
  const name = `missing-store-${process.pid}-${Date.now()}`;
  const file = path.join(getServerStoreDirectory(), `${name}.json`);
  try {
    const fallback = { seeded: true };
    assert.deepEqual(loadServerStore(name, fallback), fallback);
  } finally {
    rmSync(file, { force: true });
  }
});

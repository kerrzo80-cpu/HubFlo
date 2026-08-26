import assert from "node:assert/strict";
import test, { before } from "node:test";
import path from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

// Reproduce the previously-buggy configuration: env vars present but empty.
// server-store reads these at module load, so set them before importing it
// (via the before() hook, since this package compiles tests as CommonJS).
process.env.NEXA_STORE_DIR = "";
process.env.NEXA_STORE_PATH = "";

let loadServerStore: typeof import("./server-store.ts").loadServerStore;
let writeServerStore: typeof import("./server-store.ts").writeServerStore;
let getServerStoreDirectory: typeof import("./server-store.ts").getServerStoreDirectory;
let getServerStoreBackend: typeof import("./server-store.ts").getServerStoreBackend;
let deleteServerStore: typeof import("./server-store.ts").deleteServerStore;
let wipeServerStoreDirectories: typeof import("./server-store.ts").wipeServerStoreDirectories;

before(async () => {
  const mod = await import("./server-store.ts");
  ({
    loadServerStore,
    writeServerStore,
    getServerStoreDirectory,
    getServerStoreBackend,
    deleteServerStore,
    wipeServerStoreDirectories,
  } = mod);
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

test("deleteServerStore removes a JSON store without touching others", () => {
  const keep = `keep-store-${process.pid}`;
  const drop = `drop-store-${process.pid}`;
  const keepFile = path.join(getServerStoreDirectory(), `${keep}.json`);
  const dropFile = path.join(getServerStoreDirectory(), `${drop}.json`);
  try {
    writeServerStore(keep, { keep: true });
    writeServerStore(drop, { drop: true });
    assert.equal(deleteServerStore(drop), true);
    assert.deepEqual(loadServerStore(keep, { keep: false }), { keep: true });
    assert.deepEqual(loadServerStore(drop, { gone: true }), { gone: true });
  } finally {
    rmSync(keepFile, { force: true });
    rmSync(dropFile, { force: true });
  }
});

test("wipeServerStoreDirectories only removes named folders under the store dir", () => {
  const dir = getServerStoreDirectory();
  const branding = path.join(dir, `branding-wipe-${process.pid}`);
  const keepName = `nested-keep-${process.pid}`;
  try {
    writeServerStore(keepName, { ok: true });
    mkdirSync(branding, { recursive: true });
    writeFileSync(path.join(branding, "logo.png"), "x");
    const removed = wipeServerStoreDirectories([`branding-wipe-${process.pid}`, "..", ""]);
    assert.deepEqual(removed, [`branding-wipe-${process.pid}`]);
    assert.equal(existsSync(branding), false);
    assert.deepEqual(loadServerStore(keepName, { ok: false }), { ok: true });
  } finally {
    rmSync(branding, { recursive: true, force: true });
    rmSync(path.join(dir, `${keepName}.json`), { force: true });
  }
});

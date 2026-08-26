#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, "1");
  }
}

const sqlitePath = args.get("sqlite") || process.env.NEXA_STORE_PATH || "";
const dataDir = args.get("data-dir") || process.env.NEXA_STORE_DIR || (sqlitePath ? path.dirname(sqlitePath) : "");
const outputPath = args.get("out") || "";

const fileDirs = [
  "record-documents",
  "takeoff-files",
  "survey-files",
  "field-photos",
  "branding",
  "xero-bills",
  "xero-exports",
  "backups",
];

function byteLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function classifyJson(value) {
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const arrayFields = keys
      .map((key) => ({ key, count: Array.isArray(value[key]) ? value[key].length : null }))
      .filter((item) => item.count !== null)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, 12);
    return { type: "object", keyCount: keys.length, arrayFields };
  }
  return { type: typeof value };
}

function inspectStores() {
  const stores = [];
  const problems = [];
  if (!sqlitePath) {
    problems.push("No SQLite path supplied. Use --sqlite /path/to/nexa-live.sqlite or NEXA_STORE_PATH.");
    return { backend: "none", path: "", exists: false, stores, problems };
  }
  if (!existsSync(sqlitePath)) {
    problems.push(`SQLite file not found: ${sqlitePath}`);
    return { backend: "sqlite", path: sqlitePath, exists: false, stores, problems };
  }
  if (!DatabaseSync) {
    problems.push("node:sqlite is unavailable in this Node runtime.");
    return { backend: "sqlite", path: sqlitePath, exists: true, stores, problems };
  }
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const rows = database
      .prepare("SELECT name, value, updated_at FROM pilot_store ORDER BY name")
      .all();
    for (const row of rows) {
      const raw = String(row.value || "");
      const bytes = Buffer.byteLength(raw, "utf8");
      let parsed = null;
      let summary = { type: "invalid-json" };
      try {
        parsed = JSON.parse(raw);
        summary = classifyJson(parsed);
      } catch {
        // Store remains listed with invalid-json type.
      }
      stores.push({
        name: row.name,
        bytes,
        size: byteLabel(bytes),
        updatedAt: row.updated_at || null,
        hash: sha256(Buffer.from(raw)).slice(0, 16),
        ...summary,
      });
    }
  } finally {
    database.close();
  }
  return { backend: "sqlite", path: sqlitePath, exists: true, stores, problems };
}

function walkDirectory(root) {
  const totals = { files: 0, bytes: 0 };
  const extensions = new Map();
  const largestFiles = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      totals.files += 1;
      totals.bytes += stat.size;
      const ext = path.extname(entry.name).toLowerCase() || "(none)";
      extensions.set(ext, (extensions.get(ext) || 0) + 1);
      largestFiles.push({
        path: path.relative(dataDir || root, full),
        bytes: stat.size,
        size: byteLabel(stat.size),
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
      });
    }
  }
  largestFiles.sort((a, b) => b.bytes - a.bytes);
  return {
    files: totals.files,
    bytes: totals.bytes,
    size: byteLabel(totals.bytes),
    extensions: [...extensions.entries()]
      .map(([extension, count]) => ({ extension, count }))
      .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension)),
    largestFiles: largestFiles.slice(0, 15),
  };
}

function inspectFiles() {
  const directories = [];
  const problems = [];
  if (!dataDir) {
    problems.push("No data directory supplied. Use --data-dir /var/data or NEXA_STORE_DIR.");
    return { root: "", exists: false, directories, problems };
  }
  if (!existsSync(dataDir)) {
    problems.push(`Data directory not found: ${dataDir}`);
    return { root: dataDir, exists: false, directories, problems };
  }
  for (const name of fileDirs) {
    const dir = path.join(dataDir, name);
    if (!existsSync(dir)) {
      directories.push({ name, path: dir, exists: false, files: 0, bytes: 0, size: "0 B", extensions: [], largestFiles: [] });
      continue;
    }
    directories.push({ name, path: dir, exists: true, ...walkDirectory(dir) });
  }
  return { root: dataDir, exists: true, directories, problems };
}

const storeInventory = inspectStores();
const fileInventory = inspectFiles();
const report = {
  generatedAt: new Date().toISOString(),
  command: "scripts/nexa-production-inventory.mjs",
  safeMode: "read-only",
  sqlite: storeInventory,
  files: fileInventory,
  totals: {
    storeCount: storeInventory.stores.length,
    storeBytes: storeInventory.stores.reduce((sum, store) => sum + store.bytes, 0),
    fileCount: fileInventory.directories.reduce((sum, dir) => sum + dir.files, 0),
    fileBytes: fileInventory.directories.reduce((sum, dir) => sum + dir.bytes, 0),
  },
};
report.totals.storeSize = byteLabel(report.totals.storeBytes);
report.totals.fileSize = byteLabel(report.totals.fileBytes);

const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, json, "utf8");
  console.log(`Inventory written to ${outputPath}`);
  console.log(`Stores: ${report.totals.storeCount} (${report.totals.storeSize})`);
  console.log(`Files: ${report.totals.fileCount} (${report.totals.fileSize})`);
} else {
  process.stdout.write(json);
}


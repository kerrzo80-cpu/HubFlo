#!/usr/bin/env node
/**
 * Inventory SQLite pilot_store keys (and optional file tree sizes) before ETL.
 *
 * Usage:
 *   node infra/migrate/export-sqlite-inventory.mjs /path/to/nexa-live.sqlite [/path/to/var/data]
 *
 * Safe: read-only. Does not modify production data.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const sqlitePath = process.argv[2];
const filesRoot = process.argv[3];

if (!sqlitePath) {
  console.error("Usage: node export-sqlite-inventory.mjs <sqlite-path> [files-root]");
  process.exit(1);
}

const db = new DatabaseSync(sqlitePath, { readOnly: true });
const rows = db
  .prepare("SELECT name, length(value) AS bytes, updated_at FROM pilot_store ORDER BY bytes DESC")
  .all();

console.log(JSON.stringify({
  sqlitePath,
  storeCount: rows.length,
  stores: rows,
  totalJsonBytes: rows.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
}, null, 2));

if (filesRoot && existsSync(filesRoot)) {
  const interesting = [
    "takeoff-files",
    "survey-files",
    "record-documents",
    "branding",
    "xero-exports",
    "xero-bills",
    "simpro-discovery-fixtures",
  ];
  const summary = [];
  for (const name of interesting) {
    const dir = path.join(filesRoot, name);
    if (!existsSync(dir)) continue;
    let files = 0;
    let bytes = 0;
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          files += 1;
          bytes += statSync(full).size;
        }
      }
    };
    walk(dir);
    summary.push({ name, files, bytes });
  }
  console.log(JSON.stringify({ filesRoot, directories: summary }, null, 2));
}

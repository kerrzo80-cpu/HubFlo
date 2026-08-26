#!/usr/bin/env node
/**
 * Apply packages/database/sql/*.sql to a Postgres DATABASE_URL (staging only).
 *
 * Usage:
 *   DATABASE_URL='postgresql://...?sslmode=require' node infra/migrate/apply-postgres-sql.mjs 0001_tenant_security.sql [0004_files_leads_takeoff_rls.sql]
 *
 * Safe: does not touch Render SQLite. Pass explicit filenames only.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("packages/database/package.json"));
const pg = require("pg");

const connectionString = process.env.DATABASE_URL?.trim();
const files = process.argv.slice(2);

if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

if (files.length === 0) {
  console.error("Pass at least one SQL filename under packages/database/sql/");
  process.exit(1);
}

const sqlDir = path.resolve("packages/database/sql");
const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 20_000 });

try {
  for (const name of files) {
    const filePath = path.join(sqlDir, name);
    const sql = readFileSync(filePath, "utf8");
    console.log(`Applying ${name} (${sql.length} bytes)...`);
    await pool.query(sql);
    console.log(`OK ${name}`);
  }
  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  console.log(JSON.stringify({ ok: true, tableCount: tables.rows.length, tables: tables.rows.map((r) => r.tablename) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await pool.end();
}

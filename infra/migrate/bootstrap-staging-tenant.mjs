#!/usr/bin/env node
/**
 * Bootstrap a single tenant row in staging Postgres for ETL rehearsal.
 * Does not read production SQLite — pass tenant metadata explicitly.
 *
 * Usage:
 *   DATABASE_URL='...?sslmode=require' node infra/migrate/bootstrap-staging-tenant.mjs \
 *     --slug ewg --name "EWG Plumbing" --admin-email brian@example.com
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("packages/database/package.json"));
const pg = require("pg");

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? String(process.argv[idx + 1] || "").trim() : fallback;
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const slug = arg("--slug", "ewg-staging");
const name = arg("--name", "EWG Staging");
const adminEmail = arg("--admin-email", "admin@staging.local");

const pool = new pg.Pool({ connectionString, max: 2 });

try {
  const existing = await pool.query("SELECT id, slug FROM tenants WHERE slug = $1", [slug]);
  if (existing.rows[0]) {
    console.log(JSON.stringify({ ok: true, tenantId: existing.rows[0].id, slug, existed: true }));
    process.exit(0);
  }

  const tenant = await pool.query(
    "INSERT INTO tenants (name, slug, legal_name, active) VALUES ($1, $2, $3, true) RETURNING id",
    [name, slug, name],
  );
  const tenantId = tenant.rows[0].id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const user = await client.query(
      "INSERT INTO users (email, display_name, active) VALUES ($1, $2, true) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id",
      [adminEmail, "Staging Admin"],
    );

    const role = await client.query(
      "INSERT INTO roles (tenant_id, name, key, permissions, is_system_default) VALUES ($1, $2, $3, $4, true) RETURNING id",
      [tenantId, "Owner/Admin", "owner_admin", JSON.stringify([])],
    );

    await client.query(
      "INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (tenant_id, user_id) DO NOTHING",
      [tenantId, user.rows[0].id, role.rows[0].id],
    );
    await client.query("COMMIT");

    console.log(JSON.stringify({ ok: true, tenantId, slug, adminUserId: user.rows[0].id, existed: false }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await pool.end();
}

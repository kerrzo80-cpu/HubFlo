import { createHash } from "node:crypto";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
const mirrorEnabled = process.env.NEXA_POSTGRES_MIRROR === "1" && Boolean(connectionString);
let pool: Pool | null = null;
let ready: Promise<void> | null = null;
let lastOkAt = "";
let lastError = "";

function getPool() {
  if (!mirrorEnabled || !connectionString) return null;
  pool ??= new Pool({ connectionString, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
  return pool;
}

function ensureTable() {
  const database = getPool();
  if (!database) return Promise.resolve();
  ready ??= database.query(`
    CREATE TABLE IF NOT EXISTS nexa_store (
      tenant_key text NOT NULL,
      name text NOT NULL,
      value jsonb NOT NULL,
      content_hash text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_key, name)
    )
  `).then(() => undefined);
  return ready;
}

export function storeContentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function mirrorServerStore(name: string, value: unknown) {
  const database = getPool();
  if (!database) return;
  const tenantKey = process.env.NEXA_TENANT_KEY?.trim() || "default";
  void ensureTable().then(() => database.query(
    `INSERT INTO nexa_store (tenant_key, name, value, content_hash, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (tenant_key, name) DO UPDATE SET
       value = EXCLUDED.value, content_hash = EXCLUDED.content_hash, updated_at = EXCLUDED.updated_at`,
    [tenantKey, name, JSON.stringify(value), storeContentHash(value)],
  )).then(() => { lastOkAt = new Date().toISOString(); lastError = ""; }).catch((error) => {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("PostgreSQL mirror write failed", { name, error: lastError });
  });
}

export async function writePostgresMirror(name: string, value: unknown) {
  const database = getPool();
  if (!database) throw new Error("PostgreSQL mirror is not enabled");
  const tenantKey = process.env.NEXA_TENANT_KEY?.trim() || "default";
  await ensureTable();
  await database.query(
    `INSERT INTO nexa_store (tenant_key, name, value, content_hash, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, now())
     ON CONFLICT (tenant_key, name) DO UPDATE SET
       value = EXCLUDED.value, content_hash = EXCLUDED.content_hash, updated_at = EXCLUDED.updated_at`,
    [tenantKey, name, JSON.stringify(value), storeContentHash(value)],
  );
  lastOkAt = new Date().toISOString();
  lastError = "";
}

export async function postgresMirrorSnapshot() {
  const database = getPool();
  if (!database) return { enabled: false, connected: false, rows: [] as Array<{ name: string; content_hash: string }> };
  try {
    await ensureTable();
    const tenantKey = process.env.NEXA_TENANT_KEY?.trim() || "default";
    const result = await database.query<{ name: string; content_hash: string }>(
      "SELECT name, content_hash FROM nexa_store WHERE tenant_key = $1 ORDER BY name", [tenantKey],
    );
    lastOkAt = new Date().toISOString(); lastError = "";
    return { enabled: true, connected: true, rows: result.rows };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return { enabled: true, connected: false, rows: [] as Array<{ name: string; content_hash: string }> };
  }
}

export function postgresMirrorStatus() {
  return { enabled: mirrorEnabled, lastOkAt: lastOkAt || null, lastError: lastError || null };
}

# Baseline migration gap

`0001_tenant_security.sql` enables RLS on core tables but **does not create them**.

Before staging ETL:

1. Run `pnpm db:generate` against `packages/database/src/schema.ts`
2. Commit generated SQL under `packages/database/drizzle/`
3. Apply with `pnpm db:migrate`
4. Then apply `sql/0001_tenant_security.sql` (and 0002/0003 if not already covered)

## Still missing from schema (add before multi-tenant SaaS)

- `leads`
- `invoices` / payment records
- `purchase_orders` / purchase requests
- `takeoff_projects` (+ markup jsonb or child tables)
- `files` (object metadata: storage_key, bucket, byte_size, checksum, tenant_id, entity refs)
- `auth_sessions` / password credentials (or keep auth in app until Keycloak)
- `integration_connections` (simPRO, Xero, email, WhatsApp)
- `daywork_sheets`
- `stock_*` / `prebuild_kits` (or map to material assemblies)

Do not claim Postgres cutover complete until these have a home (table or explicit jsonb document store with tenant_id).

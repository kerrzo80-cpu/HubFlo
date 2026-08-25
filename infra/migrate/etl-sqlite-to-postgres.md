# SQLite → PostgreSQL ETL runbook (staging)

**Goal:** Convert Render `pilot_store` JSON blobs into relational Postgres rows using `packages/database`, then validate. Production Render remains untouched.

## Preconditions

1. Full offline copy of `nexa-live.sqlite` (not the live mount while writing)
2. Tar of `/var/data/{takeoff-files,survey-files,record-documents,branding}`
3. Empty staging Postgres with migrations applied
4. One tenant UUID created for EWG (`slug = ewg` or similar)

## Inventory

```bash
node infra/migrate/export-sqlite-inventory.mjs ./backup/nexa-live.sqlite ./backup/var-data
```

Confirm expected keys exist (`people-store`, `workflow-store`, `hub-detail-store`, `survey-estimator-v1`, `auth-store`, `takeoff-store`, …).

## Schema apply

```bash
export DATABASE_URL=postgresql://...
pnpm db:generate
pnpm db:migrate
# Also apply packages/database/sql/0001_tenant_security.sql after baseline tables exist
# Then 0002 / 0003 as needed
```

Until baseline Drizzle migrations exist for core tables, apply generated SQL from `drizzle-kit generate` first. See `packages/database/sql/0000_baseline_gap.md`.

## Mapping (order)

1. `tenants` + bootstrap `users` / `memberships` from `auth-store`
2. `people-store` → `customers` / `sites`
3. `lead-store` → `leads` (new table)
4. `workflow-store` → `quotes` / `jobs` (+ purchase requests table)
5. `survey-estimator-v1` → normalized survey/estimate tables
6. `takeoff-store` → `takeoff_projects` + `files` metadata
7. `hub-detail-store` → split settings / invoices / schedules (jsonb interim OK)
8. Integration stores → `integration_connections` (**rotate secrets after import**)

## File sync

```bash
aws s3 sync ./backup/var-data/takeoff-files s3://$NEXA_FILES_BUCKET/$TENANT_ID/takeoff/
aws s3 sync ./backup/var-data/survey-files s3://$NEXA_FILES_BUCKET/$TENANT_ID/survey/
aws s3 sync ./backup/var-data/record-documents s3://$NEXA_FILES_BUCKET/$TENANT_ID/record/
aws s3 sync ./backup/var-data/branding s3://$NEXA_FILES_BUCKET/$TENANT_ID/branding/
```

Write `files` rows with legacy `storageKey` → S3 key map.

## Validation gates

- Store key inventory vs table counts
- Spot-check customers/jobs/quotes
- Login as known admin
- Open sample survey photo + takeoff PDF via signed URL
- RLS: second tenant cannot read EWG rows

## Rollback

Drop/recreate staging DB only. Never write destructive migrations against Render SQLite.

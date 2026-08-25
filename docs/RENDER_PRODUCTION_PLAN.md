# NeXa Render production plan

**Decision:** Stay on Render and upgrade in place. Full AWS hosting is deferred.

## Target stack (Render)

| Component | Service | Notes |
|-----------|---------|-------|
| Live app | `nexa-live` (Standard, Frankfurt) | SQLite primary until ETL cutover |
| Staging | `nexa-trial` (Standard) | ETL rehearsal, isolated disk + Postgres |
| Live Postgres | `nexa-live-postgres` (Basic 256MB → upgrade before cutover) | `nexa_store` mirror + future relational DB |
| Staging Postgres | `nexa-pilot-postgres` | Drizzle baseline + RLS tests |
| Nightly backup | `nexa-live-nightly-backup` cron | Local disk + optional S3 |
| simPRO sync | `nexa-live-simpro-eod` cron | 21:00 UTC weekdays |
| Board pack | `nexa-live-board-pack-monday` cron | Monday 08:05 UTC |

## Completed

- Phase A security hardening on live
- Postgres mirror enabled on live (`NEXA_POSTGRES_MIRROR=1`)
- Full mirror backfill: 72 stores on live, verified hashes
- Cron-auth postgres reconcile (`POST /api/ops/postgres-reconcile`)
- Drizzle baseline migration on staging Postgres
- Staging environment on `nexa-trial`

## In progress

1. **Mirror stays on** — every SQLite write copies to `nexa_store`
2. **Relational ETL** — map JSON stores → Drizzle tables on staging
3. **RLS** — apply `0001_tenant_security.sql` + `0004_files_leads_takeoff_rls.sql` on staging
4. **S3 off-site backups** — optional; needs `BACKUP_S3_*` secrets only (not full AWS migration)
5. **Postgres cutover** — only after staging ETL + full test matrix passes

## Retire / save cost

- `nexa-pilot` web + disk — suspended; delete when confirmed unused
- `nexa-live-deploy-smoke` cron — keep suspended (GitHub smoke covers deploys)

## Safety rules (unchanged)

- Do not delete Render disks or services
- Do not change live DNS
- SQLite remains primary until explicit cutover approval
- No destructive migrations against live SQLite

## Commands

```bash
# Inventory (read-only copy of sqlite + /var/data)
node infra/migrate/export-sqlite-inventory.mjs ./backup/nexa-live.sqlite ./backup/var-data

# Apply supplemental SQL on staging Postgres
DATABASE_URL='...?sslmode=require' node infra/migrate/apply-postgres-sql.mjs 0001_tenant_security.sql

# Backfill mirror (cron secret or admin session)
curl -X POST https://nexa-live.onrender.com/api/ops/postgres-reconcile \
  -H 'x-nexa-backup-secret: $NEXA_BACKUP_CRON_SECRET'
```

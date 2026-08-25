# NeXa AWS migration progress

**Last update:** 25 August 2026 (Render staging + Postgres baseline)  
**Production branch:** `codex/ai-surveyor-estimator-takeoff`  
**Staging URL:** https://nexa-trial.onrender.com  
**Live URL:** https://nexa-live.onrender.com

## Status

| Step | Status | Notes |
|------|--------|-------|
| Phase 1 audit | Done | `docs/PRODUCTION_STABILITY_AWS_MIGRATION_AUDIT.md` |
| Phase A on prod branch | **Merged + live** | PR #231 merged |
| Render staging (`nexa-trial`) | **Live** | Isolated SQLite + pilot Postgres |
| Postgres mirror (live) | **Re-enabled** | `NEXA_POSTGRES_MIRROR=1` via Render API |
| Postgres backfill | **Done (live + trial)** | 72 stores live; 46 stores trial; `cutoverAllowed: true` |
| Drizzle baseline | **Applied on staging PG** | `0000_hot_eternals.sql` |
| AWS Lightsail/S3 | Deferred | Render staging covers testing |
| Cutover | Not started | Render stays live; no DNS change |

## Verified

```text
GET https://nexa-live.onrender.com/api/health
GET https://nexa-trial.onrender.com/api/health
```

## Next

1. Deploy cron-auth postgres reconcile → `POST /api/ops/postgres-reconcile` on live + trial
2. Apply `sql/0001_tenant_security.sql` on staging after baseline smoke
3. SQLite inventory + ETL rehearsal on staging copy
4. AWS only if/when a second host is wanted

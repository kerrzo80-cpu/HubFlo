# NeXa migration progress (Render-first)

**Last update:** 25 August 2026  
**Strategy:** Stay on Render — upgrade Postgres, optional S3 backups, ETL on staging. AWS hosting deferred.

See `docs/RENDER_PRODUCTION_PLAN.md` for the full plan.

## Status

| Step | Status | Notes |
|------|--------|-------|
| Phase A security | Done | Live + staging |
| Postgres mirror (live) | **Done** | 72 stores, `cutoverAllowed: true` |
| Cron reconcile | Done | PR #232 merged |
| Drizzle baseline (staging) | Done | `0000_hot_eternals.sql` |
| RLS on staging | In progress | `0001` + `0004` supplemental SQL |
| Live crons | **Resumed** | simPRO EOD + board pack Monday |
| S3 off-site backups | Optional | Waiting on `BACKUP_S3_*` secrets |
| SQLite → Postgres ETL | Next | Staging rehearsal only |
| AWS hosting | **Deferred** | Not required for EWG production |

## Live

- URL: https://nexa-live.onrender.com
- Branch: `codex/ai-surveyor-estimator-takeoff`
- Store: SQLite primary, Postgres mirror enabled

## Staging

- URL: https://nexa-trial.onrender.com
- Branch: `codex/ai-surveyor-estimator-takeoff`
- Postgres: baseline + RLS tests

## Next automated steps

1. ETL mapper scaffolding for top stores (auth, people, workflow, hub-detail)
2. Staging validation matrix
3. Optional S3 wiring when secrets appear
4. Postgres plan upgrade before relational cutover

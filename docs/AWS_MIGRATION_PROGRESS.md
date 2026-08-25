# NeXa AWS migration progress

**Last update:** 25 August 2026  
**Production deploy branch:** `codex/ai-surveyor-estimator-takeoff` (not `main`)  
**Working branch:** `cursor/phase-a-on-prod-branch-d175`

## Status

| Step | Status | Notes |
|------|--------|-------|
| Phase 1 audit | Done on prod branch | `docs/PRODUCTION_STABILITY_AWS_MIGRATION_AUDIT.md` |
| Render secrets for fail-closed | Done | `SIMPRO_WEBHOOK_SECRET`, `HUBFLO_INTEGRATION_TOKEN`, `NEXA_IMPORT_TICK_SECRET` set via API |
| Phase A hardening on **prod branch** | In progress | Fail-closed webhooks, OpenAI env-only, timeouts, upload caps |
| Live Postgres | Exists empty | `nexa-live-postgres` basic-256mb; `NEXA_POSTGRES_MIRROR=0`; 0 tables |
| AWS staging Lightsail/S3 | Blocked | Waiting on AWS credentials |
| Cutover | Not started | Render stays live |

## Important production facts

- `nexa-live` auto-deploys from `codex/ai-surveyor-estimator-takeoff`
- Recent tip commits failed to build; live still serves an older successful deploy
- Plan is **standard** (not starter); runtime heap tip already 1536
- Office backup → S3 helpers already exist (`office-backup-s3.ts`)
- JSON→`nexa_store` mirror already exists but is disabled

## Operator next

1. Merge/deploy Phase A prod-branch PR once build is green
2. Optionally set `NEXA_POSTGRES_MIRROR=1` after deploy (additive; SQLite remains primary)
3. Provide AWS credentials for Lightsail + S3 staging

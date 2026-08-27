# NeXa AWS migration progress

**Last update:** 25 August 2026  
**Branch work:** Phase A stability/security + staging scaffolding

## Status

| Step | Status | Notes |
|------|--------|-------|
| Phase 1 audit report | Done | `docs/AWS_MIGRATION_PHASE1_AUDIT.md` |
| 1. Phase A software fixes on Render path | **In progress / landed in code** | See below — deploy to Render after review |
| 2. Stand up AWS staging | Blocked on AWS credentials | Scaffolding in `infra/aws-staging/` |
| 3. Schema + ETL + S3 on staging | Groundwork started | Schema additions + ETL runbook |
| 4. Full test matrix / cutover proposal | Not started | After staging is live |

## Phase A changes landed

- AuthZ: missing role under `NEXA_AUTH_MODE=users` → deny-all (not Owner/Admin)
- Proxy allowlist for webhook/cron/intake secret endpoints
- Webhooks / intake fail-closed when secrets unset in live/users/production
- OpenAI keys cannot be saved to SQLite on live/production; model registry added
- Hub-state strips employee passwords + integration secrets; PUT restores passwords from server
- OpenAI + simPRO outbound timeouts
- Takeoff/survey upload caps reduced (40MB / 25MB); proxy body 50MB
- Render heap tip lowered to 384 MB for starter RAM
- Default shared employee password removed from Core seeds
- Schema: `files`, `leads`, `takeoff_projects`, `integration_connections` + RLS SQL
- Staging/ETL docs and inventory script

## Still required from operators

1. Set `SIMPRO_WEBHOOK_SECRET`, `HUBFLO_INTEGRATION_TOKEN`, `NEXA_IMPORT_TICK_SECRET` on Render live (now fail-closed)
2. Confirm OpenAI keys exist as Render env vars (in-app key save blocked on live)
3. Provide AWS credentials + region to provision staging Lightsail/S3/Postgres
4. Do **not** change live DNS or delete Render

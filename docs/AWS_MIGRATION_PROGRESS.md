# NeXa AWS migration progress

**Last update:** 25 August 2026 (deployed)  
**Production deploy branch (temporary):** `cursor/phase-a-on-prod-branch-d175`  
**Canonical long-term branch:** `codex/ai-surveyor-estimator-takeoff`  
**Live commit:** `98a33d90019763abff8e932480b5a4bb07f014af`

## Status

| Step | Status | Notes |
|------|--------|-------|
| Phase 1 audit | Done | `docs/PRODUCTION_STABILITY_AWS_MIGRATION_AUDIT.md` on prod branch |
| Render secrets | Done | webhook / intake / import-tick set via API |
| Phase A on prod branch | **Deployed live** | Health `ok: true`; OpenAI `source: env` |
| Postgres mirror | **Enabled** | `NEXA_POSTGRES_MIRROR=1`; SQLite still primary |
| Live Postgres tables | Pending first writes / reconcile | DB was empty; `nexa_store` created lazily on write |
| AWS Lightsail/S3 staging | Blocked | Waiting on AWS credentials |
| Cutover | Not started | Render stays live; no DNS change |

## Verified live

```text
GET https://nexa-live.onrender.com/api/health
ok: true
store: sqlite
postgresMirror.enabled: true
openai.connected: true (env)
deployment.branch: cursor/phase-a-on-prod-branch-d175
deployment.commit: 98a33d90...
```

## Next

1. Merge PR into `codex/ai-surveyor-estimator-takeoff` and point Render auto-deploy back at that branch
2. Run authenticated `POST /api/ops/postgres-reconcile` once to backfill `nexa_store` hashes
3. Provide AWS credentials for Lightsail + private S3 staging
4. Keep pilot suspended/deleted only if unused; keep `nexa-live` + disk

# NeXa Production Stability and AWS Migration Audit

Date: 2026-08-24
Branch: `codex/ai-surveyor-estimator-takeoff`

This document is the required first output for the controlled production migration. It does not approve a cutover. Render remains live and must stay available as the rollback platform until AWS has been built, loaded with a tested copy of data, verified, and explicitly approved.

## 1. Current Architecture

NeXa is a pnpm monorepo:

- `apps/web`: Next.js 16 / React / TypeScript application, API routes, Core UI, Field, Survey, Takeoff, Blake, integrations.
- `apps/blake-mobile`: Expo mobile app for Blake in Your Pocket.
- `packages/database`: Drizzle PostgreSQL schema and SQL migrations, not currently the primary production runtime.
- `packages/domain`: shared survey/estimator domain logic.

The current production runtime is a Render web service with a persistent disk mounted at `/var/data`. The web app is stateful because production records, uploaded files, integration token files, and backups live on that disk.

## 2. Current Render Dependencies

Render live uses `render-live.yaml`.

Web service:

- `nexa-live`
- Region: Frankfurt
- Persistent disk: `/var/data`
- Runtime store: `NEXA_STORE_PATH=/var/data/nexa-live.sqlite`
- Store directory: `NEXA_STORE_DIR=/var/data`
- Health path: `/api/health`

Render cron jobs:

- `nexa-live-nightly-backup`: calls `/api/office-backup/cron`.
- `nexa-live-simpro-eod`: calls `/api/integrations/simpro/sync/cron`.
- Board pack cron: calls `/api/reports/board-pack/cron`.
- Liveness cron: calls `/api/health`.

Render-specific risks:

- Application and data share the same server filesystem.
- Large uploads pass through the Node process.
- SQLite writes are serialized through a single database file.
- File storage and backups depend on `/var/data` availability.
- Live deploy confidence depends on Render manual deploy state and health checks.

## 3. Current Database Architecture

Runtime production data is not using the Drizzle schema as the application database.

Current runtime database:

- SQLite file: `/var/data/nexa-live.sqlite`
- Table: `pilot_store`
- Shape: `name TEXT PRIMARY KEY`, `value TEXT NOT NULL`, `updated_at TEXT NOT NULL`
- Each application store is a JSON blob inside `pilot_store`.

Important runtime stores include Core hub state, users/auth, Blake chats, integration settings, record documents index, field workflow data, takeoff projects, survey estimator data, price/rate stores, accounting settings, backup status, and others.

Existing PostgreSQL work:

- `packages/database/src/schema.ts` contains a proper starting schema for tenants, users, customers, sites, quotes, jobs, job visits, tasks, alerts, variations, assets, service plans, timesheets, audit logs, surveys, estimates, material lines, labour lines, and survey evidence.
- `packages/database/sql/0001_tenant_security.sql` starts row-level security for several core tables.
- `apps/web/src/lib/postgres-store-mirror.ts` can mirror named JSON stores to a `nexa_store` table when `NEXA_POSTGRES_MIRROR=1`, but this is not a full relational production migration.

Assessment:

- PostgreSQL exists as a foundation, but the app still reads/writes JSON stores.
- The final migration requires a mapper from current JSON stores to relational tables.
- Some runtime data has no complete relational table yet.
- RLS is present but incomplete for newer tables; survey and estimate tables need RLS coverage added.

## 4. Current File Storage Architecture

Persistent files currently sit under `/var/data`, including:

- `record-documents`: quote/job/invoice/tender/fault attachments.
- `takeoff-files`: drawings, BOQs, specifications, tender documents.
- `survey-files`: survey uploads and evidence.
- `field-photos`: field photographs.
- `branding`: logos and app icons.
- `xero-bills`: Xero bill attachment cache.
- `xero-exports`: accounting exports.
- `backups`: generated `.tar.gz` office backups.
- `simpro_refresh_token.txt`: simPRO refresh token file.

The database stores file metadata and app URLs such as `/api/record-documents/:id/file`; the binary files are local disk files. The backup process includes the file directories above and can optionally upload backup archives to S3 via `BACKUP_S3_*`.

Assessment:

- This is the largest migration blocker after SQLite.
- S3 must become the durable source for customer files.
- PostgreSQL should store metadata, tenant, scope, record reference, object key, MIME type, size, checksum, visibility, and audit fields.
- S3 objects must be private; NeXa should serve signed URLs or proxy only where permissions require it.

## 5. Current AI Architecture

NeXa uses OpenAI server-side in multiple areas:

- Blake / NeXa Assistant: `/api/nexa-assistant`, Blake Core capability work, `/api/blake/chats`, `/api/blake/capabilities`.
- Blake Trainer.
- Field Ask Blake: text/photos, transcription, and realtime session endpoints.
- Survey guided assistant and survey draft.
- Takeoff extraction, Blake run, vision fallback, BOQ review, budget pricing.
- Tender AI takeoff.
- Fault/improvement AI.

Current model configuration is mixed:

- `OPENAI_API_KEY`
- `NEXA_OPENAI_API_KEY`
- `NEXA_ASSISTANT_OPENAI_MODEL`
- `NEXA_TAKEOFF_OPENAI_MODEL`
- `OPENAI_MODEL`

Assessment:

- Direct OpenAI API should remain the default. Bedrock does not yet show a clear advantage for this product because NeXa relies on model/tooling features, image/document reasoning, transcription, and low integration complexity.
- AI credentials must be server-side secrets only.
- A model registry should be introduced so assistant, survey, takeoff, image analysis, transcription, and estimating can each use configured models without code changes.
- Blake learning needs a controlled memory layer: tenant-scoped, permission-aware, reviewable, and editable. It must not claim it cannot learn if we are deliberately building Blake as the operating layer.

## 6. Stability Problems Discovered

Classified issues:

| Issue | Classification | Evidence / cause |
| --- | --- | --- |
| Random Render crashes / freezes | B + C + E | Stateful Render service, large local files, SQLite JSON blob writes, long requests, large uploads, AI/file processing in web process. |
| Field-app freezes | D + E | Client-side state and mobile uploads can be heavy; field photos and offline workflows need bounded payloads and background sync. |
| Takeoff drawing crashes / `ECONNRESET` | B + C + E | Large PDFs/images routed through app server, PDF parsing and AI routes can be memory/CPU-heavy, Render request limits. |
| Duplicate simPRO imports | A + C | Import mapping exists, but imported data can land as generic records when mapping/selection is wrong; needs idempotent external links and user-selected import scope. |
| Slow operations | B + C + E | JSON store snapshots, large Core state, long simPRO apply, PDF/Excel/AI work, SQLite locking. |
| Large file handling concerns | C + E | `request.formData()` + `file.arrayBuffer()` loads entire files into memory before writing to disk. |
| SQLite locking / concurrency | C | One file database with JSON blobs, WAL helps but does not turn it into multi-user relational storage. |
| Missing observability | B | Health routes exist, but detailed error tracing, request timings, memory, integration failures, and client crash telemetry need central collection. |

AWS will not fix software bugs by itself. It will give better building blocks for PostgreSQL, S3, monitoring, and scaling once the app stops relying on local disk and large JSON blobs.

## 7. Security Problems Discovered

- Secrets are configured through Render environment variables and some runtime stores; this must move to AWS Secrets Manager or SSM Parameter Store.
- simPRO refresh token can be file-backed at `/var/data/simpro_refresh_token.txt`.
- Email mailbox credentials are encrypted in app data using a server key; still needs Secrets Manager/KMS strategy for production.
- Current RLS SQL does not cover every table in `packages/database/src/schema.ts`.
- File URLs are app routes, which is good, but storage is local and migration must preserve private access controls.
- Need a policy that all production identity and authorization comes from server-side authenticated user/session, not user-supplied headers.
- No secrets should be logged in simPRO/OpenAI/Xero/Outlook diagnostics.

## 8. AWS Architecture Recommendation

Recommended first production AWS shape:

- Application: AWS App Runner or ECS Fargate, not a hand-maintained EC2 server as the preferred final shape.
- Database: RDS PostgreSQL.
- Files: S3 private bucket with versioning and lifecycle policies.
- Secrets: AWS Secrets Manager for app, simPRO, OpenAI, Xero, Outlook, WhatsApp, database credentials.
- Logs/metrics: CloudWatch Logs and metrics, plus an application error service such as Sentry when ready.
- Backups: RDS automated backups, S3 versioning, lifecycle, and periodic restore drills.

However, if cost and simplicity are the immediate priority, a staged approach is sensible:

1. Keep Render live.
2. Build AWS staging with RDS PostgreSQL + S3.
3. Run the current Next.js app on a small AWS compute service.
4. Test migration and stability.
5. Cut over only after sign-off.

## 9. Lightsail vs EC2 Recommendation

Recommendation: use Lightsail only for a short-lived proof deployment if needed; do not choose it as the long-term SaaS base.

Lightsail:

- Lower initial complexity.
- Predictable monthly cost.
- Good for proving the app runs outside Render.
- Weaker fit for SaaS scaling, IAM integration, observability, and production operations.

EC2:

- More flexible than Lightsail.
- Still requires server patching, process management, deployments, security hardening, and scaling work.
- Easy to recreate Render-style single-server problems if local disk is used.

Preferred first serious production option:

- App Runner or ECS Fargate for stateless app hosting.
- RDS and S3 for state.

If a single server must be used first, choose a small EC2 instance only as a stepping stone and keep all durable state in RDS/S3.

## 10. Lightsail PostgreSQL vs RDS Recommendation

Recommendation: RDS PostgreSQL for production.

Lightsail managed PostgreSQL:

- Cheaper and simpler.
- Acceptable for a staging/test copy.
- Limited operational controls for future SaaS growth.

RDS PostgreSQL:

- Better backups, snapshots, monitoring, security groups, maintenance controls, upgrade path, and scaling.
- Better long-term SaaS footing.
- Higher cost, but worth it because NeXa financial/job/customer data is production-critical.

Starter choice:

- RDS PostgreSQL single-AZ initially, smallest sensible class for the load test.
- Automated backups enabled.
- Multi-AZ later when live usage and budget justify it.

## 11. S3 Architecture

Buckets:

- `nexa-prod-files`: customer/tenant files, private.
- `nexa-prod-backups`: backup archives, private, versioned.
- Optional `nexa-staging-files` and `nexa-staging-backups` for test environments.

Object key pattern:

```text
tenant/{tenantId}/record-documents/{scope}/{recordRef}/{documentId}/{safeFileName}
tenant/{tenantId}/takeoff/{projectId}/documents/{documentId}/{safeFileName}
tenant/{tenantId}/survey/{surveyId}/photos/{photoId}/{safeFileName}
tenant/{tenantId}/field/{jobId}/{visitId}/photos/{photoId}/{safeFileName}
tenant/{tenantId}/branding/{kind}/{assetId}.png
backups/{environment}/YYYY/MM/DD/{backupName}.tar.gz
```

Rules:

- Block public access.
- Encrypt at rest.
- Use signed upload URLs for large files.
- Use signed download URLs or permission-checked proxy downloads.
- Store metadata in PostgreSQL.
- Keep checksums for migration validation.

## 12. OpenAI Direct vs Bedrock Recommendation

Recommendation: keep direct OpenAI API for now.

Direct OpenAI:

- Best fit for current code and features.
- Less migration risk.
- Supports the current chat, image/document, transcription, and realtime patterns.
- Lower complexity.

Bedrock:

- May help with central AWS procurement/security in future.
- Adds complexity and model/tooling constraints.
- No clear production benefit has been identified for NeXa today.

Action:

- Keep OpenAI server-side.
- Move keys to Secrets Manager.
- Add per-capability model config.
- Evaluate OpenAI data residency/processing options separately.

## 13. Migration Risks

- Data loss from incorrect JSON-store to relational mapping.
- Missing records because not all runtime stores are mapped.
- File references breaking when moving from local disk to S3.
- Tenant isolation gaps if RLS is incomplete.
- Integrations pushing duplicate records to simPRO/Xero.
- Long-running AI/takeoff jobs still crashing on AWS if they remain in web requests.
- Mobile upload failures if offline/large upload flow is not redesigned.
- Manual Render deploy drift during migration.
- Secrets copied incorrectly between Render and AWS.

## 14. Estimated Monthly Costs

These are planning estimates only and must be checked against actual AWS pricing at the time of purchase.

Starter production:

- App compute: small App Runner/ECS/EC2 equivalent, roughly 2-4 GB RAM: low tens of GBP/month.
- RDS PostgreSQL single-AZ small instance: roughly 30-80 GBP/month depending class/storage.
- S3 files/backups: low single digits to tens of GBP/month initially.
- CloudWatch logs/metrics: low single digits to tens depending retention/volume.
- Backups/snapshots: low to moderate depending file growth.
- OpenAI: usage-based and likely separate from AWS; depends heavily on Blake, takeoff, image, and transcription volume.

Growth production:

- Larger app compute or multiple tasks.
- RDS larger instance and/or Multi-AZ.
- More S3 storage and transfer.
- More observability/log retention.
- Background workers for AI/takeoff/import jobs.

Expected early AWS infrastructure range: about 75-200 GBP/month before OpenAI usage. Growth range can exceed this once Multi-AZ, larger DB, and more users/files are active.

## 15. Exact Code Changes Required

Phase A: safety and observability

- Add an AWS migration health/readiness endpoint that reports storage backend, DB backend, S3 config, PostgreSQL migration status, file migration status, and queue health without exposing secrets.
- Add request IDs, structured error logging, and bounded payload logging.
- Add memory and long-request telemetry around takeoff, survey, import, upload, and AI routes.
- Add hard upload size checks before reading files into memory.

Phase B: storage abstraction

- Introduce `FileStorage` interface: `put`, `get`, `delete`, `signedUpload`, `signedDownload`, `metadata`.
- Implement local disk adapter using current `/var/data`.
- Implement S3 adapter.
- Migrate `record-documents`, `takeoff-files`, `survey-files`, `field-photos`, `branding`, `xero-bills`, and `xero-exports` onto the interface.

Phase C: PostgreSQL runtime

- Audit every `loadServerStore`/`writeServerStore` store name.
- Create relational tables or transitional `jsonb` tables for unmapped stores.
- Expand Drizzle schema for missing runtime records: leads, invoices, cost centre sections/lines, POs, supplier RFQs, documents, Blake chats/memory, integration settings, imports, takeoff projects/studio, field workflows, dayworks, valuations, portals, and file metadata.
- Add RLS policies for every tenant table.
- Implement repository layer so app code does not directly depend on JSON store blobs.

Phase D: migration tooling

- Export SQLite `pilot_store`.
- Transform each named JSON store into PostgreSQL tables.
- Migrate files to S3 and update metadata references.
- Validate counts, checksums, key customer/job/quote/invoice records, and portal links.
- Produce a migration report.

Phase E: background jobs

- Move heavy takeoff extraction, AI scans, large imports, and backup work out of interactive web requests where possible.
- Add a job queue or worker process on AWS.

## 16. Exact Database Migration Strategy

1. Freeze code changes for a migration rehearsal branch.
2. Take a Render office backup and SQLite snapshot.
3. Export all `pilot_store` rows.
4. Inventory store names and payload sizes.
5. Map each store to a target PostgreSQL table or transitional table.
6. Run migration into AWS staging PostgreSQL.
7. Validate:
   - row counts
   - customer/site counts
   - quote/job/invoice counts
   - schedule counts
   - user/employee counts
   - documents metadata counts
   - Blake chat counts
   - integrations config presence without secret leakage
8. Run app against staging PostgreSQL.
9. Perform user workflow testing.
10. Repeat with latest production data.
11. Final migration window:
    - backup Render
    - pause writes or enter maintenance mode
    - export final SQLite
    - migrate PostgreSQL
    - migrate file delta
    - validate
    - switch traffic only after approval

## 17. Exact File Migration Strategy

1. Generate manifest of every local file under required directories:
   - path
   - size
   - SHA-256
   - inferred tenant
   - scope/record reference
   - MIME type
2. Upload to staging S3 with private ACL/block public access.
3. Store S3 object metadata in PostgreSQL.
4. Rewrite document records to point at storage keys, not local paths.
5. Validate all files by checksum.
6. Test download permissions for Core, Field, client portal, and engineer visibility.
7. Run final delta migration during cutover.

## 18. Testing Plan

Required test matrix:

- Auth: login, logout, password change, roles, field-only access, tenant isolation.
- Core: customers, sites, contacts, leads, quotes, jobs, invoices, cost centres, employees, setup saves.
- Scheduler: create, move, save, clash blocking, simPRO schedule push.
- Field: engineer login, job view, photos, forms, offline/daywork, Ask Blake.
- Surveyor: guided survey, photos/evidence, AI survey, estimator handoff.
- Takeoff: drawing upload, markup, calibration, measurement, BOQ, supplier RFQ, exports.
- AI: Blake chat, reporting questions, scheduling questions, survey AI, takeoff AI, field AI, image analysis, transcription.
- Integrations: simPRO, Outlook/email, Xero, WhatsApp, webhooks.
- Files: upload, open, download, permission checks, delete/archive, restore.
- Performance: multiple users, large PDFs, multiple photos, large takeoff project, AI requests, imports, simultaneous writes.

## 19. Rollback Plan

Render remains live until AWS is signed off.

Rollback before DNS switch:

- Do nothing to production traffic.
- Destroy/rebuild AWS staging if required.
- Keep Render data untouched.

Rollback after controlled switch:

- Keep Render service and disk intact.
- Keep final Render backup and final AWS migration artefacts.
- If AWS fails, switch traffic back to Render.
- Reconcile any writes made on AWS during the failed window before retrying migration.

Do not delete Render until AWS has run successfully for an agreed period, backups are proven restorable, integrations are confirmed, and no major stability issues remain.

## Immediate Next Steps

1. Add a store inventory script/report so we know every production JSON store and approximate size before designing tables.
2. Add a file inventory script/report for `/var/data` backup manifests.
3. Add S3 storage abstraction while keeping local disk as the default.
4. Add AWS staging env docs and secrets checklist.
5. Expand PostgreSQL schema/RLS for missing runtime entities.
6. Build SQLite-to-PostgreSQL migration rehearsal tooling.
7. Run the full workflow test pack on AWS staging only.


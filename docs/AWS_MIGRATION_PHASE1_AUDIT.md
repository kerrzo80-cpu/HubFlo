# NeXa — AWS Migration Phase 1 Audit Report

**Status:** COMPLETE — no production migration until this report is reviewed and approved  
**Repository:** `kerrzo80-cpu/HubFlo`  
**Audit date:** 25 August 2026  
**Scope:** Full repository inspection (code, Render blueprints, database package, integrations)  
**Constraint:** Render remains live. No DNS switch. No irreversible production changes.

---

## Executive verdict

NeXa is a real, deployable Next.js monorepo currently running on **Render starter** (Frankfurt) with a **stateful SQLite + local disk** architecture. The PostgreSQL/Drizzle schema in `packages/database` exists but is **not connected to the runtime**. Production data lives in JSON blobs inside SQLite (`pilot_store`) plus files under `/var/data`.

**AWS will not fix application bugs.** Stability issues are a combination of software defects (full-store memory loads, missing timeouts, dual importers, client role headers) and infrastructure limits (Render starter RAM vs `NODE_OPTIONS=--max-old-space-size=3072`).

**Recommended first production AWS shape (subject to approval):**

| Layer | Choice |
|-------|--------|
| App compute | **Lightsail 4 GB** Linux instance (EU region, prefer London or Frankfurt) |
| Database | **Lightsail managed PostgreSQL 2 GB** Standard (encrypt-capable tier) for starter; plan RDS later if multi-tenant SaaS demand grows |
| Files | **S3** private bucket + CloudFront optional later; signed URLs |
| Secrets | **AWS Secrets Manager** (or SSM Parameter Store SecureString) — never SQLite |
| AI | **Keep direct OpenAI API** (not Bedrock) unless residency requirements change |
| Render | Remain live as rollback until AWS is proven |

**Do not begin production cutover until:** software stability/security fixes land, schema gaps are closed, SQLite→Postgres ETL is validated on a staging copy, and S3 file migration is verified.

---

## 1. Current architecture

```text
HubFlo/
├── apps/web/                 Next.js 16 + React 19 — Core, Field, Surveyor, Takeoff, APIs
├── apps/nexa-field-ios/      Swift RoomPlan / LiDAR bridge
├── packages/domain/          Deterministic business rules (survey→estimate, invoice gates)
├── packages/database/        Drizzle PostgreSQL schema + partial SQL (NOT wired to app)
├── docs/
├── render.yaml               nexa-pilot (demo)
└── render-live.yaml          nexa-live (production) + EOD cron
```

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, TypeScript, module PWAs |
| Monorepo | pnpm 11.5.3 |
| Runtime persistence | SQLite via `node:sqlite` **or** JSON files under `.hubflo-runtime/` |
| Planned persistence | PostgreSQL + Drizzle — design only |
| Deploy | Render Frankfurt, Node 24.14.0, persistent disk `/var/data` (5 GB) |
| Core UI | Single monolith `apps/web/src/app/page.tsx` (~46,500 lines) |

**Request flow today**

1. Browser → Next.js on Render  
2. Auth via cookie (`nexa_session` when `NEXA_AUTH_MODE=users`) or pilot Basic Auth  
3. API routes read/write **entire JSON collections** via `loadServerStore` / `writeServerStore`  
4. Files written to `/var/data/{takeoff-files,survey-files,record-documents,branding,...}`  
5. Outbound: OpenAI, simPRO, Xero, WhatsApp, SMTP, postcode APIs  

**Product modules**

| Module | Routes | Notes |
|--------|--------|-------|
| NeXa Core | `/` | Leads, quotes, jobs, invoices, scheduler, setup, people |
| Login | `/login` | Users mode |
| Surveyor | `/survey/*`, `/ai-surveyor` | Guided + chat + AI |
| Estimator | `/estimator` | Domain estimate generation |
| Takeoffs | `/takeoff` | Markup, calibration, BOQ, AI extract |
| Field / Engineer | `/engineer/*` | Jobs, forms, photos, Ask Blake |
| Client portals | `/client/quotes|variations/[token]` | Token access |
| Reports / Office | Core tabs + `/office/*` | Aggregations, WhatsApp pilot, POs |

---

## 2. Current Render dependencies

| Resource | Detail |
|----------|--------|
| `nexa-live` | Web service, starter plan, Frankfurt, autoDeploy |
| `nexa-pilot` | Demo web service, same stack |
| Disk `nexa-live-data` | 5 GB at `/var/data` |
| `NEXA_STORE_PATH` | `/var/data/nexa-live.sqlite` |
| `NEXA_STORE_DIR` | `/var/data` |
| Heap | `NODE_OPTIONS=--max-old-space-size=3072` (exceeds starter RAM) |
| Cron `nexa-live-simpro-eod` | `0 18 * * 1-5` → `POST /api/integrations/simpro/sync/cron` |
| Health | `/api/health` |
| Public URL | `https://nexa-live.onrender.com` (do not change during Phase 1–staging) |
| Optional bridge | `https://ewg-hub-scheduler.onrender.com` (legacy scheduler) |

**Hard Render couplings to remove for AWS**

- Persistent disk as source of truth for DB + files + OAuth refresh token file  
- Render cron service (replace with EventBridge / Lightsail cron / systemd timer)  
- Env vars stored only in Render dashboard (`sync: false` secrets)

---

## 3. Current database architecture

### Runtime (production)

Single SQLite table:

```sql
pilot_store (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,   -- entire collection as JSON
  updated_at TEXT NOT NULL
)
```

Implemented in `apps/web/src/lib/server-store.ts` with WAL mode. Locally, without `NEXA_STORE_PATH`, each store is a JSON file under `.hubflo-runtime/`.

**Store inventory (incomplete backup risk)**

| Store key | Contents |
|-----------|----------|
| `people-store` | Clients, sites, audit |
| `lead-store` | Leads |
| `workflow-store` | Jobs, quotes, purchase requests |
| `hub-detail-store` | Settings, employees, cost centres, invoices, schedules, evidence, templates |
| `daywork-sheets-store` | Daywork sheets + **base64 signatures** |
| `takeoff-store` | Takeoff projects + document metadata |
| `survey-estimator-v1` | Surveys + estimates (nested documents) |
| `engineer-workflow-store` | Field workflows, photos/notes |
| `auth-store` | Users, sessions, login attempts |
| `record-documents-store` | Attachment metadata |
| `nexa-site-assets-v1` / `nexa-stock-v1` / `nexa-recurring-v1` / `nexa-prebuilds-v1` | Assets, stock, recurring, kits |
| `nexa-setup-config-v1` | Statuses, tax codes, templates, security groups |
| `simpro-auth-store` / `simpro-sync-store` / `simpro-entity-links` / `simpro-import-runs` | Integration state |
| `nexa-xero-auth-v1` / exports / bills | Xero tokens + history |
| `nexa-openai-config` | **OpenAI API key in plaintext JSON** |
| `email-integration` / `employee-mailboxes` / `email-settings-secret` | SMTP secrets |
| `variation-portal-store`, `blake-*`, `nexa-assistant-actions` | Portals / AI action logs |

`GET /api/prototype-backup` exports **only six** of these stores — insufficient for production recovery.

### Planned PostgreSQL (`packages/database`)

Drizzle schema defines tenants, users, memberships, customers, sites, quotes, jobs, visits, surveys (normalized), estimates, assets, audit, etc.

SQL files:

| File | Role |
|------|------|
| `sql/0001_tenant_security.sql` | RLS helper + policies — **assumes tables already exist** |
| `sql/0002_quote_job_workflow.sql` | Quotes + RLS |
| `sql/0003_survey_estimator.sql` | Survey/estimate tables + RLS |

**Critical gap:** No baseline SQL creates core tables (`tenants`, `users`, `customers`, `jobs`, …). `drizzle/` generated migrations folder is empty. Schema is **not production-ready** as-is.

**Runtime vs schema:** App never opens `DATABASE_URL`. RLS is never set. Soft tenancy only on survey/estimate via `x-hubflo-tenant-id` (default `pilot-ewg`). Everything else is single-tenant workspace.

---

## 4. Current file storage architecture

All durable files are on the application disk (`NEXA_STORE_DIR` ≈ `/var/data`):

| Path | Content | Max size (code) |
|------|---------|-----------------|
| `takeoff-files/{projectId}/` | PDF, images, DWG/DXF, XLSX, LiDAR (usd/usdz/obj/glb/gltf/ply) | **250 MB/file** |
| `survey-files/{surveyId}/` | Photos, PDF, drawings, 3D | **100 MB/file** |
| `record-documents/{scope}/{ref}/` | Lead/quote/job/invoice attachments | Buffered in Node |
| `branding/` | Logos | Small |
| `xero-exports/`, `xero-bills/` | CSV | Small |
| `simpro-discovery-fixtures/` | Sanitised API JSON | Small |
| `simpro_refresh_token.txt` | OAuth refresh token | Secret on disk |

**Also in JSON (not ideal):** daywork signatures as data-URLs; some evidence/preview images as base64; employee passwords in hub employee cards.

**No S3.** Uploads go Browser → NeXa server (`arrayBuffer` into memory) → disk.

---

## 5. Current AI architecture

| Feature | Route / module | OpenAI surface |
|---------|----------------|----------------|
| NeXa Assistant / Buddy | `/api/nexa-assistant` | Responses + chat completions |
| Takeoff extract / survey AI / skill / BOQ | `/api/takeoff-projects/[id]/*` | Responses API + files/images |
| Survey Ask NeXa / quote packs | `/api/surveys/[id]/*` | Responses / chat |
| Field Ask Blake | `/api/field/ask-blake` | Responses (+ vision); 28s abort |
| Transcription | `.../transcribe` | `gpt-4o-mini-transcribe` → `whisper-1` |
| TTS | `.../speak` | `gpt-4o-mini-tts` |
| Realtime Talk Lab | `.../realtime-session` | Ephemeral client secret; long-lived key server-only |
| Engineer paper OCR | workflow route | Responses + images |
| Blake trainer | `/api/blake-trainer/*` | Responses |
| Estimating regenerate | domain rules | **Not OpenAI** |

**Key resolution order** (`openai-env.ts` / takeoff config):

1. `OPENAI_API_KEY`  
2. `NEXA_OPENAI_API_KEY`  
3. Store `nexa-openai-config` (plaintext in SQLite)

Models partially configurable via `NEXA_ASSISTANT_OPENAI_MODEL`, `NEXA_TAKEOFF_OPENAI_MODEL`, `OPENAI_MODEL`; live defaults include `gpt-4.1-mini`. Not a clean multi-workload model registry yet.

---

## 6. Stability problems discovered

Classification key: **A** software · **B** infrastructure · **C** DB/storage architecture · **D** browser/client · **E** combination

| Issue | Class | Evidence / cause |
|-------|-------|------------------|
| Random Render crashes / OOM | **E** | Starter RAM vs 3 GB heap tip; full JSON stores + clones; import/AI spikes |
| Field freezes | **E (D+A+B)** | Base64 signatures/photos; slow daywork APIs; server memory pressure; heavy client |
| Memory / resource pressure | **E** | Module-level full-store caches; `JSON.parse(JSON.stringify)` clones; pretty-printed writes; 250 MB buffered uploads |
| Duplicate import problems | **A** | Dual paths: `simpro-sync.ts` Apply vs `simpro-import-service.ts` tick importer; weak idempotency |
| Slow operations | **E** | Full `/api/hub-state` poll (~60s); sync SQLite blob I/O; 46k-line Core; missing timeouts |
| Large file handling | **A+B** | `MAX_TAKEOFF_UPLOAD_BYTES = 250MB` fully buffered; AI path base64; Excel unzip in-process |
| SQLite concurrency | **C** | Whole collection rewritten per write; multi-worker stale cache comments |
| Missing AI/simPRO timeouts | **A** | Many OpenAI fetches lack `AbortSignal`; `simproGet` retries without hard timeout |
| EOD Apply on web dyno | **A+B** | Cron hits live interactive service (`maxDuration=300`) |
| Core monolith | **D+A** | `page.tsx` ~46,528 lines / ~2.1 MB source |

**Important:** Moving to AWS without fixing **A** items will recreate the same freezes on a larger bill.

---

## 7. Security problems discovered

| Issue | Severity | Detail |
|-------|----------|--------|
| Client-trusted role headers | **High** | `getAccessProfileFromHeaders` defaults missing role to **Owner/Admin**. Modules hard-code `x-hubflo-role: Office` / `Owner/Admin`. Proxy overwrites only when `NEXA_AUTH_MODE=users`. |
| OpenAI key in SQLite | **High** | `nexa-openai-config` plaintext |
| Employee passwords in hub JSON | **High** | Default `EWG2026` in Core employee cards; synced via hub-state |
| Webhooks open if secret unset | **High** | `isValidWebhookSecret`: `if (!expected) return true` |
| Email inbound / intake open if token unset | **High** | `HUBFLO_INTEGRATION_TOKEN` optional |
| WhatsApp soft signature verify | **Medium** | Can accept without strong HMAC |
| Record file APIs gated by spoofable headers (non-users modes) | **Medium–High** | |
| Secrets in app stores | **High** | simPRO tokens, Xero tokens, SMTP encryption key material |
| Partial backup endpoint | **Medium** | Prototype backup incomplete; powerful if exposed |
| Secrets in git | **Low (good)** | `.env` gitignored; risk is defaults/passwords in source |

**SaaS readiness:** Tenant isolation is design-only. Current production is effectively **one company, one disk**.

---

## 8. AWS architecture recommendation

```text
[Users / Field / Office browsers]
            |
            v
   Lightsail instance (Next.js, stateless app)
            |
    +-------+--------+------------------+
    |                |                  |
    v                v                  v
 Lightsail PG     S3 private         Secrets Manager
 (or later RDS)   nexa-files-*       OpenAI, simPRO, Xero, ...
    |                ^
    |                |  (presigned PUT/GET)
    +-- metadata ----+

EventBridge / cron  -->  same app OR small worker process
  - weekday EOD simPRO refresh
  - optional import ticks

CloudWatch (logs + alarms: CPU, mem, 5xx, disk)
Render nexa-live remains LIVE as fallback (unchanged DNS)
```

**Region:** Prefer **eu-west-2 (London)** or **eu-central-1 (Frankfurt)** for UK/EU latency and alignment with current Render Frankfurt. Confirm OpenAI / simPRO latency from chosen region.

**Principles**

1. App process **stateless** — no customer files or DB on local disk permanently  
2. Single writer DB (managed PostgreSQL)  
3. S3 for all customer objects  
4. Secrets outside application data store  
5. Worker separation for long Apply / AI / PDF when load justifies it  
6. Staging environment first; production cutover only after sign-off  

---

## 9. Lightsail vs EC2 recommendation

| Criterion | Lightsail | EC2 |
|-----------|-----------|-----|
| Cost predictability | Excellent (fixed bundle) | Variable (instance + EBS + egress) |
| Operational complexity | Low | Higher (VPC, SG, AMI hygiene) |
| Scale path | Vertical first; later migrate to EC2/ECS | Native horizontal + ALB |
| Fits 2–4 GB start | Yes ($12–$24/mo typical) | Yes but more knobs |
| Over-engineering risk | Low | Easy to overbuild |

**Recommendation: start on Lightsail 4 GB ($24/mo class)** for the application server.

Rationale: NeXa’s immediate problem is stability and architecture, not hyper-scale. Lightsail matches “simple and cost controlled.” Move to EC2/ECS/ALB when you need multi-instance, autoscaling, or advanced networking — **after** the app is stateless and Postgres/S3 are proven.

Do **not** start with ECS Fargate + multi-AZ ALB for the first cutover.

---

## 10. Lightsail PostgreSQL vs RDS recommendation

| Criterion | Lightsail managed PG | Amazon RDS PostgreSQL |
|-----------|----------------------|------------------------|
| Starter cost | ~$15–$30/mo (1–2 GB) | Higher floor (~$30–$60+ for db.t4g.micro/small + storage) |
| Backups | Automated snapshots (plan-dependent) | Strong (automated backups, PITR) |
| HA | Optional HA plan (2× cost) | Multi-AZ |
| Ops complexity | Lowest | Moderate |
| SaaS growth | Fine for single-tenant → early multi-tenant | Better long-term (extensions, params, replicas) |
| Encryption | Prefer **≥2 GB Standard** tiers that advertise encryption | Encryption standard |

**Recommendation for first production AWS: Lightsail managed PostgreSQL 2 GB Standard (~$30/mo).**

- Enough for EWG-scale + staging validation  
- Predictable cost  
- Automated backups/snapshots  

**Plan the exit path to RDS** when: multiple paying tenants, need PITR/cross-region, read replicas, or Lightsail limits bind. Do **not** jump to Multi-AZ RDS Enterprise pricing on day one.

---

## 11. S3 architecture

| Bucket (logical) | Purpose | Access |
|------------------|---------|--------|
| `nexa-{env}-files` | Survey photos, takeoff drawings, PDFs, certificates, logos, Field photos, LiDAR, record docs | Private; **Block Public Access ON** |
| Optional `nexa-{env}-backups` | DB dumps / export packs | Private; versioning ON |

**Key layout**

```text
s3://nexa-{env}-files/{tenantId}/{area}/{recordId}/{uuid}-{filename}
  area ∈ survey | takeoff | record | branding | field | lidar | reports
```

**Access pattern**

- Browser → **presigned PUT** → S3 (preferred for large media)  
- Browser → **presigned GET** for download/view  
- App stores only metadata: `storageKey`, `contentType`, `byteSize`, `checksum`, `tenantId`, `createdBy`  

**Do not** store large binaries in PostgreSQL.  
**Do** enable versioning on the files bucket for accidental-delete recovery.  
**Do** use SSE-S3 or SSE-KMS.  
**Do not** use public-read ACLs for customer content.

---

## 12. OpenAI direct vs Bedrock recommendation

| Factor | A: Direct OpenAI API | B: Bedrock → OpenAI models |
|--------|----------------------|----------------------------|
| Current code fit | Already implemented | Large rewrite |
| Model availability | Full OpenAI surface (Responses, Realtime, TTS, Whisper) | Often incomplete / delayed parity |
| Latency | Direct | Extra hop |
| Cost | OpenAI list | Bedrock + AWS margin; may be higher |
| Complexity | Low | IAM, model access, regional availability |
| Data residency | OpenAI EU options if eligible | AWS region control |
| Security | Server-side key in Secrets Manager | IAM roles (good) but capability gaps |

**Recommendation: KEEP DIRECT OPENAI API (Option A)** unless a contractual EU-processing requirement forces Bedrock and Bedrock exposes the exact models/APIs NeXa needs (Realtime, transcription, TTS, Responses with files).

**Immediate AI hardening (regardless of cloud):**

1. Remove OpenAI keys from `nexa-openai-config` store for production; Secrets Manager / env only  
2. Introduce server-side model registry (assistant / survey / vision / estimate / transcribe / tts)  
3. Add timeouts + size caps on every AI call  
4. Evaluate OpenAI EU data residency eligibility for production traffic  

---

## 13. Migration risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data loss during SQLite→PG | Critical | Offline backup; staging restore; count validation; dual-run |
| Schema gaps (leads, invoices, takeoff, stock, integrations) | High | Extend Drizzle before cutover; do not force-fit into wrong tables |
| File path rewrite breaks downloads | High | Mapping table old `storageKey` → S3 key; verify sample set |
| Dual simPRO importers re-duplicate | High | Freeze one path; idempotent upserts before cutover |
| Auth header trust on multi-tenant | Critical | Session-only authz before second tenant |
| Secrets left in SQLite after move | High | Rotate all tokens after migration |
| DNS switch too early | High | Keep Render; use AWS staging hostname until approved |
| Oversize Lightsail under load | Medium | Start 4 GB; monitor; vertical scale |
| Cron/webhook blocked by auth proxy | Medium | Explicit allowlists + secrets on AWS |
| Partial prototype backup used as “full backup” | Critical | Full store + file inventory backup procedure |

---

## 14. Estimated monthly costs

Assumptions: EU region, single production + light staging, UK traffic, OpenAI usage similar to today. Prices approximate USD (Aug 2026 list); confirm at purchase.

### STARTER PRODUCTION (single company, controlled cost)

| Item | Estimate |
|------|----------|
| Lightsail app 4 GB | ~$24 |
| Lightsail PostgreSQL 2 GB Standard | ~$30 |
| S3 storage 50–100 GB + requests | ~$3–$8 |
| S3 versioning / infrequent extras | ~$2 |
| Secrets Manager (5–10 secrets) | ~$3–$5 |
| CloudWatch basic logs/alarms | ~$5–$15 |
| Snapshots / DB backup retention | ~$3–$8 |
| Bandwidth (within Lightsail allowance mostly) | ~$0–$10 |
| **AWS infra subtotal** | **~$70–$100** |
| OpenAI (usage-variable) | **$50–$300+** (workload-dependent) |
| Render retained as fallback (temporary) | existing Render bill |

### GROWTH PRODUCTION (more users, early multi-tenant, heavier files/AI)

| Item | Estimate |
|------|----------|
| Lightsail app 8 GB **or** small EC2 + ALB | ~$44–$90 |
| Lightsail PG 4 GB **or** RDS db.t4g.small | ~$60–$80 |
| Optional worker instance 2 GB | ~$12 |
| S3 200–500 GB + transfer URLs | ~$10–$25 |
| CloudWatch + alarms | ~$15–$40 |
| Backups / snapshots | ~$10–$25 |
| Secrets / KMS | ~$5–$15 |
| **AWS infra subtotal** | **~$160–$290** |
| OpenAI | **$200–$1,000+** |

**Do not** assume enterprise Multi-AZ + WAF + PrivateLink on day one. Add those when SaaS revenue and compliance require them.

---

## 15. Exact code changes required

Ordered by migration priority (implement in stages; **none of these switch DNS**).

### Phase A — Stability & security (before or parallel to AWS staging)

1. **AuthZ:** Resolve role/permissions from `auth-store` session only; stop trusting client `x-hubflo-*` in production; remove default Owner/Admin on null role for API routes.  
2. **Secrets:** Stop writing OpenAI/simPRO/Xero/SMTP master secrets into `pilot_store`; read from env/Secrets Manager.  
3. **Webhooks:** Fail closed if `SIMPRO_WEBHOOK_SECRET` / integration tokens unset.  
4. **Timeouts:** `AbortSignal.timeout` on all OpenAI + simPRO outbound calls.  
5. **Upload caps:** Lower buffered limits; stream to disk/S3; reject oversized AI payloads.  
6. **Hub state:** Replace full dump with scoped/delta endpoints; strip secrets/passwords from payload.  
7. **simPRO:** Unify Apply vs tick importer; durable unique external IDs.  
8. **Heap:** Align `NODE_OPTIONS` with real instance RAM (e.g. 1536–2048 on 4 GB host).  
9. **Employee passwords:** Remove plaintext defaults from hub employee cards; use `auth-store` only.

### Phase B — Data platform

10. Generate **baseline Drizzle migrations** for all schema tables (fix gap where `0001` assumes tables exist).  
11. Extend schema for: leads, invoices/POs, takeoff projects, file objects, stock, prebuilds, auth sessions, integration connections, daywork sheets.  
12. Wire `@hubflo/database` into `apps/web` with per-request `SET LOCAL app.current_tenant_id`.  
13. RLS tests: tenant A cannot read tenant B rows.  
14. S3 client module + `files` metadata table; migrate writers in survey/takeoff/record/branding routes.  
15. Presigned upload/download API routes.  
16. Server-side **model configuration registry** (per workload).

### Phase C — AWS deploy plumbing

17. `Dockerfile` or Lightsail Node setup scripts; systemd/pm2 for Next start.  
18. Staging env vars document (no secrets in git).  
19. EventBridge/cron replacement for EOD simPRO.  
20. CloudWatch agent / structured logging + health metrics (heap, store size, import duration).  
21. Backup/restore runbooks as code under `scripts/` + `docs/`.

### Explicitly out of scope until approved

- DNS cutover  
- Deleting Render disk/services  
- Overwriting production DB  
- Blind Bedrock migration  

---

## 16. Exact database migration strategy

### Principle

Treat production as **document-store export → relational import**, not “copy the SQLite file to AWS.”

### Steps

1. **Freeze window preparation (no cutover yet)**  
   - Full offline copy of `/var/data/nexa-live.sqlite`  
   - Tar of `/var/data/{takeoff-files,survey-files,record-documents,branding}`  
   - Export all `pilot_store` keys (not just prototype-backup six)

2. **Schema readiness**  
   - Generate + apply baseline migrations to **empty staging Postgres**  
   - Add missing tables listed in §15  
   - Enable RLS; create single EWG `tenants` row; map `pilot-ewg` → UUID

3. **ETL mapping (first pass)**

| Source store | Target |
|--------------|--------|
| `people-store` | `customers`, `sites`, `audit_logs` |
| `lead-store` | `leads` (new) |
| `workflow-store` | `quotes`, `jobs`, `purchase_orders` (new) |
| `hub-detail-store` | Split: `company_settings`, employees→`users`/`memberships`, invoices (new), schedule plans (new/jsonb interim), cost centres (new) |
| `survey-estimator-v1` | Normalized `survey_*` + `estimate_*` |
| `takeoff-store` | `takeoff_projects` + `files` (new) |
| `auth-store` | `users` + `sessions` (new) |
| Integration stores | `integration_connections` (new) — **rotate secrets after import** |
| Daywork / engineer | Dedicated tables or structured jsonb with file refs for signatures |

4. **ID strategy**  
   - Preserve existing string IDs in a `legacy_id` column **or** deterministic UUID v5 from legacy id  
   - Maintain link tables for simPRO external IDs

5. **Validation gates (must pass before any production switch)**  
   - Row counts per entity (±0 unexplained)  
   - Spot-check N critical customers/jobs/quotes  
   - Auth login for known users  
   - Permission matrix  
   - Survey photo references resolve  
   - Takeoff drawing references resolve  

6. **Dual-run (recommended)**  
   - Staging AWS reads migrated data  
   - Render remains writable production  
   - Final sync delta immediately before approved cutover  

7. **Rollback**  
   - Keep Render SQLite + disk untouched  
   - AWS staging DB can be destroyed/rebuilt; never write destructive migrations against Render  

---

## 17. Exact file migration strategy

1. Inventory production disk: file counts, bytes, orphan keys vs store metadata.  
2. Create private S3 bucket + lifecycle + versioning.  
3. Upload tool: `aws s3 sync` / custom script preserving relative `storageKey` under `{tenantId}/...`.  
4. Write `files` rows: checksum (SHA-256), size, content-type, createdAt, parent entity.  
5. Update app readers to resolve `storageKey` → S3 (compatibility shim for old paths during transition).  
6. Validate: random sample download via signed URL; survey gallery; takeoff PDF open; branding logo.  
7. **Do not delete** Render disk copies until AWS has run successfully for an agreed soak period.  
8. Large uploads post-cutover: implement **presigned PUT** so Browser → S3, not via Node memory.

---

## 18. Testing plan

### AUTH
Login, logout, session expiry, role permissions, **tenant isolation** (create second synthetic tenant on staging and prove denial).

### CORE
Customers, jobs, quotes, invoices, cost centres, employees, setup CRUD — persist after refresh; audit events present.

### SCHEDULER
Create/move/save schedule; clash detection; simPRO schedule push; Outlook is SMTP-based today (test mailbox send, not Graph).

### FIELD
Engineer login; jobs; forms; photo upload; daywork; Ask Blake (text/vision/transcribe); offline drafts where applicable.

### SURVEYOR
Guided survey; photographs; evidence; AI Surveyor; estimator handoff; PDF.

### TAKEOFF
Drawing upload; markup; calibration; measurements; BOQ; exports; AI extract on bounded file size.

### AI
Assistant; Surveyor AI; Takeoff AI; Field AI; image analysis; transcription — confirm keys from Secrets Manager only.

### INTEGRATIONS
simPRO status/test/push/EOD cron; Xero connect/export; email send/test; WhatsApp webhook verify; inbound email if used.

### FILES
Upload/download/delete permissions; S3 version restore; no public listing.

### PERFORMANCE
Concurrent users; large PDF; multi-photo survey; large drawing; AI under load; watch RAM/CPU on 4 GB Lightsail. Pass criterion: no OOM; p95 interactive API acceptable under agreed SLO.

### AUTOMATED
Keep `pnpm typecheck` + `pnpm test`; add ETL validation script; add RLS isolation tests; expand API smoke (`scripts/e2e-*.mjs`) against staging.

---

## 19. Rollback plan

| Stage | Action |
|-------|--------|
| Before any AWS prod traffic | Render unchanged; DNS unchanged |
| Staging failure | Fix ETL/app; rebuild staging DB from fresh Render backup copy |
| Soft launch (hosts file / staging URL) | Users stay on Render; AWS used only by testers |
| If production DNS ever switched and fails | Repoint DNS to Render; Render disk/SQLite still authoritative if freeze window was short |
| Data written only on AWS after switch | Replay or manual merge procedure required — **avoid** by keeping Render read-only only after final sync approval |
| Secrets compromised during migration | Rotate OpenAI, simPRO, Xero, WhatsApp, SMTP, admin passwords |

**Hard rule:** Do not delete Render services, disks, or SQLite until AWS soak criteria are met (stability, backups restore-tested, integrations green, no critical regressions).

---

## Recommended sequencing (post-approval)

```text
1. Approve this report
2. Phase A software fixes on current Render (stability/security)  ← reduces crash class E
3. Stand up AWS staging (Lightsail 4GB + PG 2GB + S3 + secrets)
4. Schema completion + ETL + file sync into staging
5. Full test matrix on staging
6. Performance prove on 4GB (or bump to 8GB)
7. Final sync rehearsal
8. Production cutover proposal (separate approval)
9. Monitor; keep Render warm
10. Decommission Render only after explicit sign-off
```

---

## Appendix A — Environment variable inventory (summary)

See root `.env.example`, `render.yaml`, `render-live.yaml`. Critical groups:

- Store: `NEXA_STORE_PATH`, `NEXA_STORE_DIR`, `NEXA_WORKSPACE_MODE`  
- Auth: `NEXA_AUTH_MODE`, `NEXA_ADMIN_*`, `NEXA_PILOT_*`  
- OpenAI: `OPENAI_API_KEY`, `NEXA_OPENAI_API_KEY`, model vars  
- simPRO: OAuth + refresh file + webhook + cron secret + scheduler bridge  
- Xero / WhatsApp / email / postcode  
- Planned: `DATABASE_URL` (unused by app today)

## Appendix B — Evidence anchors

- Runtime store: `apps/web/src/lib/server-store.ts`  
- Hub detail memory: `apps/web/src/lib/hub-detail-store.ts`  
- Takeoff 250 MB buffer: `apps/web/src/app/api/takeoff-projects/[id]/documents/route.ts`  
- Webhook fail-open: `apps/web/src/lib/simpro-sync.ts` `isValidWebhookSecret`  
- Role default Owner/Admin: `apps/web/src/lib/access.ts` `getAccessProfile`  
- OpenAI in store: `apps/web/src/lib/openai-key-store.ts`  
- RLS design: `packages/database/sql/0001_tenant_security.sql`, `docs/ARCHITECTURE.md`  
- Render live + cron: `render-live.yaml`  
- Prior state audit: `NEXA_CURRENT_STATE.md` (27 Jul 2026)

---

**End of Phase 1 report. No production migration has been started.**

# Simpro Full Job & Quote Import — Implementation Plan

**Branch:** `cursor/simpro-full-import-0e95`  
**Scope:** Read-only historical + incremental import of Simpro jobs/quotes into Blake  
**Constraint:** No write-back to Simpro in this feature

---

## 1. Existing components to reuse

| Component | Path | Reuse |
|-----------|------|--------|
| OAuth / token refresh / reconnect | `apps/web/src/lib/simpro-auth.ts` | **Reuse as sole auth path.** Do not add a second OAuth stack. Extend only if token refresh durability needs hardening. |
| Direct API fetch patterns | `apps/web/src/lib/simpro-bridge.ts` (`simproApiFetch`, section/CC discovery) | Extract shared read client into `simpro-client.ts`; leave push logic untouched. |
| Shallow import + link store | `apps/web/src/lib/simpro-sync.ts` | Keep for current Setup “Import from simPRO” preview. New importer is additive (`simpro-import-*`), then gradually supersede. |
| Customers / sites | `people-data.ts`, `people-seed-data.ts` | Upsert via existing helpers + external links. |
| Jobs / quotes headers | `workflow-data.ts` | Extend with source fields; do not break outbound push IDs (`simproQuoteId` / `simproJobId`). |
| Cost centres / lines (local) | `hub-detail-store.ts` | Map imported hierarchy into this store initially (pilot persistence). |
| Persistence | `server-store.ts` (SQLite/`NEXA_STORE_DIR`) | Use for sync runs, errors, fixtures, checkpoints until Postgres is wired. |
| Access control | `access.ts` | Admin-only routes (`showFinance` / `canCustomize`). |
| Setup UI shell | `page.tsx` Integrations → simPRO | Add **Data Import** panel beside existing Import. |
| Outbound push + scheduler | `simpro-bridge.ts` | **Do not replace.** Import must not interfere. |

**Not present today (must add):** background worker/queue, durable `external_entity_links` unique constraints, attachment object storage, payload hashing, pause/resume checkpoints, reconciliation reports, status mapping table.

---

## 2. Persistence strategy (pragmatic)

**Phase B (near-term):** extend the existing `server-store` / SQLite pilot with new store keys:

- `simpro-import-runs` → sync runs + checkpoints  
- `simpro-import-errors` → failed records  
- `simpro-entity-links` → durable ID map (tenant + company + type + external id)  
- `simpro-import-payloads` → optional raw JSON blobs (disk files under store dir)  
- Extend workflow/hub records with `sourceSystem`, `sourceExternalId`, `sourceCompanyId`, `sourceNumber`, `sourceModifiedAt`, `lastSyncedAt`, `importedReadOnly`, `payloadHash`

**Phase B+ (later):** migrate these concepts onto `@hubflo/database` Drizzle tables (`simpro_connections`, `external_entity_links`, `simpro_sync_runs`, `simpro_sync_errors`) without changing the importer’s public API.

Money: store minor units (integer pence) in mapped fields; never reconcile with JS float.

---

## 3. Required backend services

| Service | File (planned) | Responsibility |
|---------|----------------|----------------|
| Shared Simpro HTTP client | `simpro-client.ts` | Auth’d GET/POST, retries, backoff, rate-limit headers, pagination |
| Discovery | `simpro-discovery.ts` | Phase A sample pull + sanitised fixtures |
| Sanitiser | `simpro-sanitize.ts` | Strip tokens/secrets/PII from fixtures/logs |
| Mapper | `simpro-import-map.ts` | Job/quote/section/CC/item → Blake shapes |
| Import orchestrator | `simpro-import-service.ts` | Stages, checkpoints, upserts, transactions-per-record |
| Reconciliation | `simpro-import-reconcile.ts` | Totals compare ±£0.02 |
| Attachments | `simpro-import-attachments.ts` | Metadata first; file download optional |
| Worker loop | `simpro-import-worker.ts` | Batch progress without tying to one HTTP request |

---

## 4. Required API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/integrations/simpro/discovery` | `POST` | Run Phase A discovery (admin) |
| `/api/integrations/simpro/discovery` | `GET` | Last discovery summary (no secrets) |
| `/api/integrations/simpro/import` | `POST` | Start / preview full import |
| `/api/integrations/simpro/import` | `GET` | Progress / status |
| `/api/integrations/simpro/import/control` | `POST` | Pause / resume / cancel / retry-failed |
| `/api/integrations/simpro/import/reconcile` | `POST` | Run reconciliation report |
| `/api/integrations/simpro/import/errors` | `GET` | Error report download |

Existing `/sync`, `/test`, `/reconnect`, `/webhook`, push routes remain.

---

## 5. Frontend pages

Setup → Integrations → Simpro → **Data Import**:

- Connection status, company/build, last sync, counts  
- Options: jobs/quotes, open/archived, date range, attachments, notes, custom fields, full vs incremental  
- Preview estimates  
- Progress (stage, counts, %, pause/resume/cancel)  
- Error + reconciliation reports  

Imported records: badge **Imported from Simpro**, read-only commercial fields, link to Simpro when URL known.

---

## 6. Background workers

Today there is **no queue**. Near-term approach:

1. Import run record with checkpoint (`lastProcessedPage`, `lastProcessedExternalId`, stage).  
2. Worker tick endpoint or long-lived process loop under Render worker / cron hitting `/api/integrations/simpro/import/tick` with a server secret.  
3. Browser polls `GET import` for progress. Closing the browser does not cancel the run.  

Later: replace tick with a real queue (BullMQ / pg-boss) once Postgres is live.

---

## 7. Risks / missing Simpro fields

| Risk | Mitigation |
|------|------------|
| Item endpoints differ by build (`labours` vs `laborItems`, `oneOffs` vs `catalogue`) | Probe candidate paths in discovery; store which paths worked per company |
| Company ID not always `0` | Resolve companies list; never hard-code |
| HTML descriptions | Store raw + plain-text strip for display |
| Archived / empty sections / no CCs | Mapper treats empty arrays as valid |
| Totals vs sum of lines differ | Reconcile with £0.02 tolerance; never auto-adjust |
| Rate limits | Bounded concurrency + Retry-After / exponential backoff |
| Token refresh failures | Surface reconnect UI; pause run; no silent token logging |
| JSON store size for full history | Store raw payloads as files; keep mapped fields in stores; migrate to Postgres |
| Duplicate job numbers across years | Unique on Simpro entity ID only |
| Outbound push collision | Imported records marked `importedReadOnly`; push continues for Blake-native records |

---

## 8. Exact files changed in Phase A (this PR)

| File | Change |
|------|--------|
| `docs/SIMPRO_FULL_IMPORT_PLAN.md` | This plan |
| `apps/web/src/lib/simpro-client.ts` | Shared authenticated GET + retry |
| `apps/web/src/lib/simpro-sanitize.ts` | Fixture sanitiser |
| `apps/web/src/lib/simpro-discovery.ts` | Discovery runner |
| `apps/web/src/app/api/integrations/simpro/discovery/route.ts` | Admin API |
| `apps/web/src/lib/simpro-fixtures/*.json` | Sanitised sample fixtures (no live PII) |
| `packages/domain/src/simpro-sanitize.test.ts` | Unit tests for sanitiser |
| `packages/domain/src/simpro-sanitize.ts` | Shared sanitiser (tested) |
| `.env.example` | Note discovery fixture dir if needed |

---

## 9. Build order (from brief)

| Phase | Status |
|-------|--------|
| A – API discovery | **Done** |
| B – DB / store foundation | **Done** |
| C – Core import service | **In progress** (header mapper + tick upsert for quotes/jobs) |
| D – Reliability (pagination, worker, resume) | Tick endpoint started; harden next |
| E – Admin UI | Parallel with D |
| F – Related data (notes, attachments…) | After E |
| G – Incremental sync | After verified full import |

---

## 10. Acceptance mapping (Phase A only)

Phase A is complete when:

1. Admin can run discovery against a connected Simpro company.  
2. Discovery returns company info + sample jobs/quotes + one full hierarchy each.  
3. Sanitised fixtures are saved server-side without tokens.  
4. Automated tests cover sanitiser / missing-field safety.  
5. Existing push / scheduler / shallow sync still work.

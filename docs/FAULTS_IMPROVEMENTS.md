# Faults & Improvements — Architecture Assessment

Assessment completed before Phase 1 build. NeXa production persists domain data as named JSON blobs in SQLite (`pilot_store`) via `server-store.ts`. There is no existing product feedback / development backlog system.

## 1. Where this feature should live

**Core module**, not Setup and not Office Alerts.

| Layer | Location |
|-------|----------|
| URL | `/faults` |
| Thin page | `apps/web/src/app/(core)/faults/page.tsx` |
| Registration | `core-routes.ts` + `CoreApp.tsx` module bar |
| UI panel | `apps/web/src/lib/FaultsPanel.tsx` (Tenders-style extracted panel) |
| Data | `apps/web/src/lib/faults-types.ts` + `faults-data.ts` |
| API | `apps/web/src/app/api/faults/route.ts` |

Place the module near Reports / Dayworks in the Core module bar (ops feedback register).

Do **not** put this in Field Ask Blake (equipment diagnosis) or Office Alerts (engineer ops).

## 2. Existing components to reuse

| Reuse | Path |
|-------|------|
| Persistence | `server-store.ts` (`loadServerStore` / `writeServerStore`) |
| Panel pattern | `TendersPanel.tsx` list + detail tabs |
| Attachments | `record-documents.ts` + `FileDropZone.tsx` |
| Access | `access.ts` (`getAccessProfileFromHeaders`, roles) |
| Auth identity | `auth-request.ts` / session headers |
| Directory chrome | Core register helpers / status pills |
| Company backup | `pilot-backup.ts` store allow-list |
| Audit-style history | own issue activity array (like tender notes / survey audit) |

## 3. Database changes required

**No Postgres migration.** Follow the live pattern:

- Store name: `nexa-faults-v1` (store `version: 2` after Phase 5 customer requests)
- Permanent refs: `NX-001`, `NX-002`, … via a dedicated counter in the store (never reuse)
- Entities in one JSON blob:
  - `issues[]`
  - `modules[]` (configurable area list)
  - `nextNumber`
  - `customerRequests[]` (Phase 5)

Add `nexa-faults-v1` to `PILOT_BACKUP_STORE_NAMES`.

Extend `RecordDocumentScope` with `"fault"` (ref = issue reference, e.g. `NX-027`).

Postgres / Drizzle multi-tenant tables remain a later track if SaaS tenancy ships.

## 4. Multi-tenancy handling

**Today:** single-company production (EWG). Core stores have no tenant column.

- Store issues as **NeXa product development** items for this company workspace.
- Optional fields: `sourceCompanyId` / `sourceCompanyName`, `visibility`, `promotedFromRequestIds[]`, `linkedRequestIds[]`
- Customer feedback stays company-scoped; promote creates/links to internal NX items. Do not expose internal backlog to ordinary customer users (when multi-tenant exists).

## 5. Blake connection

| Surface | Use |
|---------|-----|
| Core Blake (`nexa-assistant.ts`) | Intent `report_fault` / `suggest_improvement` with confirm → create fault issue |
| Field Ask Blake | Optional later “Log to Faults” — keep type distinct from equipment fault |
| Trainer knowledge | Teach module after backlog exists |

Always keep `originalDescription`; AI rewrite goes in `aiDescription` / development brief.

## 6. Attachments

Reuse Core record documents:

1. Scope `"fault"`
2. `recordRef` = `NX-###`
3. Upload via `/api/record-documents` multipart
4. UI: `FileDropZone` on issue detail Attachments tab + Report Problem modal

## 7. Permission changes

| Action | Who |
|--------|-----|
| View backlog | Authenticated; triage roles see full queue. Engineers may create + see own. |
| Create / attach / comment | Any authenticated non–Read-only role |
| Triage / test / promote / send-to-dev / GitHub | `canCustomize` or Owner/Admin / Manager |
| Delete | Owner/Admin only |

Blake fault confirms do **not** require `canEditJobs` (booking-only gate).

## 8. APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/faults` | List (+ customer requests for triage) |
| POST | `/api/faults` | `create`, `update`, `set-status`, `comment`, `delete`, `classify`, `generate-brief`, `test-result`, `customer-feedback`, `promote-feedback`, `send-to-development`, `sync-github` |
| Existing | `/api/record-documents` | Attachments with `scope=fault` |

## 9. Frontend

| Piece | Notes |
|-------|-------|
| `FaultsPanel.tsx` | Folders, filters, KPI strip, detail tabs including **Workflow** |
| `ReportFaultModal.tsx` | Global Report FAB — description, voice, module/type/priority, files, auto source route |
| Module bar | “Faults” |
| Health | `faultsImprovements: phases-2-6-v1` |

## 10. Architecture conflicts

| Conflict | Resolution |
|----------|------------|
| Field “fault” language | Product issues = Faults & Improvements; Field Ask Blake stays equipment diagnosis |
| No multi-tenant SaaS yet | Internal backlog + customer feedback promote/link |
| Postgres unused | Do not block on Drizzle |
| GitHub | Optional mirror via `GITHUB_TOKEN` + `GITHUB_FAULTS_REPO`; NeXa is source of truth |

## Status workflow

`inbox` → `approved` → `ready_for_development` → `in_progress` → `ready_to_test` → `complete`  
Also: `idea`, `rejected`

Testing: **PASS** → `complete`; **FAIL** → `in_progress` (fail note required).

Types: `fault` | `improvement` | `new_feature` | `ui_ux`  
Priorities: `urgent` | `high` | `medium` | `low`

## Phase status

### Phase 1 — shipped
- Store `nexa-faults-v1` + permanent `NX-###` refs
- API `GET/POST /api/faults`
- Core module `/faults` + `FaultsPanel`
- Attachments via `record-documents` scope `fault`
- Activity history, filters, KPI dashboard strip
- Backup allow-list

### Phase 2 — quick reporting
- Reporting lives in **Blake** (dock chips + chat: “report a problem” / “suggest an improvement”) with confirm → NX item
- Floating Report FAB removed so it does not cover page actions
- Optional `ReportFaultModal` retained for future attach flows; Faults tab keeps New item for triage

### Phase 3 — Blake + AI
- Blake intents `report_fault` / `suggest_improvement` with confirm card
- `faults-ai.ts`: classify + development brief (OpenAI structured JSON + heuristic fallback)
- Create supports `classifyWithAi: true`

### Phase 4 — development / testing workflow
- Workflow tab: generate brief, send to development, PASS/FAIL, test history
- `recordFaultTestResult` enforces fail notes

### Phase 5 — customer feedback
- `customerRequests[]` in store v2
- Create + promote/link to NX issues (Customer feedback folder)

### Phase 6 — Send to Development / GitHub
- `buildDevelopmentTaskMarkdown` development package
- Optional `sync-github` when env configured

Health flag: `faultsImprovements: phases-2-6-v1`

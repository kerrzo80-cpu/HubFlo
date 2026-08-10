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

**No Postgres migration for Phase 1.** Follow the live pattern:

- Store name: `nexa-faults-v1`
- Permanent refs: `NX-001`, `NX-002`, … via a dedicated counter in the store (never reuse)
- Entities in one JSON blob:
  - `issues[]`
  - `modules[]` (configurable area list)
  - `nextNumber`
  - optional later: `customerRequests[]`, links

Add `nexa-faults-v1` to `PILOT_BACKUP_STORE_NAMES`.

Extend `RecordDocumentScope` with `"fault"` (ref = issue reference, e.g. `NX-027`).

Postgres / Drizzle multi-tenant tables remain a later track if SaaS tenancy ships.

## 4. Multi-tenancy handling

**Today:** single-company production (EWG). Core stores have no tenant column.

**Phase 1:** store issues as **NeXa product development** items for this company workspace. Include optional fields ready for Phase 5:

- `sourceCompanyId` / `sourceCompanyName` (nullable)
- `visibility`: `internal` | `customer_feedback`
- `promotedFromRequestIds[]` (empty until Phase 5)

**Phase 5:** customer feedback stays company-scoped; promote creates/links to internal NX items. Do not expose internal backlog to ordinary customer users (when multi-tenant exists).

## 5. Blake connection

| Surface | Use |
|---------|-----|
| Core Blake (`nexa-assistant.ts`) | Phase 3: intent `report_fault` / `suggest_improvement` with confirm → `POST /api/faults` |
| Field Ask Blake | Optional later “Log to Faults” — keep type distinct from equipment fault |
| Trainer knowledge | Teach module after Phase 1 exists |

Phase 1 does **not** require Blake. Keep `originalDescription` always; AI rewrite goes in `aiDescription` / structured fields later.

## 6. Attachments

Reuse Core record documents:

1. Add scope `"fault"`
2. `recordRef` = `NX-###`
3. Upload via existing `/api/record-documents` multipart
4. UI: `FileDropZone` on issue detail Attachments tab

Files stay on disk under the store directory (not DB blobs).

## 7. Permission changes

Phase 1 without a new `AccessProfile` flag if possible:

| Action | Who |
|--------|-----|
| View backlog | Authenticated; Office+ with `canCustomize` or Owner/Admin/Manager see full queue. Engineers may create + see own. |
| Create / attach / comment on own | Any authenticated non–Read-only role |
| Edit status/priority/assign/spec | `canCustomize` (Owner/Admin, Manager, Office, Finance defaults) or Owner/Admin/Manager only for triage |

Phase 1 recommendation:

- **Create + view own:** all roles except Read-only
- **View all + triage:** `canCustomize` or role in `Owner/Admin` | `Manager`

Add `showFaults` / `canTriageFaults` to `AccessProfile` only if Setup needs per-user overrides soon; otherwise gate in API first.

## 8. Recommended routes / APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/faults` | List (+ query filters) |
| POST | `/api/faults` | Actions: `create`, `update`, `set-status`, `comment`, `delete` (admin) |
| GET | `/api/faults/[id]` | Detail (optional; list may include full records) |
| Existing | `/api/record-documents` | Attachments with `scope=fault` |

Public/customer portals: none in Phase 1.

## 9. Recommended frontend

| Piece | Notes |
|-------|-------|
| `FaultsPanel.tsx` | Folder/status tabs, search, filters, KPI strip, detail drawer/tabs |
| Detail tabs | Overview · Notes · Attachments · Activity |
| Module bar entry | “Faults” |
| CSS | Prefer existing Core / Tenders classes; brand accents `#38A1CE` / `#252623` where new |

Phase 2 adds global “Report problem” FAB/icon.

## 10. Architecture conflicts

| Conflict | Resolution |
|----------|------------|
| Field “fault” language | Product issues = Faults & Improvements; Field Ask Blake stays equipment diagnosis |
| No multi-tenant SaaS yet | Ship internal backlog; schema-ready for promote/link later |
| Postgres unused | Do not block on Drizzle |
| CoreApp size | Extract panel like Tenders; minimal wiring in CoreApp |
| `NX-` unused | Own counter in faults store (do not overload finance numbering settings) |

## 11. Phase 1 implementation plan

1. Types + store + `NX-` reference generator + activity helpers + unit tests  
2. API `/api/faults` with create/update/list/status/comment + permission gates  
3. Extend `record-documents` scope `"fault"`  
4. `FaultsPanel` backlog + detail  
5. Wire `core-routes`, thin page, CoreApp module  
6. Company backup allow-list + health flag  
7. Smoke-friendly: `/faults` redirects to login when logged out (like other Core modules)

**Out of Phase 1:** global report button, voice, Blake, testing PASS/FAIL UI, customer feedback promote, GitHub sync.

## Status workflow (Phase 1 data model)

`inbox` → `approved` → `ready_for_development` → `in_progress` → `ready_to_test` → `complete`  
Also: `idea`, `rejected`

Types: `fault` | `improvement` | `new_feature` | `ui_ux`  
Priorities: `urgent` | `high` | `medium` | `low`

## Phase 1 shipped

- Store `nexa-faults-v1` + permanent `NX-###` refs
- API `GET/POST /api/faults`
- Core module `/faults` + `FaultsPanel`
- Attachments via `record-documents` scope `fault`
- Activity history, filters, KPI dashboard strip
- Backup allow-list + health `faultsImprovements: phase1-core-backlog-v1`

Next: Phase 2 global Report Problem button.

# NeXa Current State

**Audit date:** 27 July 2026  
**Repository:** `/Users/ewgcoomercial/Documents/HubFlo` (GitHub: HubFlo)  
**Active branch audited:** `codex/ai-surveyor-estimator-takeoff` (matches deployed Render commit `de0eed94`)  
**Auditor:** Cursor agent handover audit  

This report is based on code inspection, local build/test execution, local dev-server startup, and production health checks — not on the product brief alone.

---

## Repository map

```text
HubFlo/
├── apps/
│   ├── web/                 Next.js 16 — NeXa Core + module PWAs + API routes
│   └── nexa-field-ios/        iOS RoomPlan / LiDAR bridge for takeoff room scans
├── packages/
│   ├── domain/              Shared business rules (surveyor, estimator, invoice gates)
│   └── database/            Drizzle PostgreSQL schema + migrations (not wired to runtime)
├── docs/                    Architecture, go-live plan, brand kit, integration intake
├── scripts/                   pnpm.sh, typecheck.sh
├── render.yaml                Render service: nexa-pilot (demo workspace)
├── render-live.yaml           Render service: nexa-live (live workspace)
└── NEXA_CURRENT_STATE.md      This document
```

### Technology stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16.2.9, React 19, TypeScript 6, Lucide icons |
| Monorepo | pnpm 11.5.3 workspaces |
| Runtime persistence | SQLite (`NEXA_STORE_PATH`) or JSON files (`.hubflo-runtime/`) |
| Planned persistence | PostgreSQL via Drizzle (`packages/database`) — schema exists, **not connected** |
| AI | OpenAI optional (`OPENAI_API_KEY`) for takeoffs, survey chat, NeXa Assistant scheduling intent |
| simPRO | Direct OAuth refresh, scheduler bridge, or webhook push |
| Deployment | Render (Frankfurt), Node 24.14.0, persistent disk at `/var/data` |
| Tests | Node built-in test runner + `@hubflo/domain` (15 tests) |
| Native | Swift/iOS RoomPlan app in `apps/nexa-field-ios` |

### Product naming in code

- **Current app name:** NeXa (Core manifest, page titles, API health)
- **Legacy names still present:** HubFlo (package names, some audit strings, header names `x-hubflo-*`)
- **AI assistant name in brief:** Buddy — **not yet used in UI**; code/UI still says **NeXa Assistant**

---

## Build and test results (27 Jul 2026, local)

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm typecheck` | **Pass** | All 3 workspace packages |
| `pnpm test` | **Pass** | 15/15 domain tests |
| `pnpm build` | **Pass** | 59 static/dynamic routes; 1 Turbopack NFT warning in `simpro-auth.ts` import chain |
| Local dev server | **Runs** | `http://localhost:3000` — store backend `json` |
| PostgreSQL migrations | **Not run** | No `DATABASE_URL` wired into app |
| Linter | **Not configured** | No ESLint script in root `package.json` |
| Browser manual test | **Partial** | Login shell renders; full Core workflow not exercised in this audit (employee password entry blocked in automation) |

### Production health (unauthenticated)

| Service | URL | Status |
|---------|-----|--------|
| nexa-live | `https://nexa-live.onrender.com/api/health` | **OK** — SQLite store, branch `codex/ai-surveyor-estimator-takeoff` |
| nexa-pilot | `https://nexa-pilot.onrender.com/api/health` | **OK** — SQLite store, same commit |

Protected endpoints (`/api/integrations/simpro/status`, `/api/go-live/readiness`) correctly return **401** without session.

---

## Working routes and modules

| Module | Route(s) | Backend |
|--------|----------|---------|
| **NeXa Core** | `/` | Monolithic client SPA + `/api/hub-state`, workflow APIs |
| **Login** | `/login` | `/api/auth/*` when `NEXA_AUTH_MODE=users` |
| **Scheduler** | Core → Schedules tab | Client-side planner + `/api/nexa-assistant` booking confirmation |
| **Surveyor (guided)** | `/survey/guided`, `/survey/guided/[id]` | `/api/surveys/*` |
| **Surveyor (chat)** | `/survey/chat` | Survey APIs + OpenAI optional |
| **AI Surveyor** | `/ai-surveyor` | Client draft store |
| **Estimator** | `/estimator` | `/api/estimates/*`, domain estimate generation |
| **Takeoffs** | `/takeoff` | `/api/takeoff-projects/*`, markup canvas |
| **Engineer App** | `/engineer`, `/engineer/jobs/[scheduleId]` | Seed/core schedule merge + workflow API |
| **Reports** | Core → Reports tab | Client-side aggregations from hub state |
| **Office alerts / POs** | `/office/alerts`, `/office/po-requests` | Engineer workflow store |
| **Client portals** | `/client/quotes/[token]`, `/client/variations/[token]` | Portal APIs |
| **NeXa Assistant (Buddy)** | Core slide-out panel | `POST /api/nexa-assistant` |
| **Setup / People** | Core → Setup, People | Hub detail store + server sync APIs |

Auth gate: `apps/web/src/proxy.ts` (Next.js 16 proxy/middleware). Pilot PIN or user-session modes.

---

## Working and tested

Evidence: code located + automated tests and/or build pass + runtime health.

- **Domain survey → estimate pipeline** — 15 unit tests including ATAG boiler relocation, radiator branching, completion gates, itemised materials/labour (`packages/domain/src/*.test.ts`)
- **Invoice readiness gates** — domain tests for blocker logic
- **Quote → job conversion rules** — domain tests
- **Production build** — all routes compile; TypeScript clean
- **Health endpoint** — local and Render return `ok: true`
- **Auth infrastructure** — scrypt password hashing, session cookies, login rate limiting (`auth-store.ts`, `/api/auth/login`)
- **Proxy auth gate** — pilot Basic Auth and user-session modes implemented in `proxy.ts`
- **Server-side simPRO OAuth refresh module** — token file, refresh candidates, reconnect flow (`simpro-auth.ts`); secrets stay server-side
- **simPRO outbound bridge status + test** — Setup Test connection now probes direct OAuth or scheduler login; quote/job push fails clearly when send returns nothing (`simpro-bridge.ts`)
- **Buddy live chat** — bottom-right dock; multi-turn history; grounded answers from NeXa quotes/jobs/diary; confirm-before-write bookings (`nexa-assistant.ts`, Core UI)
- **simPRO export queue** — quote/job push with audit trail and status (`simpro-bridge.ts`)
- **Guided survey API surface** — CRUD, photos, scope, pipe runs, equipment, PDF, completion review, send-to-estimator
- **Takeoffs markup model** — pipes, symbols, layers, calibration, offline draft sync structure (large `takeoff/page.tsx`)
- **Render deployment config** — two services (`nexa-pilot`, `nexa-live`) with persistent disks

---

## Present but not fully tested

Located in code; not end-to-end verified in this audit session.

- **NeXa Core monolith (`page.tsx`, ~33,700 lines)** — leads, quotes, jobs, invoices, scheduler UI, setup, imports
- **Employee card editing** — UI and localStorage/server sync exist; Brian's reported edit failures not reproduced here
- **Cost centre CRUD in Setup** — code paths present with server sync hold timers
- **Scheduler drag/drop save** — client writes `jobSchedulePlans`; simPRO schedule sync on confirm depends on env
- **Buddy / NeXa Assistant live answers** — requires OpenAI key + populated schedule data
- **Email integration** — SMTP settings API + send/test routes
- **WhatsApp pilot** — `/office/whatsapp-pilot`
- **Xero status stub** — `/api/integrations/xero/status`
- **iOS LiDAR app** — project exists; not built/run in this audit
- **Client quote/variation portals** — token routes exist

---

## Partially implemented

- **PostgreSQL / multi-tenant RLS** — full Drizzle schema in `packages/database`; app uses SQLite/JSON key-value stores instead
- **simPRO two-way sync** — preview/import routes exist (`simpro-sync.ts`, webhook route); go-live plan marks reconciliation incomplete
- **Engineer actual time → reporting variance** — workflow API and UI fields exist; seed data mixed with Core schedule; full Test F not verified
- **Variations workflow** — portal + detection concepts; auto Buddy flagging (Test G) not verified
- **Supplier RFQs** — estimator API route; end-to-end supplier response loop unclear
- **Heat loss module** — tabs in takeoff/survey chat; integration with estimator selections partial
- **Reports** — rich UI tabs; figures derived from workspace data — accuracy vs real books not verified
- **Gantt / job programme** — planner tab in job detail; not a full Gantt
- **Multi-company branding** — EWG logo hard-coded in several layouts; `companySettings.branding` in schema not wired to UI

---

## UI only or placeholder

- **Default pilot password hint** — `EWG2026` shown on login shell (configurable per employee card)
- **Engineer schedule date** — hard-coded "Tuesday 23 June" in `/engineer/page.tsx`
- **Some takeoff document areas** — "Locked PDF background placeholder" when no plan uploaded
- **Xero integration** — status endpoint only
- **Dashboard seed metrics** — demo workspace seeds representative EWG figures when `NEXA_WORKSPACE_MODE=demo`
- **AI Surveyor** — local draft storage; separate from guided survey persistence
- **Historical scheduler URL** — `ewg-hub-scheduler.onrender.com` referenced as optional bridge, not the main NeXa UI

---

## Broken

Not confirmed as fully broken without deeper QA; items with concrete evidence:

- **Local toolchain friction** — `node`/`pnpm` not on default PATH; requires Codex runtime or manual setup (documented in `scripts/typecheck.sh`)
- **Buddy product naming** — brief requires "Buddy"; UI still "NeXa Assistant" (functional gap vs spec, not runtime error)
- **render.yaml pilot simPRO vars** — still documents legacy `SIMPRO_ACCESS_TOKEN` instead of OAuth-first setup (deployment confusion — **being fixed in this audit**)

No critical runtime crash observed in build, health checks, or login shell render.

---

## Missing

Relative to handover brief and go-live plan:

- **Buddy** branding and cross-module presence as specified
- **PostgreSQL runtime connection** and tenant RLS enforcement in app
- **Proactive AI business alerts** on Core dashboard (trend/exception monitoring)
- **Full interactive takeoffs phase-one acceptance** (Test E) — structure exists; full PDF workflow not verified
- **Completion gates blocking invoice** — domain logic exists; not verified across live job workflow
- **Email OAuth** (Microsoft 365 / Gmail) — SMTP only
- **Full simPRO entity sync** with conflict queue
- **Multi-tenant onboarding and billing**
- **Automated E2E / acceptance tests** (Tests A–H from brief)
- **ESLint / pre-commit quality gate**

---

## Duplicate or obsolete

**Safe cleanup candidates (macOS `* 2.*` duplicates — not imported by build):**

- `apps/web/src/app/page 2.tsx`, `takeoff/page 2.tsx`, `engineer/page 2.tsx`, `engineer/layout 2.tsx`
- `apps/web/src/proxy 2.ts`, `server-store 2.ts`, `takeoff-data 2.ts`, `variation-portal-data 2.ts`
- `apps/web/src/app/api/takeoff-projects/route 2.ts`, `api/variation-portal/route 2.ts`
- `render 2.yaml`, duplicate docs under `docs/`

**Legacy / parallel systems:**

- Desktop backups: `ewg_quote_app_v1_*`, `Documents/HUB Scheduler` — historical; not part of active monorepo
- Flask scheduler at `ewg-hub-scheduler.onrender.com` — bridge target only

**Naming debt:**

- Package scope `@hubflo/*`, headers `x-hubflo-*`, some "HubFlo user" audit strings

---

## Deployment risks

| Risk | Detail |
|------|--------|
| **Monolithic Core** | Single 33k-line client component — high regression cost |
| **SQLite single-file store** | Render disk is source of truth; backup/restore process not automated in repo |
| **Dual Render services** | Pilot (`demo`) and live (`users`) can diverge in data and env |
| **simPRO env inconsistency** | Pilot `render.yaml` used legacy token vars; live uses OAuth file — standardisation needed |
| **Experimental Node SQLite** | Build warns SQLite is experimental in Node 24 |
| **No DATABASE_URL in production** | Postgres schema unused — migration path unclear |
| **OpenAI optional** | Assistant and takeoff AI degrade without key |
| **Trusted headers in module routes** | Some module pages send hard-coded `x-hubflo-employee-id: Brian Kerr` — bypasses session in dev |

---

## Security risks

| Risk | Mitigation status |
|------|-------------------|
| simPRO secrets in frontend | **Good** — server-side only (`simpro-auth.ts`) |
| Pilot PIN in Render env | Expected for pilot; live uses user accounts |
| Default password `EWG2026` on employee cards | Shown in UI; must be changed for production |
| Client-sent role headers | Proxy overwrites when `NEXA_AUTH_MODE=users`; demo/local modes trust client more |
| Session cookies | HTTP-only, SameSite lax |
| Login brute force | Rate limit in `/api/auth/login` |
| Audit trail | `appendAuditEvent` used across mutations — coverage not exhaustively verified |

---

## simPRO authentication status

**Code (server):** OAuth refresh flow implemented with support for:

- `SIMPRO_BASE_URL` / `SIMPRO_API_BASE_URL` (many aliases)
- `SIMPRO_CLIENT_ID`, `SIMPRO_CLIENT_SECRET`
- `SIMPRO_REFRESH_TOKEN`, `SIMPRO_REFRESH_TOKEN_FILE`
- Legacy static token fallbacks (`SIMPRO_ACCESS_TOKEN`, etc.) — still accepted but not preferred

**Local dev:** Not configured — `/api/health/simpro` reports missing base URL, company ID, and credentials.

**Production (`render-live.yaml`):** Configured for OAuth file persistence at `/var/data/simpro_refresh_token.txt`. Live connection not probed without authenticated session.

**Pilot (`render.yaml`):** Previously listed `SIMPRO_ACCESS_TOKEN` — updated in this audit to OAuth-first documentation.

**Bridge mode:** Scheduler bridge to `ewg-hub-scheduler.onrender.com` remains optional for quote/job push without direct API credentials.

---

## Database status

| Store | Status |
|-------|--------|
| **Runtime (active)** | SQLite on Render; JSON files locally in `apps/web/.hubflo-runtime/` |
| **PostgreSQL schema** | Defined in `packages/database/src/schema.ts` — tenants, customers, jobs, surveys, estimates, variations, etc. |
| **Migrations** | Drizzle kit scripts exist; **not executed** as part of app startup |
| **Data model in app** | Key-value JSON blobs: `people-store`, `workflow-store`, `hub-detail-store`, `survey-estimator-v1`, `takeoff-store`, `auth-store`, etc. |

---

## Ten highest-priority issues

1. **No PostgreSQL runtime** — multi-tenant RLS schema unused; all production data in SQLite JSON blobs  
2. **Monolithic Core maintenance risk** — `page.tsx` scale slows safe change  
3. **simPRO production verification gap** — OAuth code exists; live customer/job search not verified in this audit  
4. **Employee/setup edit reliability** — reported issues; needs focused QA on save + refresh  
5. **Engineer app still partly seeded** — hard-coded date; schedule merge with live Core incomplete  
6. **Buddy naming and grounded AI coverage** — Assistant scheduling exists; broader business Q&A not verified  
7. **Acceptance tests A–H not automated** — manual test playbook missing from CI  
8. **Duplicate obsolete files** — 19 `* 2.*` copies create confusion  
9. **Demo vs live workspace confusion** — two Render services; easy to test on wrong environment  
10. **Local dev PATH/tooling** — Node/pnpm not on system PATH without Codex runtime helper  

---

## Recommended implementation order

### Phase 0 — Stabilise (current)

1. ✅ Audit repository and document state (this file)  
2. ✅ Confirm build/test pass  
3. 🔄 Standardise simPRO OAuth env documentation (`render.yaml`, `.env.example`)  
4. Remove `* 2.*` duplicate files after quick import scan  
5. Verify simPRO connection on `nexa-live` via Setup test button (needs Brian's Render credentials)  
6. QA employee edit + cost centre create/edit with refresh  
7. Document local dev bootstrap (`scripts/pnpm.sh` + Node 22+)  

### Phase 1 — Sellable core

1. Harden Setup CRUD with server-side persistence tests  
2. Scheduler save + clash detection QA with simPRO push status visible  
3. Guided survey → estimator → quote PDF happy path  
4. Rename NeXa Assistant → **Buddy** in UI; expand grounded Q&A  
5. Engineer my-jobs from live schedule (remove seed date)  

### Phase 2 — Operational control

Variations, completion gates, reports accuracy, supplier RFQs, email OAuth, proactive alerts  

### Phase 3 — Advanced

Full takeoffs polish, heat loss, LiDAR/AR, catalogue matching, multi-tenant  

---

## Files changed in this audit session

| File | Change |
|------|--------|
| `NEXA_CURRENT_STATE.md` | Created (this document) |
| `.env.example` | simPRO OAuth-first env documentation |
| `render.yaml` | OAuth env vars for pilot; remove obsolete token-first layout |
| `render-live.yaml` | Add explicit OAuth client env keys |

---

## Honest summary

NeXa is a **real, deployable application** with substantial working surface area in one Next.js monorepo. Production (`nexa-live`, `nexa-pilot`) is **running** on Render with SQLite persistence. Core business logic for surveys and estimates is **test-backed**. simPRO integration is **architecturally correct** (server-side OAuth) but **not verified live** in this session. The largest structural gap is the **unused PostgreSQL layer** and the **monolithic Core UI**. The product is **not ready to claim** full acceptance Tests A–H without focused QA on simPRO, scheduler persistence, engineer time, and setup CRUD.

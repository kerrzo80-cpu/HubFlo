# Stability path — stop sneeze-crashes

## Deploy smoke (shipped)

| Check | How |
|-------|-----|
| Local / CI | `pnpm smoke:live:once` or `pnpm smoke:live` |
| GitHub Actions | `.github/workflows/live-deploy-smoke.yml` on live branch push + every 6h |
| Render cron | `nexa-live-deploy-smoke` hourly → `POST /api/health/smoke` (retries deploy 502s) |

Smoke covers: `/api/health` (incl. `coreRoutes`), `/login`, `/`, Core modules (`/jobs`, `/quotes`, `/leads`, `/setup`, `/reports`, `/people`, `/schedule`, `/invoices`), `/field`, Field SW files, Field manifest, `/heat-design`, `/api/branding`.

**Important:** a Render “server failure” email from `nexa-live-deploy-smoke` means the **smoke cron exited non-zero**, not that the main web service crashed.

- Mid-deploy 502/503s are retried (~5 minutes).
- If the probe still only sees a deploy/proxy window, the cron **soft-passes (exit 0)** so Render does not page.
- Only sustained real check failures should email.

Quick check: open https://nexa-live.onrender.com/api/health — if `ok: true`, the app is up.

Health flags: `deploySmoke: soft-pass-deploy-window-v3`, `coreRoutes: url-modules-v1`.

## Core URL modules (Phase 1)

Core mounts once in `app/(core)/layout.tsx` (`CoreApp`). Module URLs (`/jobs`, `/quotes`, …) are thin pages so refresh/deep links work without remounting hub state. Nested records stay under the parent path for now.

**Don’t do this:** add new Core screens by growing a second mega-page outside `(core)`.

## Platform shape (addons)

**Do this:** keep Core stable; add capabilities as **API-backed apps/integrations**.

| Kind | Examples | Rule |
|------|----------|------|
| Core spine | Jobs, quotes, schedule, invoices, Field, reports, people | Change rarely; covered by smoke |
| Separate apps | Survey, Takeoff, Heat Design, Blake Trainer | Own routes; talk to Core via APIs |
| Setup integrations | simPRO, Xero, SumUp, email | Credentials + sync in Setup; never block Core boot |

**Don’t do this:** long-lived feature branches that dump into `CoreApp.tsx` and can take the whole office down.

simPRO “addons” through Setup API is the right pattern — optional sync, not the daily spine.

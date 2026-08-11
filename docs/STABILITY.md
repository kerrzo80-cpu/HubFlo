# Stability path — stop sneeze-crashes

## Deploy smoke / uptime

| Check | How | Pages? |
|-------|-----|--------|
| Local / CI | `pnpm smoke:live:once` or `pnpm smoke:live` | No |
| GitHub Actions | `.github/workflows/live-deploy-smoke.yml` on live branch push + every 6h | GitHub only (full path smoke) |
| Render cron `nexa-live-deploy-smoke` | Hourly **liveness** → `GET /api/health` only | Render email **only** if health returns `ok: false` for several retries |

### Why the old Render emails were misleading

Render emails **“server failure”** whenever the **cron job** exits non-zero — not when the main `nexa-live` web service crashes.

The previous hourly cron called secret-gated `/api/health/smoke`. That failed often during:

- rapid auto-deploys / cutover 502s
- missing or mismatched `NEXA_IMPORT_TICK_SECRET` on the cron (immediate exit 1 / 403)

…while the office app was still up. That destroyed confidence.

**Current policy:** Render cron = quiet liveness. Full module smoke = GitHub Actions.

- Soft-pass (exit 0) on deploy/proxy/inconclusive windows.
- Exit 1 only when `/api/health` repeatedly returns `ok: false`.

Quick check: open https://nexa-live.onrender.com/api/health — if `ok: true`, the app is up.

Health flag: `deploySmoke: health-liveness-no-false-alarm-v1`.

### Apply this on Render

1. Confirm **Auto-Deploy is Off** for `nexa-live` in the Render dashboard (`render-live.yaml` already has `autoDeploy: false`).
2. After merging this change, **Manual Deploy** `nexa-live` or **Blueprint Sync** so the cron `startCommand` updates (yaml alone does not change a frozen service).
3. Ship product WIP to **nexa-pilot**; promote to live only when asked or for a blocking fault.

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

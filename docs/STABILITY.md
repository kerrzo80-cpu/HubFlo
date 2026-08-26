# Stability path — stop sneeze-crashes

## Deploy smoke / uptime

| Check | How | Pages? |
|-------|-----|--------|
| Local / CI | `pnpm smoke:live:once` or `pnpm smoke:live` | No |
| GitHub Actions | `.github/workflows/live-deploy-smoke.yml` on live branch push + every 6h | GitHub only (full path smoke). **Does not** require live commit == push SHA while Auto-Deploy is off. |
| GitHub Actions (promote) | `workflow_dispatch` with optional `expect_commit` | Fail if Manual Deploy did not land that commit |
| Render cron `nexa-live-deploy-smoke` | Hourly **liveness** → `GET /api/health` only | Render email **only** if health returns `ok: false` for several retries |

### Why failure emails were misleading

1. **Render cron** emails “server failure” when the cron exits non-zero — not when the web app crashes. Fixed: liveness-only soft-pass.
2. **GitHub Live deploy smoke** was requiring `NEXA_SMOKE_EXPECT_COMMIT=${{ github.sha }}` on every push. With **Auto-Deploy Off**, live stays on the last Manual Deploy (`b25fa1f…` etc.), so every new push waited 10 minutes then emailed “stale commit / Render build likely failed” even though the office site was healthy. Fixed: commit match only on manual `workflow_dispatch`.

**Current policy**
- Render cron = quiet liveness
- Push/schedule smoke = “is live still healthy?” (paths + `/api/health`)
- After Manual Deploy / promote, run workflow_dispatch with `expect_commit` set to the promoted SHA

Quick check: open https://nexa-live.onrender.com/api/health — if `ok: true`, the app is up.

Health flag: `deploySmoke: health-liveness-no-false-alarm-v1`.

### Apply / operate on Render

1. Keep **Auto-Deploy = Off** for `nexa-live`.
2. Ship product WIP to **nexa-pilot**; promote to live only when asked or for a blocking fault.
3. After Manual Deploy, optionally re-run **Live deploy smoke** via Actions → Run workflow → set `expect_commit`.

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

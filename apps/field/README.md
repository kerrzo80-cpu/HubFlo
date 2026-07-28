# NeXa Field

Standalone mobile app for plumbers and joiners.

Schedule, job packs (programme / drawings / photos), and **Blake** end-of-day time checks.
Runs on mock data today so the field experience can be built and tested before connecting to NeXa.

## Run

From the repo root:

```bash
pnpm install
pnpm --filter @hubflo/field dev
```

Open `http://localhost:3001`.

On a phone (same Wi‑Fi): use your machine LAN IP, e.g. `http://192.168.x.x:3001`, then Add to Home Screen for an app-like shell.

## What works now

- **My Day** — booked visits for the demo engineer
- **Job pack** — description, day programme, drawings/docs, photos, stop/go
- **Blake time check** — confirm or amend each job; actual hours stored as charged against jobs (local device)
- **Connect** tab — placeholder for the future NeXa URL / engineer id

## Connect to NeXa later

The app talks to a `NexaFieldClient` interface:

- Mock: `src/lib/nexa/client.ts` → `createMockNexaClient()`
- Future HTTP: `createHttpNexaClient(baseUrl, engineerId)` stubbed against office engineer APIs

When ready:

1. Point the field app at the NeXa base URL (Connect tab / env).
2. Map live schedule from NeXa engineer assignments.
3. Reuse `/api/engineer/time-check` so Blake-amended hours charge into Core jobs / Simpro review.

## Not in this app

- Native LiDAR RoomPlan lives in `apps/nexa-field-ios` (survey tooling).
- Office scheduling / Gantt editing stays in NeXa Core.

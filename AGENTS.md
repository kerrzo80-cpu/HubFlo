# AGENTS.md

## Cursor Cloud specific instructions

- Deploy branch for live Render (`nexa-live` / `nexa-pilot`) is `codex/ai-surveyor-estimator-takeoff`. Prefer landing product work there (or merge into it) rather than stale daywork bases.
- Standard commands: see root `package.json` / `apps/web/package.json` (`pnpm` workspace). Unit tests often run as `node --import tsx --test apps/web/src/lib/<name>.test.ts` from `apps/web`.
- **AI Takeoff Assistant** lives under Tenders → **AI Takeoff** tab (`TenderAiTakeoffPanel`). APIs: `GET/POST /api/tenders/[id]/ai-takeoff` and `POST .../ai-takeoff/apply`. AI proposes quantities via tools; NeXa calc in `ai-takeoff-calc.ts` owns money. Apply appends a BoQ sheet via `importBoqLinesIntoTender` and rejects zero-sell measured lines.
- OpenAI for takeoff/chat uses existing Setup → Integrations / `NEXA_OPENAI_API_KEY` (`getTakeoffOpenAiConfig`). Without a key, the panel still loads and tools can be exercised server-side; chat returns a connect message.
- **Office backups**: `POST /api/office-backup` creates tar.gz; Setup → Live readiness has **Test restore** which dry-runs `stores.json` via `POST /api/office-backup/restore`. Document folders / sqlite full restore remain manual. Nightly cron needs `NEXA_BACKUP_CRON_SECRET` on Render; optional `BACKUP_S3_*` for off-site.
- Hub schedule clashes are hard-blocked on `PUT /api/hub-state` (`SCHEDULE_CLASH` 409), matching by engineer id **or** normalised name. What-if apply also preflights with `assertNoHubScheduleClashes`.
- PDF chrome scrubs placeholder bank details and VAT/company numbers in `resolveFormDocumentChrome` / `commercial-safeguards.ts`.
- Reports cash owed excludes valuations and credit notes (same as invoice Unpaid folders). Field Daywork offline queue does not permanently lock the sheet; failed syncs show in Field chrome.

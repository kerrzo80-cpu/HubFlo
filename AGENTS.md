# AGENTS.md

## Cursor Cloud specific instructions

This is a pnpm workspace monorepo (`apps/*`, `packages/*`). The shipping product is the
Next.js web app **NeXa** (`@hubflo/web`), a multi-tenant field/job/service-management
platform (first tenant: EWG, a plumbing & heating trade company). It is the only
deployable service; there is no separate database/cache/queue to run. See `README.md`
for the standard `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck` commands.

### Toolchain (Node 24)

- The repo pins Node **24.14.0** (`.node-version`). It is installed via `nvm` and set as
  the default alias, so `nvm` login shells (including tmux sessions started with `-l`)
  already resolve `node` 24.14.0 and `pnpm` 11.5.3 (provided by corepack).
- Caveat: direct commands run through the agent Shell tool may resolve `node` to the
  daemon's v22 (`/exec-daemon/node`) instead of 24. If `node -v` shows v22, run
  `export PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$PATH"` (or `nvm use 24.14.0`)
  once — it persists for the rest of that shell session — so `node`/`pnpm` resolve to
  24.14.0. `pnpm install` itself works fine under either Node version.

### Running the app

- Start the dev server from a tmux login shell so Node 24 is active:
  `pnpm dev` (runs `next dev` for `@hubflo/web` on port **3000**). Do NOT use `next start`
  / `pnpm build` for development.
- Persistence is embedded: with `NEXA_STORE_PATH` unset it uses JSON files under
  `apps/web/.hubflo-runtime/`; `GET /api/health` reports `{ ok, store: "json" | "sqlite" }`.
- Env: copy `.env.example` → `.env.local` (root) and `apps/web/.env.example` →
  `apps/web/.env.local`. Everything can be left blank for local dev; `next dev` reads
  `apps/web/.env.local`. `NEXA_WORKSPACE_MODE=demo` seeds representative EWG data.
- Auth: with `NEXA_AUTH_MODE` unset the app shows an employee login shell. Demo login:
  username `errol`, password `EWG2026` (the login page lists enabled employee cards and
  the default password hint). `NEXA_AUTH_MODE=users` enables `/login` + server sessions.
- All external integrations (OpenAI, simPRO, Xero, WhatsApp, postcode lookup, SMTP) are
  optional and degrade gracefully when their env vars are unset.

### Testing / validation

- `pnpm test` runs the `@hubflo/domain` unit tests via the Node test runner + `tsx`.
- `pnpm typecheck` runs `tsc --noEmit` across the packages. Known pre-existing failure:
  `packages/domain/src/simpro-sanitize.test.ts` imports `./simpro-sanitize.ts` with a
  `.ts` extension while `tsconfig.base.json` does not enable `allowImportingTsExtensions`
  (TS5097). The web app (`pnpm --filter @hubflo/web typecheck`) typechecks cleanly.
- There is no ESLint configuration in this repo; typecheck is the lint gate.
- `packages/database` (Drizzle/PostgreSQL) is defined but not wired into the running web
  app; PostgreSQL is only needed for the `db:generate` / `db:migrate` scripts.

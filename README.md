# HubFlo

HubFlo is a multi-tenant work, job and service-management platform. EWG is the
first tenant, while the same platform is designed to serve future companies
with isolated data and configurable operations.

## Repository

```text
apps/web             Office application and initial server surface
packages/domain      Shared business rules
packages/database    PostgreSQL schema and tenant security
docs                 Architecture and delivery decisions
```

## Local development

Requirements:

- Node.js 22 or newer
- pnpm
- PostgreSQL for database-backed features

Install and start:

```bash
pnpm install
pnpm dev
./scripts/pnpm.sh --filter @hubflo/web dev
```

Open `http://localhost:3000`.

Validation:

```bash
pnpm typecheck
./scripts/typecheck.sh
CI=true ./scripts/pnpm.sh -r typecheck
pnpm test
pnpm build
```

Copy `.env.example` to `.env.local` when database work begins. The first screen
currently uses representative EWG data while the authenticated persistence layer
is built.

## Non-negotiable rules

- No operational record is queried without an authenticated tenant context.
- PostgreSQL row-level security backs up application tenant filters.
- Company workflow, status, rate and alert rules are configuration, not EWG
  conditionals.
- AI can suggest actions but cannot bypass deterministic gates.
- Engineer workflows must support offline use before field rollout.

# HubFlo Architecture

## Product boundary

HubFlo is the platform. Scheduling, estimating, office operations, engineer
workflows and communications are applications or modules using the same tenant,
identity and operational records.

The initial implementation is a modular monolith:

- `apps/web` is the office application and initial server surface.
- `packages/domain` contains framework-independent business rules.
- `packages/database` owns the PostgreSQL schema, migrations and tenant policy.
- A mobile engineer application and background worker will be added as separate
  applications once the shared contracts are established.

This gives each interface a clear boundary without creating independent systems
or duplicated customer and job data.

## Tenant isolation

The tenant is represented by `tenant_id` on operational records. A person has
one global user identity and gains access through a tenant membership.

Every authenticated request must:

1. Resolve the user identity.
2. Resolve and validate the selected tenant membership.
3. Begin a database transaction.
4. Set `app.current_tenant_id` locally for that transaction.
5. Execute all reads and writes inside that transaction.

PostgreSQL row-level security in
`packages/database/sql/0001_tenant_security.sql` is the final enforcement layer.
Application filters are still required, but they are not the only defence.

Background jobs, file paths, cache keys, webhook records and integration
connections must also include the tenant identifier.

## Domain rules

Operational gates are deterministic domain functions. AI may identify a likely
variation or suggest a job association, but it cannot bypass a rule-based gate.

Timeline and audit records are append-only. Corrections create another event so
the operational history remains understandable.

Process templates are versioned. A job workflow instance keeps the exact
template version it started with, even after a new template is published.

## Application roadmap

1. Office web: customers, sites, jobs, visits, timeline and work queues.
2. Engineer mobile: offline visit workflow, evidence, timesheets and sync.
3. Worker: alerts, reminders, provider webhooks and document generation.
4. Integration adapters: email, WhatsApp, accounting and imports.

Scheduling and estimating should become routes and modules within the office
experience. They may be developed independently at the UI level, but they must
consume HubFlo's shared records and commands.


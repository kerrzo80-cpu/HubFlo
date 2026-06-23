# HubFlo Delivery Plan

## Milestone 1: controlled job flow

Target outcome:

> Create the EWG tenant, customer, site and job; schedule a visit; complete a
> boiler service workflow; evaluate invoice readiness; show the job as ready or
> clearly blocked.

Work:

- Authentication, tenant membership and role enforcement
- Customer and site records
- Job creation and configurable statuses
- Job visits and engineer assignment
- Timeline events
- Tasks, blockers and variations
- Invoice readiness policy
- Initial boiler-service process template
- Tenant-isolation integration tests

## Milestone 2: engineer field application

- React Native application shell
- Offline visit cache and outbox
- Guided stage locking
- Photos, signatures and attachments
- Override requests with mandatory reason
- Timesheets and travel entries
- Conflict-safe synchronisation

## Milestone 3: scheduling and estimating

- Scheduling board backed by `job_visits`
- Engineer availability and assignment
- Quote and quote-line models
- Accepted quote to job conversion
- Estimate revisions and approval history

## Milestone 4: communications and automation

- Shared communications inbox
- Email provider connection
- WhatsApp Business provider connection
- Message-to-job triage
- Alerts, reminders and escalation worker
- Service plan renewal automation

## Milestone 5: finance and SaaS operations

- Financial transaction ledger
- Monthly movement report
- Accounting integration
- Tenant onboarding and branding
- Subscription and entitlement controls
- Backup, support and operational tooling

